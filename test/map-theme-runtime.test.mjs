import test from 'node:test';import assert from 'node:assert/strict';
import {createMapThemeRuntime} from '../web/map-theme-runtime.js';
function harness(){const listeners=new Map(),timers=new Map(),calls=[],states=[];let id=0,tiles=0,now=0;
 const map={addEventListener:(name,fn)=>listeners.set(name,fn),removeEventListener:(name,fn)=>{if(listeners.get(name)===fn)listeners.delete(name);},
  setMapStyleV2:(config)=>calls.push(config)};
 const runtime=createMapThemeRuntime(map,{styleIds:{dark:'dark-existing-id',light:'light-existing-id'},onState:state=>states.push(state),
  onTilesReady:()=>tiles++,setTimer:(fn,delay)=>{timers.set(++id,{fn,delay,due:now+delay});return id;},clearTimer:key=>timers.delete(key)});
 const fire=(delay)=>{for(const [key,timer] of [...timers])if(timer.delay===delay){timers.delete(key);timer.fn();}};
 const advance=delta=>{const end=now+delta;let next;while((next=[...timers].filter(([,t])=>t.due<=end).sort((a,b)=>a[1].due-b[1].due)[0])){
  const [key,timer]=next;now=timer.due;timers.delete(key);timer.fn();}now=end;};
 return {map,runtime,listeners,timers,calls,states,fire,advance,tiles:()=>tiles};}
test('style never blocks first basemap; queued theme uses latest choice and original ID',()=>{
 const h=harness();h.runtime.select('dark');h.runtime.select('light');assert.deepEqual(h.calls,[]);
 h.listeners.get('tilesloaded')();assert.deepEqual(h.calls,[{styleId:'light-existing-id'}]);assert.equal(h.tiles(),1);
 h.listeners.get('tilesloaded')();assert.equal(h.calls.length,1);h.listeners.get('style_loaded')();
 assert.equal(h.runtime.getState().status,'applied');assert.equal(h.timers.size,0);
 h.runtime.select('light');assert.equal(h.calls.length,1);
});
test('stalled remote style falls back once on same map; only explicit retry makes another custom request',()=>{
 const h=harness();h.runtime.select('dark');h.listeners.get('tilesloaded')();h.fire(30000);
 assert.deepEqual(h.calls,[{styleId:'dark-existing-id'},'default']);assert.equal(h.runtime.getState().status,'fallback');
 h.listeners.get('style_loaded')();h.fire(30000);h.runtime.select('dark');assert.equal(h.calls.length,2);
 h.runtime.retry();assert.deepEqual(h.calls[2],{styleId:'dark-existing-id'});assert.equal(h.calls.length,3);
});
test('switching or disposing clears stale timeout; initial tile timeout does not trigger any API loop',()=>{
 const h=harness();h.runtime.select('dark');h.fire(25000);assert.equal(h.runtime.getState().status,'basemap_timeout');assert.equal(h.calls.length,0);
 h.listeners.get('tilesloaded')();const oldTimer=[...h.timers.values()].find(timer=>timer.delay===30000);
 h.runtime.select('light');oldTimer.fn();assert.equal(h.calls.length,2);assert.ok(h.calls.every(c=>typeof c==='object'));
 h.runtime.dispose();h.fire(30000);assert.equal(h.timers.size,0);assert.equal(h.listeners.size,0);assert.equal(h.runtime.select('dark'),false);
});
test('SDK style exception uses bounded basic fallback without losing map reference',()=>{
 const h=harness();h.map.setMapStyleV2=config=>{h.calls.push(config);if(typeof config==='object')throw new Error('SDK style unavailable');};
 h.runtime.select('dark');h.listeners.get('tilesloaded')();assert.deepEqual(h.calls,[{styleId:'dark-existing-id'},'default']);
 assert.equal(h.runtime.getState().status,'fallback');assert.equal(h.timers.size,0);
});
test('a valid cold style response after the previous eight-second deadline completes without cancellation',()=>{
 const h=harness();h.runtime.select('dark');h.listeners.get('tilesloaded')();h.advance(9100);
 assert.equal(h.runtime.getState().status,'loading_style');assert.deepEqual(h.calls,[{styleId:'dark-existing-id'}]);
 h.listeners.get('style_loaded')();h.advance(30000);
 assert.equal(h.runtime.getState().status,'applied');assert.equal(h.calls.length,1);assert.equal(h.timers.size,0);
});
