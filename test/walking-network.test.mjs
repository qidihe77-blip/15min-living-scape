import test from 'node:test';
import assert from 'node:assert/strict';
import { reachableNetworkRoutes, reachableCountBars } from '../web/walking-network.js';
const geometry={type:'LineString',coordinates:[[120,30],[120.001,30],[120.001,30.001]]};
const route=(overrides={})=>({routeStatus:'ok',mode:'walking',coordinateSystem:'BD-09LL',durationSeconds:900,
  distanceMeters:200,facilityUid:'a',classification:{candidateStatus:'confirmed_by_rule'},geometry,...overrides});
test('network accepts actual 900 second paths, rejects 901, invalid geometry, other modes and pending classes',()=>{
  const job={analysis:{categories:[{subtypeResults:[{routes:[route(),route(),route({durationSeconds:901}),
    route({mode:'driving'}),route({geometry:null}),route({geometry:{type:'LineString',coordinates:[[999,30],[120,30]]}}),
    route({classification:{candidateStatus:'pending_review'}})]}]}]}};
  assert.equal(reachableNetworkRoutes(job).length,1);
  assert.deepEqual(reachableNetworkRoutes(job)[0].coordinates,geometry.coordinates);
});
test('disconnected provider paths remain separate and sampled boundary chords never become roads',()=>{
  const job={geojson:{features:[{geometry,properties:{featureType:'uncertain_boundary'}},
    {geometry:{type:'MultiLineString',coordinates:[geometry.coordinates,[[121,31],[121.001,31]]]},
      properties:{...route(),featureType:'reachable_route'}}]}};
  assert.equal(reachableNetworkRoutes(job).length,2);
});
test('bar counts verified reachable UID unions, excludes unknown and uses lower bound for incomplete searches',()=>{
  const categories=[{id:'medical',subtypes:[{id:'hospital'},{id:'pharmacy'}]}];
  const sub=(routes)=>({routes,searchComplete:true,nearestComplete:true,unknownReasons:[]});
  const analysis={categories:[{categoryId:'medical',subtypeResults:[sub([route(),route({facilityUid:null})]),
    sub([route(),route({facilityUid:'b',durationSeconds:901}),route({facilityUid:'c',routeStatus:'timeout'})])]}]};
  assert.deepEqual(reachableCountBars(analysis,categories),[{categoryId:'medical',count:1,complete:true}]);
  analysis.categories[0].subtypeResults[1].nearestComplete=false;
  assert.equal(reachableCountBars(analysis,categories)[0].complete,false);
});
