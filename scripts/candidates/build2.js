const B=require('./load2.js'),fs=require('fs');
const CW="2026-11-02",NOW=new Date().toISOString();
const NAMES={"Joana Tormis":"Joana Tormis","Lou Rabina":"Lourdes Rabina","Nichole Alanano":"Nichole Alanano","Reese Rendal":"Reese Rendal","Rolence Vinas Gd":"Rolence Vinas","Stephen Larot":"Stephen Larot"};
const SAS=["Joana Tormis","Lourdes Rabina","Nichole Alanano","Rolence Vinas","Reese Rendal","Stephen Larot"];
const raw=JSON.parse(fs.readFileSync('call_rows2.json'));const fullOf=new Map(raw.map(x=>[String(x.calls_conversation_id),x.internal_users_full_name]));
const lineOf=r=>r.dir!=="in"?null:r.kind||(/subject_matter_expert/.test(r.skills)?"SME":/^(new_customer; )?green_dot$/.test(r.skills.trim())?"OT":null);
const rows=B.normRows(raw).map(r=>Object.assign(r,{kind:lineOf(r)})).filter(r=>r.kind&&r.sec>=60&&r.t0>=Date.parse('2026-09-23T00:00:00Z'));
const old=JSON.parse(fs.readFileSync('out.json'));const oldRound=old.round;const oldQ=new Map(JSON.parse(fs.readFileSync('newq.json')));
const inRound=new Set(oldRound.items.map(x=>x.kind==="call"?x.key.slice(3):x.key));
// chats: Joana's (kept) and Stephen's
const chatsOf=(file,name)=>JSON.parse(fs.readFileSync(file)).map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,v&&v.value?v.value.raw:v]))).map(x=>B.chatRow(x,{roster:[{name}],staff:{}})).filter(c=>c.wid&&B.isBaseChat(c));
const CH={"Joana Tormis":chatsOf('chat_rows.json',"Joana Tormis"),"Stephen Larot":chatsOf('chat_rows_sl.json',"Stephen Larot")};
const ORDER=["CL","CHAT","DE","MGR","OT","SME"],MAX=3,N=6;
const pick=(L,key)=>{const a=L.filter(x=>inRound.has(key(x)));const b=L.filter(x=>!inRound.has(key(x))).slice(0,12).sort((x,y)=>B.fnv(key(x)+"|cand")-B.fnv(key(y)+"|cand"));return a.concat(b)};
const plan={};
for(const sa of SAS){const mine=rows.filter(r=>NAMES[fullOf.get(r.id)]===sa).sort((x,y)=>y.t0-x.t0),out=[];
  for(const k of ORDER){if(out.length>=N)break;
    const L=k==="CHAT"?pick((CH[sa]||[]).filter(B.chatGradable).sort((a,b)=>String(b.at).localeCompare(String(a.at))),c=>String(c.sid)):pick(mine.filter(r=>r.kind===k),r=>r.id);
    L.slice(0,Math.min(MAX,N-out.length)).forEach(x=>out.push({k,x}))}
  plan[sa]=out;console.log(sa.padEnd(15),out.map(o=>o.k+(inRound.has(o.k==="CHAT"?String(o.x.sid):o.x.id)?"":"*")).join(' '))}
fs.writeFileSync('plan2.json',JSON.stringify(Object.fromEntries(Object.entries(plan).map(([sa,l])=>[sa,l.map(o=>({k:o.k,id:o.k==="CHAT"?String(o.x.sid):o.x.id}))]))));
const keep=new Set(Object.values(plan).flat().map(o=>o.k==="CHAT"?String(o.x.sid):o.x.id));
console.log('dropped from round:',oldRound.items.filter(x=>!keep.has(x.kind==="call"?x.key.slice(3):x.key)).map(x=>x.sa+' '+x.key).join(', '));
