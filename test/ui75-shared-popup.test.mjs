import test from'node:test';
import assert from'node:assert/strict';
import{gapStackShapes}from'../web/gap-stack-geometry.js';
import{createMapFocus}from'../web/map-focus-a38.js';

test('curved stacked edges preserve percentage areas, share edges and stay ordered for narrow segments',()=>{
 for(const fractions of[[.497,.503],[.4,.2,.15,.25],[.001,.998,.001],[1],[0,1]]){
  const width=747,height=43,shapes=gapStackShapes(fractions,width,height);let total=0;
  for(let i=0;i<shapes.length;i++){const s=shapes[i];let integrated=0;
   for(let j=0;j<1000;j++){const t=(j+.5)/1000,x=e=>e.x+e.bend*(6*t*(1-t)-1),delta=x(s.right)-x(s.left);assert.ok(delta>=-1e-8);integrated+=delta*height/1000;}
   assert.ok(Math.abs(integrated-s.area)<.001);total+=s.area;
   if(i)assert.deepEqual(shapes[i-1].right,s.left);
  }
  assert.ok(Math.abs(total-width*height)<1e-8);
 }
 assert.deepEqual(gapStackShapes([],400,43),[]);assert.deepEqual(gapStackShapes([1],0,43),[]);
});

test('shared POI popup completion waits for camera focus and canceled focus cannot reopen it',()=>{
 const keys=['window','matchMedia','requestAnimationFrame','cancelAnimationFrame'],old=Object.fromEntries(keys.map(k=>[k,globalThis[k]]));
 try{globalThis.window={};globalThis.matchMedia=()=>({matches:false});const frames=[];globalThis.requestAnimationFrame=f=>(frames.push(f),frames.length);globalThis.cancelAnimationFrame=()=>{};
  let center={lng:120,lat:30},zoom=16,view={center:{lng:121,lat:31},zoom:15},opened=[];
  const map={getViewport:()=>view,getCenter:()=>center,getZoom:()=>zoom,setCenter:p=>center=p,setZoom:z=>zoom=z,addEventListener(){},removeEventListener(){}},B={Point:class{constructor(lng,lat){this.lng=lng;this.lat=lat;}}},camera=createMapFocus({map,B,getMargins:()=>[0,0,0,0]});
  camera.focus([view.center],'market',{onComplete:()=>opened.push('market')});assert.deepEqual(opened,[]);frames.shift()(performance.now()+1000);assert.deepEqual(opened,['market']);
  camera.focus([view.center],'same-position',{onComplete:()=>opened.push('same-position')});assert.deepEqual(opened,['market','same-position']);
  view={center:{lng:122,lat:32},zoom:14};camera.focus([view.center],'old',{onComplete:()=>opened.push('old')});const stale=frames.shift();camera.cancel();stale(performance.now()+1000);assert.deepEqual(opened,['market','same-position']);
  camera.focus([view.center],'pharmacy',{animate:false,onComplete:()=>opened.push('pharmacy')});assert.equal(opened.at(-1),'pharmacy');camera.destroy();
 }finally{for(const k of keys){if(old[k]===undefined)delete globalThis[k];else globalThis[k]=old[k];}}
});
