import { randomUUID } from 'node:crypto';
import { buildIsochrone, SAMPLING_BUDGET_PROFILES } from './isochrone.mjs';
import { createWalkingProvider, validBd09ll } from './walking-provider.mjs';
import { PHASE4_CONFIG, WalkingCostCache } from './travel-cost-analysis.mjs';
import { FACILITY_MAPPING_VERSION } from './facility-categories.mjs';

export function createAnalysisManager({
  serverAk, fetchImpl = fetch,
  processRequestLimit = PHASE4_CONFIG.maxWalkingRequests,
  jobRequestLimit = 90,
} = {}) {
  if (!serverAk) throw new TypeError('A server-side map key is required.');
  if (!Number.isInteger(processRequestLimit) || processRequestLimit < 0
    || processRequestLimit > PHASE4_CONFIG.maxWalkingRequests
    || !Number.isInteger(jobRequestLimit) || jobRequestLimit < 1 || jobRequestLimit > 90) {
    throw new RangeError('Invalid walking request budget.');
  }
  const jobs = new Map();
  const cache = new WalkingCostCache();
  const budget = { networkRequests: 0 };
  let running = false;
  const queued = [];

  async function pump() {
    if (running || !queued.length) return;
    running = true;
    const id = queued.shift();
    const job = jobs.get(id);
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    const before = budget.networkRequests;
    const maxRouteCalls = Math.min(
      SAMPLING_BUDGET_PROFILES[job.samplingBudget],
      jobRequestLimit, Math.max(0, processRequestLimit - before),
    );
    const provider = createWalkingProvider({
      serverAk, fetchImpl, cache, budget,
      maxRequests: Math.min(processRequestLimit, before + maxRouteCalls),
    });
    try {
      job.result = await buildIsochrone({
        center: job.center, provider, maxRouteCalls,
        onProgress: (progress) => { job.progress = progress; },
      });
      job.status = job.result.status;
      job.geometryStatus = job.result.geometryStatus;
      job.requestStats = { ...provider.stats(), jobNetworkRequests: budget.networkRequests - before };
    } catch {
      job.status = 'failed';
      job.error = 'Analysis could not be completed.';
      job.requestStats = { ...provider.stats(), jobNetworkRequests: budget.networkRequests - before };
    } finally {
      job.finishedAt = new Date().toISOString();
      running = false;
      queueMicrotask(pump);
    }
  }

  function create({ center, confirmRealWalkingSampling, samplingBudget = 'high' } = {}) {
    if (!validBd09ll(center)) throw new TypeError('Invalid BD-09LL center.');
    if (confirmRealWalkingSampling !== true) throw new TypeError('Explicit sampling confirmation required.');
    if (!Object.hasOwn(SAMPLING_BUDGET_PROFILES, samplingBudget)) {
      throw new RangeError('Unknown walking sampling budget profile.');
    }
    if (budget.networkRequests >= processRequestLimit) throw new RangeError('Process walking request budget exhausted.');
    if (jobs.size >= 10) {
      for (const [id, job] of jobs) {
        if (job.status !== 'queued' && job.status !== 'running') { jobs.delete(id); break; }
      }
    }
    const id = 'ar-' + randomUUID();
    const job = {
      analysisId: id, status: 'queued', center: { lat: center.lat, lng: center.lng },
      coordinateSystem: 'BD-09LL', thresholdSeconds: 900,
      geometrySource: 'walking_sampling_fallback', geometryStatus: 'pending',
      scope: 'center_point_isochrone_only', studyAreaStatus: 'no_verified_community_boundary',
      samplingBudget, categoryMappingVersion: FACILITY_MAPPING_VERSION, createdAt: new Date().toISOString(),
      progress: { phase: 'queued', completed: 0, total: 81 },
      requestBudget: {
        jobLimit: jobRequestLimit, processLimit: processRequestLimit,
        selectedMaxRouteCalls: Math.min(SAMPLING_BUDGET_PROFILES[samplingBudget], jobRequestLimit),
      },
    };
    jobs.set(id, job);
    queued.push(id);
    queueMicrotask(pump);
    return publicJob(job);
  }
  function publicJob(job) {
    if (!job) return null;
    const { result, ...safe } = job;
    return {
      ...safe, counts: result?.counts ?? null,
      sampleMetrics: result?.sampleMetrics ?? null,
      algorithmVersion: result?.algorithmVersion ?? null,
      warnings: result?.warnings ?? [],
    };
  }
  return {
    create,
    get: (id) => publicJob(jobs.get(id)),
    geojson: (id) => jobs.get(id)?.result?.geojson ?? null,
    metrics: (id) => {
      const result = jobs.get(id)?.result;
      if (!result) return null;
      const nonOrigin = result.samples.filter((sample) => sample.decisionSource !== 'local_origin_identity');
      return {
        analysisId: id, scope: 'center_point_isochrone_only',
        thresholdSeconds: 900, samplingMethod: result.method,
        categoryMappingVersion: FACILITY_MAPPING_VERSION,
        geometrySource: result.geometrySource, geometryStatus: result.geometryStatus,
        counts: result.counts, sampleMetrics: result.sampleMetrics,
        walkingSampleSuccessRate: nonOrigin.length
          ? nonOrigin.filter((sample) => sample.decisionSource === 'baidu_walking_duration').length / nonOrigin.length
          : null,
        warning: 'These are sample counts, not population or facility coverage rates.',
      };
    },
    remainingRequests: () => processRequestLimit - budget.networkRequests,
  };
}
