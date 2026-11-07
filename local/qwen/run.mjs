import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const child=spawn(process.execPath,[fileURLToPath(new URL('../../node_modules/vite/bin/vite.js',import.meta.url)),'--host','127.0.0.1','--port','4174','--strictPort','--open'],{stdio:'inherit',env:{...process.env,EMT_LOCAL_QWEN:'1'}});
child.on('error',()=>{console.error('로컬 실행 환경을 확인해 주세요.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
