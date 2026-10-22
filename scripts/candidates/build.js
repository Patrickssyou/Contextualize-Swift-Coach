const B=require('./load.js'),fs=require('fs');
const CW="2026-11-02",NOW=new Date().toISOString();
const NAMES={"Joana Tormis":"Joana Tormis","Lou Rabina":"Lourdes Rabina","Nichole Alanano":"Nichole Alanano","Reese Rendal":"Reese Rendal","Rolence Vinas Gd":"Rolence Vinas"};
const SAS=["Joana Tormis","Lourdes Rabina","Nichole Alanano","Rolence Vinas","Reese Rendal"];
// calls: same normalising as the desk; SME counts as a support line here
const raw=JSON.parse(fs.readFileSync('call_rows.json'));
const rows=B.normRows(raw).map(r=>Object.assign(r,{kind:r.kind||(/subject_matter_expert/.test(r.skills)&&r.dir==="in"?"SME":null)}));
const agentOf=r=>NAMES[raw.find(x=>String(x.calls_conversation_id)===r.id).internal_users_full_name];
const by={};rows.forEach(r=>{if(!r.kind||r.sec<60)return;const a=agentOf(r);(by[a]=by[a]||[]).push(r)});
const want={"Joana Tormis":3};
const queue=[],items=[];let pos=0;
for(const sa of SAS){const L0=(by[sa]||[]).slice().sort((x,y)=>y.t0-x.t0);const L=[];["CL","MGR","DE","SME"].forEach(k=>L.push(...L0.filter(r=>r.kind===k).slice(0,12).sort((x,y)=>B.fnv(x.id+"|cand")-B.fnv(y.id+"|cand"))));
  const n=want[sa]||6,pick=[];const kinds=["CL","MGR","DE","SME"];
  // spread across lines: take in turns from each line the agent has
  const pools=kinds.map(k=>L.filter(r=>r.kind===k)).filter(p=>p.length);let i=0;while(pick.length<n&&pools.some(p=>p.length)){const p=pools[i%pools.length];if(p.length)pick.push(p.shift());i++}
  for(const S of pick.sort((a,b)=>a.t0-b.t0)){const id="ld-"+S.id,at=new Date(S.t0).toISOString().slice(0,19);
    const link=S.code?`${B.GD}/restaurant/${encodeURIComponent(S.code)}?caller_id=${encodeURIComponent(S.phone)}&callId=${encodeURIComponent(S.id)}`:`${B.GD}/callrecordings?callIds=${encodeURIComponent(S.id)}`;
    queue.push([id,{link,agent:sa,type:S.kind==="CL"?"call":"mgr",kind:S.kind,callDate:B.etDay(S.t0),callTime:B.etClock(S.t0),restaurantId:S.code,restaurantName:S.name,callId:S.id,durationSec:S.sec,
      chain:{legs:[{id:S.id,at,sec:S.sec,who:sa,login:S.login,group:"graded",dir:S.dir,party:"caller",own:true,graded:true,sampled:true,before:false}],count:1,spanSec:S.sec,talkSec:S.sec,ownSec:S.sec,ownCount:1,agents:1},
      week:CW,pos:pos++,source:"lightdash",short:false,auditId:null,score:null,removed:false,addedAt:NOW,tasks:null,tasksAt:null,pool:"candidates"}]);
    items.push({kind:"call",key:id,sa,restaurant:S.name,at:at.slice(0,16)})}}
// Joana's chats: the desk's own chat parser; the 3 picked from her 10 most recent gradable chats
const crow=JSON.parse(fs.readFileSync('chat_rows.json'));
const chats=crow.map(x=>B.chatRow(x,{roster:[{name:"Joana Tormis"}],staff:{}})).filter(c=>c.wid&&B.isBaseChat(c));
const grad=chats.filter(B.chatGradable).sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,10).sort((a,b)=>B.fnv(String(a.sid)+"|cand")-B.fnv(String(b.sid)+"|cand")).slice(0,3);
const chatDocs=chats.map(c=>{const d=B.chatQueueDoc(c,grad.includes(c));d.week=CW;d.pool="candidates";return [String(c.sid),d]});
grad.sort((a,b)=>String(a.at).localeCompare(String(b.at))).forEach(c=>items.unshift({kind:"chat",key:String(c.sid),sa:"Joana Tormis",restaurant:c.restaurant,at:String(c.at).slice(0,19),aiPct:null}));
// keep chats first per person, in roster order
const ord=items.sort((a,b)=>SAS.indexOf(a.sa)-SAS.indexOf(b.sa)||(a.kind===b.kind?String(a.at).localeCompare(String(b.at)):a.kind==="chat"?-1:1));
fs.writeFileSync('out.json',JSON.stringify({queue,chatDocs,round:{week:CW,drawnAt:NOW,by:"u_VOEiTPupLO1Hnywf8EMeuA",sas:SAS,items:ord,pool:"candidates",label:"SA candidates"},
  index:{week:CW,at:NOW,by:"u_VOEiTPupLO1Hnywf8EMeuA",chats:chatDocs.length,picked:grad.length,pool:"candidates"}}));
console.log('chats parsed',chats.length,'gradable',chats.filter(B.chatGradable).length,'picked',grad.map(c=>c.sid+' '+c.restaurant+' '+c.at));
SAS.forEach(sa=>console.log(sa,ord.filter(x=>x.sa===sa).map(x=>x.kind+(x.kind==='call'?':'+queue.find(q=>q[0]===x.key)[1].kind:'')).join(' ')));
console.log('chat doc kb',Math.round(JSON.stringify(chatDocs).length/1024),'sa field',chats[0].sa);
