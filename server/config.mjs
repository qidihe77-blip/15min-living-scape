import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const FACILITY_TASK_CONTRACT = Object.freeze({ requestVersion: 8,
  categoryMappingVersion: 'facility-categories-v8', mode: 'walking', minutes: 15,
  categoryCount: 6, subtypeCount: 18, subtypeScope: 'all',
  priorityRange: [1, 3], priorityMethod: 'p123_fixed_3_2_1',
  reachableNetworkOptional: true, defaultReachableNetwork: false,
  maxRouteCandidatesPerSubtype: 3, defaultRouteCandidatesPerSubtype: 3, defaultRouteScope: "circle_candidates" });

function booleanFlag(value, name) {
  if (value == null || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new TypeError(name + ' must be true or false.');
}

function entitlementExpiry(value,name='BAIDU_ISOCHRONE_VALID_UNTIL'){
 if(value==null||value==='')return null;
 const date=new Date(value+'T00:00:00Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)throw new TypeError(name+' must be a valid YYYY-MM-DD date.');
 return value+'T23:59:59.999+08:00';
}
function integerSetting(value, fallback, min, max, name) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new RangeError(name + ' must be an integer from ' + min + ' to ' + max + '.');
  }
  return parsed;
}

// Loads existing local keys without logging values or overriding host-provided settings.
export async function loadLocalEnv(rootDir, { env = process.env, readFileImpl = readFile } = {}) {
  let text;
  try {
    text = await readFileImpl(join(rootDir, '.env.local'), 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*[=:：]\s*(.*?)\s*$/);
    if (match && !(match[1] in env)) {
      env[match[1]] = match[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
  return true;
}

export function getServerConfig(env = process.env) {
  const config = {
    port: integerSetting(env.PORT, 4173, 1, 65535, 'PORT'),
    serverAk: env.BAIDU_SERVER_AK?.trim() || '',
    browserMapAk: env.VITE_BAIDU_MAP_AK?.trim() || '',
    productionIsochroneAlgorithm:env.PRODUCTION_ISOCHRONE_ALGORITHM?.trim()||'walking36',
    walkingAcceleration:env.WALKING_ACCELERATION_ENABLED==null?true:booleanFlag(env.WALKING_ACCELERATION_ENABLED,'WALKING_ACCELERATION_ENABLED'),
    adaptiveDirections:env.ADAPTIVE_DIRECTIONS_ENABLED==null?true:booleanFlag(env.ADAPTIVE_DIRECTIONS_ENABLED,'ADAPTIVE_DIRECTIONS_ENABLED'),
    adaptiveDirectionODBudget:integerSetting(env.ADAPTIVE_DIRECTION_OD_BUDGET,18,0,36,'ADAPTIVE_DIRECTION_OD_BUDGET'),
    walkingCacheTtlSeconds:integerSetting(env.WALKING_CACHE_TTL_SECONDS,86400,300,604800,'WALKING_CACHE_TTL_SECONDS'),
    serviceFunctionSearchLimit:integerSetting(env.SERVICE_FUNCTION_SEARCH_LIMIT,4,0,12,'SERVICE_FUNCTION_SEARCH_LIMIT'),
    serviceFunctionDetailLimit:integerSetting(env.SERVICE_FUNCTION_DETAIL_LIMIT,2,0,4,'SERVICE_FUNCTION_DETAIL_LIMIT'),
    serviceFunctionOriginRouteLimit:integerSetting(env.SERVICE_FUNCTION_ORIGIN_ROUTE_LIMIT,12,0,40,'SERVICE_FUNCTION_ORIGIN_ROUTE_LIMIT'),
    isodistanceEnabled:booleanFlag(env.BAIDU_ISODISTANCE_ENABLED,'BAIDU_ISODISTANCE_ENABLED'),
    isodistanceEntitlementVerified:booleanFlag(env.BAIDU_ISODISTANCE_ENTITLEMENT_VERIFIED,'BAIDU_ISODISTANCE_ENTITLEMENT_VERIFIED'),
    isodistanceLastStatus:integerSetting(env.BAIDU_ISODISTANCE_LAST_STATUS,0,0,9999,'BAIDU_ISODISTANCE_LAST_STATUS'),
    walkingConcurrency:integerSetting(env.BAIDU_WALKING_CONCURRENCY,10,1,10,'BAIDU_WALKING_CONCURRENCY'),
    walkingMinIntervalMs:integerSetting(env.BAIDU_WALKING_MIN_INTERVAL_MS,110,110,10000,'BAIDU_WALKING_MIN_INTERVAL_MS'),
    placeConcurrency:integerSetting(env.BAIDU_PLACE_CONCURRENCY,6,1,6,'BAIDU_PLACE_CONCURRENCY'),
    placeMinIntervalMs:integerSetting(env.BAIDU_PLACE_MIN_INTERVAL_MS,105,105,10000,'BAIDU_PLACE_MIN_INTERVAL_MS'),
    serviceMinIntervalMs:integerSetting(env.BAIDU_SERVICE_MIN_INTERVAL_MS,500,500,10000,'BAIDU_SERVICE_MIN_INTERVAL_MS'),
    isochroneEnabled: booleanFlag(env.BAIDU_ISOCHRONE_ENABLED, 'BAIDU_ISOCHRONE_ENABLED'),
    walkingSamplingFallbackEnabled: env.BAIDU_WALKING_SAMPLING_FALLBACK_ENABLED == null
      ? Boolean(env.BAIDU_SERVER_AK?.trim())
      : booleanFlag(env.BAIDU_WALKING_SAMPLING_FALLBACK_ENABLED, 'BAIDU_WALKING_SAMPLING_FALLBACK_ENABLED'),
    apiTimeoutMs: integerSetting(env.BAIDU_API_TIMEOUT_MS, 8000, 1000, 30000, 'BAIDU_API_TIMEOUT_MS'),
    apiMaxRetries: integerSetting(env.BAIDU_API_MAX_RETRIES, 1, 0, 3, 'BAIDU_API_MAX_RETRIES'),
    isochroneEntitlementVerified: booleanFlag(env.BAIDU_ISOCHRONE_ENTITLEMENT_VERIFIED, 'BAIDU_ISOCHRONE_ENTITLEMENT_VERIFIED'),
    isochroneExpiresAt: entitlementExpiry(env.BAIDU_ISOCHRONE_VALID_UNTIL),
    isochroneRequestLimit: integerSetting(env.BAIDU_ISOCHRONE_REQUEST_LIMIT, 0, 0, 1000, 'BAIDU_ISOCHRONE_REQUEST_LIMIT'),
    matrixVerified: booleanFlag(env.BAIDU_MATRIX_VERIFIED, 'BAIDU_MATRIX_VERIFIED'),
    batchWalkingEnabled:booleanFlag(env.BAIDU_BATCH_WALKING_ENABLED,'BAIDU_BATCH_WALKING_ENABLED'),
    batchWalkingDailyLimit:integerSetting(env.BAIDU_BATCH_WALKING_DAILY_LIMIT,10000,0,10000,'BAIDU_BATCH_WALKING_DAILY_LIMIT'),
    batchWalkingOutputQps:integerSetting(env.BAIDU_BATCH_WALKING_OUTPUT_QPS,10,1,10,'BAIDU_BATCH_WALKING_OUTPUT_QPS'),
    batchWalkingExpiresAt:entitlementExpiry(env.BAIDU_BATCH_WALKING_VALID_UNTIL,'BAIDU_BATCH_WALKING_VALID_UNTIL'),
    facilityPrefetch:env.BAIDU_FACILITY_PREFETCH_ENABLED==null?true:booleanFlag(env.BAIDU_FACILITY_PREFETCH_ENABLED,'BAIDU_FACILITY_PREFETCH_ENABLED'),
    rangeMatrixVerified:booleanFlag(env.BAIDU_RANGE_MATRIX_VERIFIED,'BAIDU_RANGE_MATRIX_VERIFIED'),
    rangeMatrixOutputLimit:integerSetting(env.BAIDU_RANGE_MATRIX_OUTPUT_LIMIT,0,0,176,'BAIDU_RANGE_MATRIX_OUTPUT_LIMIT'),
    rangeMatrixOutputQps:integerSetting(env.BAIDU_RANGE_MATRIX_OUTPUT_QPS,0,0,36,'BAIDU_RANGE_MATRIX_OUTPUT_QPS'),
    timeFieldMatrixOutputLimit:integerSetting(env.BAIDU_TIME_FIELD_MATRIX_OUTPUT_LIMIT,512,0,512,'BAIDU_TIME_FIELD_MATRIX_OUTPUT_LIMIT'),
    matrixOutputLimit: integerSetting(env.BAIDU_MATRIX_OUTPUT_LIMIT, 0, 0, 10000, 'BAIDU_MATRIX_OUTPUT_LIMIT'),
    matrixOutputQps: integerSetting(env.BAIDU_MATRIX_OUTPUT_QPS, 0, 0, 1000, 'BAIDU_MATRIX_OUTPUT_QPS'),
    placeRequestLimit: integerSetting(env.BAIDU_PLACE_PROCESS_LIMIT, 64, 0, 1000, 'BAIDU_PLACE_PROCESS_LIMIT'),
    walkingTaskRequestLimit:integerSetting(env.BAIDU_WALKING_TASK_LIMIT,220,0,220,'BAIDU_WALKING_TASK_LIMIT'),
    completeFacilityPaths:env.BAIDU_COMPLETE_FACILITY_PATHS_ENABLED==null?true:booleanFlag(env.BAIDU_COMPLETE_FACILITY_PATHS_ENABLED,'BAIDU_COMPLETE_FACILITY_PATHS_ENABLED'),
    circleRouteLimit: integerSetting(env.BAIDU_CIRCLE_ROUTE_LIMIT,1000,0,1000,'BAIDU_CIRCLE_ROUTE_LIMIT'),
    routeDecisionLimit: integerSetting(env.BAIDU_ROUTE_PROCESS_LIMIT, 96, 0, 1000, 'BAIDU_ROUTE_PROCESS_LIMIT'),
    taskPlaceLimit: integerSetting(env.BAIDU_PLACE_TASK_LIMIT, 60, 0, 100, 'BAIDU_PLACE_TASK_LIMIT'),
    taskCostLimit: integerSetting(env.BAIDU_ROUTE_COST_TASK_LIMIT, 25, 0, 75, 'BAIDU_ROUTE_COST_TASK_LIMIT'),
    taskDetailLimit: integerSetting(env.BAIDU_ROUTE_DETAIL_TASK_LIMIT, 6, 0, 6, 'BAIDU_ROUTE_DETAIL_TASK_LIMIT'),
    taskRouteLimit: integerSetting(env.BAIDU_ROUTE_TASK_LIMIT, 31, 0, 81, 'BAIDU_ROUTE_TASK_LIMIT'),
    samplingRequestLimit: integerSetting(env.BAIDU_SAMPLING_PROCESS_LIMIT, 176, 0, 220, 'BAIDU_SAMPLING_PROCESS_LIMIT'),
    analysisTimeoutMs: integerSetting(env.ANALYSIS_TIMEOUT_MS, 600000, 1000, 1800000, 'ANALYSIS_TIMEOUT_MS'),
    trafficEnabled: booleanFlag(env.BAIDU_TRAFFIC_ENABLED, 'BAIDU_TRAFFIC_ENABLED'),
    trafficEntitlementVerified: booleanFlag(env.BAIDU_TRAFFIC_ENTITLEMENT_VERIFIED, 'BAIDU_TRAFFIC_ENTITLEMENT_VERIFIED'),
    trafficRequestLimit: integerSetting(env.BAIDU_TRAFFIC_PROCESS_LIMIT, 0, 0, 1000, 'BAIDU_TRAFFIC_PROCESS_LIMIT'),
    aoiEnabled: booleanFlag(env.BAIDU_AOI_ENABLED, 'BAIDU_AOI_ENABLED'),
    aoiEntitlementVerified: booleanFlag(env.BAIDU_AOI_ENTITLEMENT_VERIFIED, 'BAIDU_AOI_ENTITLEMENT_VERIFIED'),
    aoiRequestLimit: integerSetting(env.BAIDU_AOI_PROCESS_LIMIT, 0, 0, 1000, 'BAIDU_AOI_PROCESS_LIMIT'),
    trafficEventsEnabled: booleanFlag(env.BAIDU_TRAFFIC_EVENTS_ENABLED, 'BAIDU_TRAFFIC_EVENTS_ENABLED'),
    trafficEventsEntitlementVerified: booleanFlag(env.BAIDU_TRAFFIC_EVENTS_ENTITLEMENT_VERIFIED, 'BAIDU_TRAFFIC_EVENTS_ENTITLEMENT_VERIFIED'),
    trafficEventsRequestLimit: integerSetting(env.BAIDU_TRAFFIC_EVENTS_PROCESS_LIMIT, 0, 0, 1000, 'BAIDU_TRAFFIC_EVENTS_PROCESS_LIMIT'),
  };
  if (!config.serverAk && (config.isodistanceEnabled || config.isochroneEnabled || config.walkingSamplingFallbackEnabled
    || config.trafficEnabled)) {
    throw new TypeError('A server-side map key is required for enabled live map providers.');
  }
  return Object.freeze(config);
}

export function publicMapFeatureFlags(config) {
  return {
    isodistanceRequestEnabled:config.isodistanceEnabled&&config.isodistanceEntitlementVerified&&config.isochroneRequestLimit>0&&(!config.isochroneExpiresAt||Date.now()<=Date.parse(config.isochroneExpiresAt)),
    walkingModelIds:['baidu-duration-v1','walking80-v1'],
    isochroneRequestEnabled: config.isochroneEnabled
      && config.isochroneEntitlementVerified && config.isochroneRequestLimit > 0 && (!config.isochroneExpiresAt||Date.now()<=Date.parse(config.isochroneExpiresAt)),
    walkingSamplingFallbackEnabled: config.walkingSamplingFallbackEnabled,
    trafficContextEnabled: config.trafficEnabled && config.trafficEntitlementVerified && config.trafficRequestLimit > 0,
    // No production adapters until Baidu confirms exact AOI/event endpoints and response schemas.
    aoiBoundaryEnabled: false,
    trafficEventsEnabled: false,
  };
}
