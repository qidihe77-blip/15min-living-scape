import test from 'node:test';import assert from 'node:assert/strict';
import {installBaiduStyleTimeout} from '../web/map-style-transport.js';
function environment(){const values=new WeakMap();class XHR {
 constructor(){values.set(this,0);this.openCalls=[];}
 open(...args){this.openCalls.push(args);}
 get timeout(){return values.get(this);}set timeout(value){values.set(this,value);}
 }return {XMLHttpRequest:XHR,location:{href:'http://localhost:4173/'}};}
test('SDK 10-second style timeout becomes25seconds without changing request method, URL, or callback arguments',()=>{
 const w=environment(),adapter=installBaiduStyleTimeout(w),xhr=new w.XMLHttpRequest();
 const url='https://api.map.baidu.com/custom/v2/mapstyle';xhr.open('POST',url,true);xhr.timeout=10000;
 assert.equal(xhr.timeout,25000);assert.deepEqual(xhr.openCalls,[['POST',url,true]]);assert.equal(adapter.installed,true);
 xhr.timeout=40000;assert.equal(xhr.timeout,40000);xhr.timeout=0;assert.equal(xhr.timeout,0);adapter.dispose();
});
test('Place, Route, other hosts, other style paths and methods keep their original timeout',()=>{
 const w=environment(),adapter=installBaiduStyleTimeout(w);
 for(const [method,url] of [['GET','https://api.map.baidu.com/place/v3/around'],['POST','https://api.map.baidu.com/directionlite/v1/walking'],
 ['POST','https://other.example/custom/v2/mapstyle'],['POST','https://api.map.baidu.com/custom/v3/mapstyle'],['GET','https://api.map.baidu.com/custom/v2/mapstyle']]){
  const xhr=new w.XMLHttpRequest();xhr.open(method,url,true);xhr.timeout=10000;assert.equal(xhr.timeout,10000);
 }adapter.dispose();
});
test('reused XHR restores requested timeout; repeated installation and disposal do not stack overrides',()=>{
 const w=environment(),open=w.XMLHttpRequest.prototype.open,descriptor=Object.getOwnPropertyDescriptor(w.XMLHttpRequest.prototype,'timeout');
 const first=installBaiduStyleTimeout(w);assert.equal(installBaiduStyleTimeout(w),first);
 const xhr=new w.XMLHttpRequest();xhr.open('POST','https://api.map.baidu.com/custom/v2/mapstyle');xhr.timeout=10000;
 xhr.open('GET','https://api.map.baidu.com/place/v3/around');assert.equal(xhr.timeout,10000);
 first.dispose();assert.equal(w.XMLHttpRequest.prototype.open,open);assert.equal(Object.getOwnPropertyDescriptor(w.XMLHttpRequest.prototype,'timeout').set,descriptor.set);
 const fresh=new w.XMLHttpRequest();fresh.open('POST','https://api.map.baidu.com/custom/v2/mapstyle');fresh.timeout=10000;assert.equal(fresh.timeout,10000);
});
test('unsupported XHR environment degrades without modifying it; invalid limits are rejected',()=>{
 assert.equal(installBaiduStyleTimeout({}).installed,false);assert.throws(()=>installBaiduStyleTimeout(environment(),{timeoutMs:60000}),RangeError);
});
test('local cache reroutes only generated stylePOST; source style parameters and all other SDK endpoints stay unchanged',()=>{
 const w=environment();installBaiduStyleTimeout(w,{localStyleEndpoint:'/api/map-style'});const x=new w.XMLHttpRequest();
 x.open('POST','https://api.map.baidu.com/custom/v2/mapstyle');assert.equal(x.openCalls.at(-1)[1],'/api/map-style');
 x.open('GET','https://api.map.baidu.com/custom/v2/mapstyle');assert.equal(x.openCalls.at(-1)[1],'https://api.map.baidu.com/custom/v2/mapstyle');
 x.open('POST','https://api.map.baidu.com/place/v2/search');assert.equal(x.openCalls.at(-1)[1],'https://api.map.baidu.com/place/v2/search');
});
