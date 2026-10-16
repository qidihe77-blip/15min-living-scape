import test from 'node:test';import assert from 'node:assert/strict';
import {prominentMarkerKeys,markerVisual,nearbyMarkerRows} from '../web/marker-presentation.js';
import {FACILITY_ICONS,facilityGlyph,poiIconSvg} from '../web/poi-icons.js';
const row=(id,group,x,status='reachable')=>({identityKey:id,group:{id:group},location:{lng:x,lat:0},status});
const rows=[row('school','education',50),row('school2','education',100),row('pharmacy','medical',54),row('market','commerce',150),row('pending','medical',190,'unknown')];
const nearestKeys=new Set(rows.map(row=>row.identityKey)),project=location=>({x:location.lng,y:location.lat});
test('only verified nearest evidence or explicit selection can create a prominent marker',()=>{
 const original=JSON.stringify(rows),keys=prominentMarkerKeys(rows,{nearestKeys,project});
 assert.deepEqual([...keys],['school','school2','market']);assert.equal(keys.has('pending'),false);
 const selected=prominentMarkerKeys(rows,{nearestKeys,project,selectedKeys:new Set(['pending'])});assert.equal(selected.has('pending'),true);
 assert.equal(JSON.stringify(rows),original);assert.equal(rows.length,5);
});
test('low zoom limits prominence per group; collision and origin downgrade to dots without deleting rows',()=>{
 const low=prominentMarkerKeys(rows,{zoom:14,nearestKeys,project});assert.deepEqual([...low],['school','market']);
 const origin=prominentMarkerKeys(rows,{nearestKeys,project,origin:{lng:50,lat:0}});assert.equal(origin.has('school'),false);
 assert.equal(markerVisual(rows[2],{zoom:14,prominentKeys:low}).important,false);
 assert.deepEqual([14,16,18].map(zoom=>markerVisual(rows[4],{zoom}).dotDiameter),[7,9,10]);
});
test('hover keeps the same dot level and overlap selection preserves all coincident and nearby candidates',()=>{
 const normal=markerVisual(rows[4]),hover=markerVisual(rows[4],{hovered:true});assert.equal(normal.width,18);assert.equal(hover.width,18);
 assert.equal(hover.important,false);assert.equal(normal.important,false);
 assert.deepEqual(nearbyMarkerRows(rows,rows[0].location,{project}).map(row=>row.identityKey),['school','pharmacy']);
 assert.equal(nearbyMarkerRows(rows,rows[0].location).length,1);
});
test('all six filled faces are shared; dots have no icon and feature markers reuse the exact category silhouette',()=>{
 assert.deepEqual(Object.keys(FACILITY_ICONS),['education','medical','commerce','transport','eldercare','leisure']);
 for(const key of Object.keys(FACILITY_ICONS)){const glyph=facilityGlyph(key),svg=poiIconSvg({iconKey:key,important:true,palette:{outline:'#fff',glyph:'#fff'}});
  assert.ok(svg.includes(glyph));assert.match(glyph,/fill="currentColor" stroke="none"/);assert.match(svg,/data-marker-kind="feature"/);}
 const dot=poiIconSvg({iconKey:'education',important:false,dotDiameter:7});assert.match(dot,/data-marker-kind="dot"/);assert.doesNotMatch(dot,/data-facility-face/);
 assert.match(dot,/r="3.5"/);
});
