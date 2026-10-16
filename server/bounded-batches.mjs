// Ordered results with continuously occupied workers; failures drain active work.
export async function orderedBatches(items,operation,{concurrency=1,signal}={}){
 if(!Number.isInteger(concurrency)||concurrency<1||concurrency>10)throw new RangeError('Concurrency must be 1 through 10.');
 const output=new Array(items.length);let next=0,failure,failed=false;
 async function worker(){while(next<items.length&&!failed){if(signal?.aborted){failure=signal.reason??new Error('cancelled');failed=true;break;}const i=next++;try{output[i]=await operation(items[i],i);}catch(e){if(!failed)failure=e;failed=true;}}}
 if(signal?.aborted)throw signal.reason??new Error('cancelled');
 await Promise.all(Array.from({length:Math.min(concurrency,items.length)},worker));if(failed)throw failure;return output;
}
