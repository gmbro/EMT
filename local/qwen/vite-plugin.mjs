import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {qwenProcessPaths} from './platform.mjs';
export function qwenLocalPlugin(enabled){
 return {name:'qwen-local-only',apply:'serve',configureServer(server){
  if(!enabled)return;
  let ready=false,failed=false,current=null;
  const paths=qwenProcessPaths();
  const child=spawn(paths.python,[paths.worker],{stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONUTF8:'1',PYTHONIOENCODING:'utf-8',HF_HUB_DISABLE_PROGRESS_BARS:'1'}});
  // Never forward stderr: third-party errors may contain local paths or audio data.
  child.stderr.on('data',()=>{});
  const fail=()=>{ready=false;failed=true;if(current){current.end('data: {"type":"error","message":"Qwen 실행이 중단됐어요."}\n\n');current=null;}};
  child.on('error',fail);child.on('exit',fail);
  createInterface({input:child.stdout}).on('line',line=>{
   try{const event=JSON.parse(line);if(event.type==='ready'){ready=true;return;}
    if(!current)return;current.write(`data: ${JSON.stringify(event)}\n\n`);
    if(['done','error'].includes(event.type)){current.end();current=null;}
   }catch{fail();child.kill();}
  });
  server.httpServer?.on('close',()=>child.kill());
  server.middlewares.use('/api/qwen',async(req,res)=>{
   const send=(status,body)=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify(body));};
   res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
   // Local host AND same-origin are required; reject LAN clients and DNS rebinding.
   const host=req.headers.host||'',remote=req.socket.remoteAddress;
   if(!/^(localhost|127\.0\.0\.1):\d+$/.test(host)||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(remote))return send(403,{error:'Qwen은 이 컴퓨터의 localhost에서만 사용할 수 있어요.'});
   if(req.method==='GET')return send(ready?200:503,{ready,model:'Qwen3-ASR-1.7B',...(!ready?{error:failed?'Qwen 실행 환경을 확인해 주세요.':'Qwen 모델을 불러오고 있어요. 잠시 후 다시 시작해 주세요.'}:{})});
   if(req.method!=='POST'||req.headers.origin!==`http://${host}`)return send(403,{error:'잘못된 요청 출처예요.'});
   if(!String(req.headers['content-type']).startsWith('application/json'))return send(415,{error:'JSON 요청만 지원해요.'});
   if(!ready)return send(503,{error:'Qwen 모델이 아직 준비되지 않았어요.'});
   if(current)return send(429,{error:'Qwen이 이전 음성을 처리 중이에요.'});
   // Reserve before reading so concurrent uploads cannot overwrite current.
   current=res;
   try{let raw='';for await(const part of req){raw+=part;if(raw.length>350000)throw Error('size');}
    const body=JSON.parse(raw);
    if(Object.keys(body).some(k=>!['pcm','language'].includes(k))||!['auto','en-US','ko-KR'].includes(body.language)||typeof body.pcm!=='string'||!/^[A-Za-z0-9+/]+={0,2}$/.test(body.pcm)||body.pcm.length>341336)throw Error('input');
    const bytes=Buffer.from(body.pcm,'base64');if(bytes.length<320||bytes.length>256000||bytes.length%2)throw Error('audio');
    res.setHeader('Content-Type','text/event-stream');res.flushHeaders();
    child.stdin.write(JSON.stringify(body)+'\n');
    const timer=setTimeout(()=>{fail();child.kill();},45000);res.on('finish',()=>clearTimeout(timer));
   }catch{current=null;send(400,{error:'음성 입력 형식을 확인해 주세요.'});}
  });
 }};
}
