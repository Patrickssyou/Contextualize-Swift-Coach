// Shared helpers for the facts-eval lane: build case inputs from data/ the same way the page does.
const fs=require('fs'),path=require('path'),C=require('../src/core.js');
const ROOT=path.join(__dirname,'..');
const rd=f=>JSON.parse(fs.readFileSync(path.join(ROOT,f)));
let TX=null;
function transcripts(){if(TX)return TX;TX=new Map();
  for(const f of ['data/fixtures/transcripts_w28.json','data/fixtures/transcripts_raw.json']){try{const j=rd(f);((j.result||j).rows||[]).forEach(r=>TX.set(String(r.calls_conversation_id),String(r.asr_transcript_call_transcript||'')))}catch(e){}}
  try{rd('data/fixtures/bravo_calls.json').result.rows.forEach(r=>{if(!TX.has(r.calls_conversation_id))TX.set(r.calls_conversation_id,r.asr_transcript_call_transcript||'')})}catch(e){}
  return TX}
const load=id=>Object.assign(rd('data/live4/queue/'+id+'.json'),rd('data/backfill2/'+id+'.json'));
function input(ids){const tx=transcripts(),g=ids.map(load),sampled=[...new Set(g.map(x=>x.agent))],legs=new Map();
  g.forEach(x=>x.chain.legs.forEach(l=>{if(!legs.has(l.id))legs.set(l.id,Object.assign({},l))}));
  let all=[...legs.values()].sort((a,b)=>a.at.localeCompare(b.at));
  const helpers=C.caseTeam(all.map(l=>Object.assign({},l,{graded:false,own:false})));
  const isCase=ids.length>1||g[0].type==='case';
  all=all.filter(C.talked).map(l=>({id:l.id,at:l.at,sec:l.sec,who:l.who,graded:sampled.includes(l.who)||isCase&&['sa','pool','crt'].includes(l.group),dir:l.dir,party:l.party,text:tx.get(l.id)||''}));
  const tasks=new Map();g.forEach(x=>(x.tasks||[]).forEach(k=>tasks.set(k.id,k)));
  const q=g[0];
  return {agent:q.agent,kind:q.kind,restaurant:q.restaurantName,code:q.restaurantId,date:q.callDate,legs:all,tasks:[...tasks.values()].sort((a,b)=>a.at.localeCompare(b.at)),
    team:isCase?[...new Set(sampled.concat(helpers))]:[],slack:g.map(x=>x.slack).find(Array.isArray)||[]}}
module.exports={ROOT,rd,input,transcripts};
