import {useEffect,useState} from 'react';
export function useLocalQwenReady(enabled){
 const [state,setState]=useState({ready:!enabled,message:enabled?'Qwen 모델을 불러오고 있어요. 첫 실행은 시간이 걸릴 수 있어요.':''});
 useEffect(()=>{
  if(!enabled)return;
  let disposed=false,timer,request;
  async function check(){
   request=new AbortController();const timeout=setTimeout(()=>request.abort(),5000);
   try{
    const response=await fetch('/api/qwen',{signal:request.signal,cache:'no-store'});const body=await response.json();
    if(disposed)return;
    const ready=response.ok&&body.ready===true;
    setState({ready,message:ready?'Qwen 준비 완료 · 이 컴퓨터에서 받아쓰기':body.error||'Qwen 모델을 불러오고 있어요.'});
    if(ready)return;
   }catch{if(!disposed)setState({ready:false,message:'로컬 실행 창을 확인해 주세요. Qwen 연결을 다시 확인하고 있어요.'});}
   finally{clearTimeout(timeout);}
   if(!disposed)timer=setTimeout(check,2000);
  }
  void check();return()=>{disposed=true;clearTimeout(timer);request?.abort();};
 },[enabled]);
 return state;
}
