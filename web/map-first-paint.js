// Latest task wins per layer. Yield to the real styled basemap paint before expensive libraries.
export function createMapFirstPaintQueue({schedule=setTimeout,cancel=clearTimeout,timeoutMs=8000}={}){
 const tasks=new Map();let ready=false,disposed=false;
 function release(key){const pending=tasks.get(key);if(!pending||disposed)return;cancel(pending.timer);tasks.delete(key);schedule(pending.task,0);}
 return{enqueue(key,task){if(disposed)return;if(ready){schedule(task,0);return;}if(tasks.has(key))cancel(tasks.get(key).timer);const entry={task,timer:null};tasks.set(key,entry);entry.timer=schedule(()=>release(key),timeoutMs);},cancel(key){const t=tasks.get(key);if(t){cancel(t.timer);tasks.delete(key);}},flush(){ready=true;for(const key of tasks.keys())release(key);},dispose(){disposed=true;for(const t of tasks.values())cancel(t.timer);tasks.clear();}};
}
