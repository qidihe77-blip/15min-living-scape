import{decisionSeconds}from'./walking-model.js';
export function createFacilityRouteController({ requestDetail, draw, clear, updateJob, onStatus = () => {} }) {
  let sequence = 0, controller = null, selected = null;
  function reset() {
    sequence++; controller?.abort(); controller = null; selected = null; clear();
  }
  async function show({ job, row }) {
    reset(); const current = sequence; selected = { identityKey: row.identityKey, memberships: row.memberships };
    let evidence = row.routeEvidence;
    if (!evidence) { onStatus('该设施尚无有效路线成本。'); return; }
    if (!evidence.geometry) {
      controller = new AbortController(); onStatus('正在获取步行路线…');
      try {
        const detail = await requestDetail(job.analysisId, { evidenceFingerprint: job.score.evidenceFingerprint,
          identityKey: row.identityKey, subtypeId: evidence.subtypeId }, controller.signal);
        if (current !== sequence) return;
        if (detail.job) updateJob(detail.job);
        evidence = detail.route;
        if (detail.routeStatus !== 'ok' || !evidence) { onStatus('路线详情未取得：' + detail.routeStatus); return; }
      } catch (error) {
        if (current === sequence && error.name !== 'AbortError') onStatus(error.message);
        return;
      }
    }
    if (current !== sequence) return;
    if (!evidence.geometry) { onStatus('已有真实距离与耗时，服务未返回有效路径。'); return; }
    draw(evidence, row);
    onStatus(`${row.name} · ${Math.round(evidence.distanceMeters)}米 · ${Math.round(decisionSeconds(evidence))}秒`
      + (decisionSeconds(evidence) > 900 ? ' · 超过15分钟' : ' · 15分钟内可达'));
  }
  function filter(categoryId) {
    if (selected && categoryId !== 'all' && !selected.memberships.includes(categoryId)) reset();
  }
  return { show, clear: reset, filter, get selectedIdentityKey() { return selected?.identityKey ?? null; } };
}
