// Builds data/eval/<case>.input.json and the pass-1 prompt for each case.
// Usage: node eval/build_eval.js [tag]   -> writes data/eval/<case>.p1.<tag>.txt (tag defaults to "new")
// To run a prompt: a "sonnet" subagent reads data/eval/<case>.p1.<tag>.txt and writes only its JSON reply to
// data/eval/<case>.p1.<tag>.out.json (mirrors the page's sample call). Then: node eval/score.js current new
const fs=require('fs'),path=require('path'),C=require('../src/core.js'),{ROOT,input}=require('./lib.js'),CASES=require('./cases.js');
const tag=process.argv[2]||'new',out=path.join(ROOT,'data/eval');fs.mkdirSync(out,{recursive:true});
for(const [k,ids] of Object.entries(CASES)){const inp=input(ids);
  fs.writeFileSync(path.join(out,k+'.input.json'),JSON.stringify(inp));
  fs.writeFileSync(path.join(out,`${k}.p1.${tag}.txt`),C.factsPrompt(inp));
  console.log(k.padEnd(18),inp.legs.length,'legs',inp.legs.filter(l=>l.text).length,'text',inp.tasks.length,'tasks',inp.slack.length,'slack',inp.team.join(', '))}
