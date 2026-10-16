import test from'node:test';import assert from'node:assert/strict';
import{outwardRouteLines,pointAtDistance,trailOnPiece,sampleRoutePieces}from'../web/route-flow-a42.js';
import{projectedLine}from'../web/route-flow.js';
const project=([x,y])=>({x,y});
test('outward rendering reverses a copy of a reversed provider path and retains its original vertices',()=>{
 const lines=[[[3,0],[2,0]],[[2,0],[0,0]]],before=structuredClone(lines),result=outwardRouteLines(lines,{location:{lng:0,lat:0}},{location:{lng:3,lat:0}});
 assert.deepEqual(result,[[[0,0],[2,0]],[[2,0],[3,0]]]);assert.deepEqual(lines,before);
});
test('a glow trail follows a real bend rather than cutting straight across it',()=>{
 const line=projectedLine([[0,0],[10,0],[10,10]],project),trail=trailOnPiece(line,18,12);
 assert.deepEqual(trail.map(p=>[p.x,p.y]),[[6,0],[10,0],[10,8]]);assert.deepEqual(pointAtDistance(line,40),{x:10,y:10,index:2});
});
test('disconnected geometry never gains an invented connector or a cross-piece trail',()=>{
 const pieces=[projectedLine([[0,0],[10,0]],project),projectedLine([[100,0],[110,0]],project)],sample=sampleRoutePieces(pieces,15);
 assert.equal(sample.index,1);assert.equal(sample.point.x,105);assert.deepEqual(trailOnPiece(sample.piece,sample.distance,25).map(p=>[p.x,p.y]),[[100,0],[105,0]]);
});
