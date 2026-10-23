const B=require('./load2.js');const fs=require('fs');
const rows=B.normRows(JSON.parse(fs.readFileSync('all_rows2.json')));const byId=new Map(rows.map(r=>[r.id,r]));
const names=new Map();rows.forEach(r=>{if(r.agent&&!names.has(r.login))names.set(r.login,r.agent)});
const P=JSON.parse(fs.readFileSync('plan2.json')),RC=JSON.parse(fs.readFileSync('rechain2.json')),TL=JSON.parse(fs.readFileSync('task_links2.json'));
const det=new Map(JSON.parse(fs.readFileSync('task_detail2.json')).map(r=>[r.wira_tasks_wira_task_id,r]));
const round=JSON.parse(fs.readFileSync('live/calibRounds/2026-11-02.json'));const oldItems=new Map(round.items.map(x=>[x.key,x]));
const CW="2026-11-02",NOW=new Date().toISOString(),SAS=Object.keys(P);
const newQ=[],items=[];
for(const sa of SAS)for(const it of P[sa]){
  if(it.k==='CHAT'){items.push(oldItems.get(it.id)||{kind:"chat",key:it.id,sa,restaurant:"",at:"",aiPct:null,_new:true});continue}
  const key='ld-'+it.id;if(oldItems.has(key)){items.push(oldItems.get(key));continue}
  const S=byId.get(it.id),me=S.login;
  const legs=RC[it.id].map(x=>{const l=byId.get(x.id),own=l.login===me,ph=String(l.phone||'');
    const party=ph===S.phone?'caller':/^\d+$/.test(ph)?'…'+ph.slice(-4):(ph.toLowerCase()===me?sa:(names.get(ph.toLowerCase())||ph));
    return Object.assign({id:l.id,at:new Date(l.t0).toISOString().slice(0,19),sec:l.sec,who:own?sa:(l.agent||l.login||'Unknown'),login:l.login,group:own?'graded':'',dir:l.dir,party,own,graded:own,sampled:l.id===S.id,before:l.t0<S.t0},x.ref?{ref:true,refWhy:x.why||''}:{})});
  const ts=legs.map(l=>Date.parse(l.at+'Z')),t0=Math.min(...ts),t1=Math.max(...legs.map((l,i)=>ts[i]+l.sec*1000));
  const ag={name:sa,creators:[],keys:new Set(),nameKey:B.normWho(sa)};
  const tasks=(TL[it.id]||[]).filter(t=>det.has(t.id)).map(t=>B.taskDoc(det.get(t.id),t,ag,B.TASKS));
  const link=S.code?`${B.GD}/restaurant/${encodeURIComponent(S.code)}?caller_id=${encodeURIComponent(S.phone)}&callId=${encodeURIComponent(S.id)}`:`${B.GD}/callrecordings?callIds=${encodeURIComponent(S.id)}`;
  newQ.push([key,{link,agent:sa,type:it.k==="CL"?"call":"mgr",kind:it.k,callDate:B.etDay(S.t0),callTime:B.etClock(S.t0),restaurantId:S.code,restaurantName:S.name,callId:S.id,durationSec:S.sec,
    chain:{legs,count:legs.length,spanSec:Math.round((t1-t0)/1000),talkSec:legs.reduce((t,l)=>t+l.sec,0),ownSec:legs.filter(l=>l.own).reduce((t,l)=>t+l.sec,0),ownCount:legs.filter(l=>l.own).length,agents:new Set(legs.map(l=>l.who)).size,refs:legs.filter(l=>l.ref).length},
    week:CW,pos:0,source:"lightdash",short:false,auditId:null,score:null,removed:false,addedAt:NOW,tasks,tasksAt:NOW,relinkedAt:NOW,pool:"candidates"}]);
  items.push({kind:"call",key,sa,restaurant:S.name,at:new Date(S.t0).toISOString().slice(0,16)})}
// Stephen's chats
const sl=JSON.parse(fs.readFileSync('chat_rows_sl.json')).map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,v&&v.value?v.value.raw:v])));
const chats=sl.map(x=>B.chatRow(x,{roster:[{name:"Stephen Larot"}],staff:{}})).filter(c=>c.wid&&B.isBaseChat(c));
const pickedSl=new Set(P["Stephen Larot"].filter(o=>o.k==='CHAT').map(o=>o.id));
const chatDocs=chats.map(c=>{const d=B.chatQueueDoc(c,pickedSl.has(String(c.sid)));d.week=CW;d.pool="candidates";return [String(c.sid),d]});
items.forEach(x=>{if(x._new){const c=chats.find(c=>String(c.sid)===x.key);x.restaurant=c.restaurant;x.at=String(c.at).slice(0,19);delete x._new}});
const ord=items.sort((a,b)=>SAS.indexOf(a.sa)-SAS.indexOf(b.sa)||(a.kind===b.kind?String(a.at).localeCompare(String(b.at)):a.kind==="chat"?-1:1));
let pos=0;newQ.forEach(q=>q[1].pos=ord.findIndex(x=>x.key===q[0]));
const roundDoc=Object.assign({},round,{sas:SAS,items:ord,redrawnAt:NOW});
fs.writeFileSync('final2.json',JSON.stringify({newQ,chatDocs,roundDoc}));
console.log('new calls',newQ.length,'stephen chats',chatDocs.length,'items',ord.length);SAS.forEach(sa=>console.log(sa,ord.filter(x=>x.sa===sa).map(x=>x.kind==='chat'?'chat':(newQ.find(q=>q[0]===x.key)||[0,{kind:'old'}])[1].kind).join(' ')));
