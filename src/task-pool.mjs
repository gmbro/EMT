export function createTaskPool(limit=2){
 let active=0;const waiting=[];
 const drain=()=>{while(active<limit&&waiting.length){const {run,resolve,reject}=waiting.shift();active++;Promise.resolve().then(run).then(resolve,reject).finally(()=>{active--;drain();});}};
 return {run:run=>new Promise((resolve,reject)=>{waiting.push({run,resolve,reject});drain();})};
}
