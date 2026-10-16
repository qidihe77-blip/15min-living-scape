export function createRequestScheduler({concurrency=2,minStartIntervalMs=500,now=Date.now}={}){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>10||!Number.isInteger(minStartIntervalMs)||minStartIntervalMs<0)throw new RangeError('Invalid request scheduler.');
 let active=0,last=-Infinity,timer=null;const queue=[];
 function pump(){if(timer||active>=concurrency||!queue.length)return;const wait=minStartIntervalMs-(now()-last);
  if(wait>0){const head=queue[0],started=now();timer=setTimeout(()=>{head.throttleWaitMs+=Math.max(0,now()-started);timer=null;pump();},wait);return;}
  const item=queue.shift();if(item.signal?.aborted){item.reject(item.signal.reason??new Error('cancelled'));pump();return;}
  active++;last=now();item.onStart?.({queueWaitMs:Math.max(0,now()-item.enqueuedAt),throttleWaitMs:item.throttleWaitMs});Promise.resolve().then(item.operation).then(item.resolve,item.reject).finally(()=>{active--;pump();});pump();
 }
 return(operation,{signal,onStart,priority=0}={})=>new Promise((resolve,reject)=>{const item={operation,signal,onStart,priority:Number.isFinite(priority)?priority:0,enqueuedAt:now(),throttleWaitMs:0,resolve,reject},before=queue.findIndex(q=>q.priority<item.priority);if(before<0)queue.push(item);else queue.splice(before,0,item);pump();});
}
