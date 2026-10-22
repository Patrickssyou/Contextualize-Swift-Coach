const fs=require('fs'),vm=require('vm');
const ctx={console,setTimeout,clearTimeout,Date,Math,JSON,URL,TextEncoder,TextDecoder};ctx.globalThis=ctx;vm.createContext(ctx);
const src=fs.readFileSync(__dirname+'/brain_src.js','utf8');
// expose top-level const/let/function by appending an export list
const names=[...new Set([...src.matchAll(/^(?:async\s+)?(?:function\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=)/gm)].map(m=>m[1]||m[2]))];
vm.runInContext(src+'\n;globalThis.__B={'+names.map(n=>`${n}:typeof ${n}!=="undefined"?${n}:undefined`).join(',')+'};',ctx);
module.exports=ctx.__B;
