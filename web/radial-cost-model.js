// The production estimator fits one proportional radial cost per bearing, bounded
// by its recorded 1200m bisection bracket. Other thresholds evaluate that SAME
// fitted model. These are contour estimates, never additional Walking witnesses.
export function radialCostRadius(model,distanceMeters){
 const {sampleRadiusMeters:r,sampleDistanceMeters:c,referenceDistanceMeters:t,lowRadiusMeters:lo,highRadiusMeters:hi}=model??{};
 if(![r,c,t,lo,hi,distanceMeters].every(Number.isFinite)||r<=0||c<=0||t<=0||lo<0||hi<lo||distanceMeters<=0)return null;
 const referenceRadius=Math.max(lo,Math.min(r*t/c,hi));
 return referenceRadius*distanceMeters/t;
}
