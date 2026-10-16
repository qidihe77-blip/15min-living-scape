import test from'node:test';import assert from'node:assert/strict';import{readFile}from'node:fs/promises';
import{shapePreservingBoundary,boundaryOffset}from'../server/isochrone-boundary.mjs';
import{validateBoundaryRing,boundaryContainsPoint}from'../web/sample-boundary.js';
const fixture=JSON.parse(await readFile(new URL('./fixtures/walking36-boundary-validation.json',import.meta.url),'utf8'));
test('bounded curvature smoothing preserves all36 knots, containment and existing independent classification',()=>{
 for(const c of fixture.cases){const raw=[...c.knots,[...c.knots[0]]],shape=shapePreservingBoundary(raw,c.origin.location);assert.equal(shape.sourceKnotCount,36);assert.ok(validateBoundaryRing(shape.ring).valid);assert.ok(boundaryContainsPoint(shape.ring,c.origin.location));for(const p of c.knots)assert.ok(shape.ring.some(q=>p[0]===q[0]&&p[1]===q[1]));assert.ok(boundaryOffset(shape.ring,raw,c.origin.location)<=20.001);assert.ok(boundaryOffset(raw,shape.ring,c.origin.location)<=20.001);for(const p of c.validation)assert.equal(boundaryContainsPoint(shape.ring,p.location),boundaryContainsPoint(c.originalRing,p.location));}
});
test('unapproved offset limits are rejected and zero offset stays on original edges',()=>{const c=fixture.cases[0],raw=[...c.knots,[...c.knots[0]]];assert.throws(()=>shapePreservingBoundary(raw,c.origin.location,{maxOffsetMeters:26}));assert.ok(boundaryOffset(shapePreservingBoundary(raw,c.origin.location,{maxOffsetMeters:0}).ring,raw,c.origin.location)<.001);});
