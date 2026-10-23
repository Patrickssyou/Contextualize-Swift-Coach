const B=require('./load.js');const fs=require('fs');
const rows=B.normRows(JSON.parse(fs.readFileSync('all_rows.json')));const byId=new Map(rows.map(r=>[r.id,r]));
const names=new Map();rows.forEach(r=>{if(r.agent&&!names.has(r.login))names.set(r.login,r.agent)});
const out=JSON.parse(fs.readFileSync('out.json')),RC=JSON.parse(fs.readFileSync('rechain.json')),TL=JSON.parse(fs.readFileSync('task_links.json'));
const det=new Map(JSON.parse(fs.readFileSync('task_detail.json')).map(r=>{r=Object.fromEntries(Object.entries(r).map(([k,v])=>[k,v&&v.value?v.value.raw:v]));return [r.wira_tasks_wira_task_id,r]}));
const now=new Date().toISOString(),docs=[];
for(const [k,q] of out.queue){const S=byId.get(q.callId),me=S.login;
  // SME: keep only the sampled leg and the colleague's call (other SME consults are their own items)
  let L=RC[q.callId];if(q.kind==='SME')L=L.filter(x=>x.id===S.id||x.ref);
  const legs=L.map(x=>{const l=byId.get(x.id),own=l.login===me,ph=String(l.phone||'');
    const party=ph===S.phone?'caller':/^\d+$/.test(ph)?'…'+ph.slice(-4):(ph.toLowerCase()===me?q.agent:(names.get(ph.toLowerCase())||ph));
    return Object.assign({id:l.id,at:new Date(l.t0).toISOString().slice(0,19),sec:l.sec,who:own?q.agent:(l.agent||l.login||'Unknown'),login:l.login,group:own?'graded':'',dir:l.dir,party,own,graded:own,sampled:l.id===S.id,before:l.t0<S.t0},x.ref?{ref:true,refWhy:x.why||''}:{})});
  const t0=Math.min(...legs.map(l=>Date.parse(l.at+'Z'))),t1=Math.max(...legs.map(l=>Date.parse(l.at+'Z')+l.sec*1000));
  const ag={name:q.agent,creators:[],keys:new Set(),nameKey:B.normWho(q.agent)};
  const tasks=(TL[q.callId]||[]).filter(t=>det.has(t.id)).map(t=>B.taskDoc(det.get(t.id),t,ag,B.TASKS));
  const d=Object.assign({},q,{chain:{legs,count:legs.length,spanSec:Math.round((t1-t0)/1000),talkSec:legs.reduce((t,l)=>t+l.sec,0),ownSec:legs.filter(l=>l.own).reduce((t,l)=>t+l.sec,0),ownCount:legs.filter(l=>l.own).length,agents:new Set(legs.map(l=>l.who)).size,refs:legs.filter(l=>l.ref).length},
    tasks,tasksAt:now,relinkedAt:now});
  delete d.aiFacts;docs.push([k,d])}
fs.writeFileSync('newq.json',JSON.stringify(docs));
docs.forEach(([k,d])=>console.log(d.agent.padEnd(15),d.kind,d.chain.count,'legs',d.chain.refs,'ref',d.tasks.length,'tasks'));
