import test from 'node:test';
import assert from 'node:assert/strict';
import {qwenProcessPaths} from '../local/qwen/platform.mjs';
test('Windows uses a separate Python executable and PyTorch worker; Mac retains MLX',()=>{
 const win=qwenProcessPaths('win32'),mac=qwenProcessPaths('darwin');
 assert.match(win.python,/Scripts[/\\]python\.exe$/);assert.match(win.worker,/worker-windows\.py$/);
 assert.match(mac.python,/bin[/\\]python$/);assert.match(mac.worker,/[/\\]worker\.py$/);
});
