import test from 'node:test';import assert from 'node:assert/strict';
import {observeMapLayout} from '../web/map-layout.js';
function fixture(){
 let rect={width:900,height:620},callback,frameId=0,frames=new Map(),calls=0,updates=[],disconnected=false;
 const listeners=new Map(),resolutionListeners=new Set();
 const host={devicePixelRatio:1,innerWidth:1366,innerHeight:768,
  requestAnimationFrame(fn){frames.set(++frameId,fn);return frameId;},cancelAnimationFrame(id){frames.delete(id);},
  addEventListener(name,fn){listeners.set(name,fn);},removeEventListener(name){listeners.delete(name);},
  matchMedia(){return {addEventListener(name,fn){resolutionListeners.add(fn);},removeEventListener(name,fn){resolutionListeners.delete(fn);}}},
  ResizeObserver:class{constructor(fn){callback=fn;}observe(){}disconnect(){disconnected=true;}}};
 const map={resize(){calls++;callback();}},container={getBoundingClientRect:()=>rect};
 const observer=observeMapLayout({map,container,host,onResize:s=>updates.push(s)});
 return {observer,host,change(size){rect={...rect,...size};callback();},windowResize(){listeners.get('resize')?.();},
  flush(){const entries=[...frames];frames.clear();for(const [,fn]of entries)fn();},
  snapshot:()=>({calls,updates,frames:frames.size,listeners:listeners.size,disconnected})};
}
test('map container resize is coalesced and SDK resize callbacks cannot cause a loop',()=>{
 const f=fixture();f.change({width:880});f.change({width:850});f.windowResize();f.flush();
 assert.equal(f.snapshot().calls,1);assert.equal(f.snapshot().updates[0].width,850);
 f.flush();assert.equal(f.snapshot().calls,1);assert.equal(f.snapshot().frames,0);
});
test('native browser zoom/DPR and hidden-to-visible container changes update existing map',()=>{
 const f=fixture();f.flush();f.host.devicePixelRatio=1.5;f.host.innerWidth=911;f.windowResize();f.flush();
 assert.equal(f.snapshot().calls,2);assert.equal(f.snapshot().updates.at(-1).dpr,1.5);
 f.change({width:0,height:0});f.flush();assert.equal(f.snapshot().calls,2);
 f.change({width:600,height:410});f.flush();assert.equal(f.snapshot().calls,3);
});
test('map layout observer disposes pending animation and listeners on page exit',()=>{
 const f=fixture();f.observer.dispose();f.change({width:700});f.flush();
 assert.equal(f.snapshot().calls,0);assert.equal(f.snapshot().frames,0);assert.equal(f.snapshot().listeners,0);assert.equal(f.snapshot().disconnected,true);
});
