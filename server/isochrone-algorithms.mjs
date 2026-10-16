import {sampleCenteredWalkingRange,CENTERED_RANGE_VERSION} from './centered-walking-range.mjs';
// One production adapter contract. Experimental planners/fields live outside
// this registry; a future winner must be approved and expose the same evidence
// contract before its ID is admitted here. An env typo cannot silently promote it.
const sampleProduction=options=>{if(options?.directionCount!=null&&options.directionCount!==36)throw new RangeError('Production requires 36 directions.');return sampleCenteredWalkingRange({...options,directionCount:36});};
const approved=new Map([['walking36',Object.freeze({id:'walking36',version:CENTERED_RANGE_VERSION,sample:sampleProduction})]]);
export function productionIsochroneAlgorithm(id='walking36'){
 const algorithm=approved.get(id);if(!algorithm)throw Error('Production isochrone algorithm is not approved: '+id);return algorithm;
}
