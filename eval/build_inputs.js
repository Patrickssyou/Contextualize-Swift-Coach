const fs=require('fs'),C=require('../src/core.js');
const tx=new Map();
for(const f of ['data/fixtures/transcripts_w28.json','data/fixtures/transcripts_raw.json']){try{const j=JSON.parse(fs.readFileSync(f));((j.result||j).rows||[]).forEach(r=>tx.set(String(r.calls_conversation_id),String(r.asr_transcript_call_transcript||'')))}catch(e){}}
try{JSON.parse(fs.readFileSync('data/fixtures/bravo_calls.json')).result.rows.forEach(r=>{if(!tx.has(r.calls_conversation_id))tx.set(r.calls_conversation_id,r.asr_transcript_call_transcript||'')})}catch(e){}
const load=id=>Object.assign(JSON.parse(fs.readFileSync('data/live4/queue/'+id+'.json')),JSON.parse(fs.readFileSync('data/backfill2/'+id+'.json')));
function input(ids,name){const g=ids.map(load),sampled=[...new Set(g.map(x=>x.agent))],legs=new Map();
  g.forEach(x=>x.chain.legs.forEach(l=>{if(!legs.has(l.id))legs.set(l.id,Object.assign({},l))}));
  let all=[...legs.values()].sort((a,b)=>a.at.localeCompare(b.at));
  const helpers=C.caseTeam(all.map(l=>Object.assign({},l,{graded:false,own:false})));
  const isCase=ids.length>1||g[0].type==='case';
  all=all.filter(C.talked).map(l=>({id:l.id,at:l.at,sec:l.sec,who:l.who,graded:sampled.includes(l.who)||isCase&&['sa','pool','crt'].includes(l.group),dir:l.dir,party:l.party,text:tx.get(l.id)||''}));
  const tasks=new Map();g.forEach(x=>(x.tasks||[]).forEach(k=>tasks.set(k.id,k)));
  const q=g[0];
  return {agent:q.agent,kind:q.kind,restaurant:q.restaurantName,code:q.restaurantId,date:q.callDate,legs:all,tasks:[...tasks.values()].sort((a,b)=>a.at.localeCompare(b.at)),
    team:isCase?[...new Set(sampled.concat(helpers))]:[],slack:g.map(x=>x.slack).find(Array.isArray)||[]}}
const cases={cj:['ld-923fbe88-3aca-481b-82b0-b5e29bce7e19'],velka:['ld-246d9767-913b-42db-b426-9afd181bd13d','ld-233e17d2-cbf1-4207-ba6b-592cf62c1134']};
for(const [k,ids] of Object.entries(cases)){const inp=input(ids);fs.writeFileSync(`data/gen2/${k}.input.json`,JSON.stringify(inp));
  fs.writeFileSync(`data/gen2/${k}.p1.txt`,C.factsPrompt(inp));console.log(k,inp.legs.length,'legs',inp.legs.filter(l=>l.text).length,'with text',inp.tasks.length,'tasks',inp.slack.length,'slack',inp.team)}
