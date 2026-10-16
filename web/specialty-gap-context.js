// A bound, read-only1km specialty projection; never alters facility membership,
// Walking costs, the production polygon or score. Old snapshots retain their
// original diagnostic when no scoped projection exists.
import{SPECIALTY_EVIDENCE_VERSION}from'./specialty-gap-evidence.js';
export function specialtyGapContext(job,subtypeId){
 const p=job?.serviceGapEvidence,o=job?.analysis?.origin;
 if(p?.version!=='service-gap-evidence-v1'||p.analysisId!==job.analysisId||p.sourceEvidenceFingerprint!==job.score?.evidenceFingerprint||!Number.isFinite(o?.location?.lng)||!Number.isFinite(o?.location?.lat)||p.origin?.uid!==o.uid||!Number.isFinite(p.origin?.location?.lng)||!Number.isFinite(p.origin?.location?.lat)||Math.abs(p.origin.location.lng-o.location.lng)>1e-6||Math.abs(p.origin.location.lat-o.location.lat)>1e-6)return null;
 return p.specialtyEvidenceVersion===SPECIALTY_EVIDENCE_VERSION?p.specialties?.find(s=>s.subtypeId===subtypeId)??null:null;
}
export function specialtyGapDiagnostic(job,subtypeId){return specialtyGapContext(job,subtypeId)?.diagnostic??job?.serviceGaps?.specialties?.find(s=>s.subtypeId===subtypeId)?.walking_1km_gap;}
