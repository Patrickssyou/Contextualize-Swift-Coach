/* PULL-CORE START */
const PULL = {server:"Lightdash", project:"e03ba889-b1c8-41d0-bb71-f480de3bf1aa", explore:"calls",
  perAgent:5, cl:3, mgrde:2, minSec:60, gapMin:10, spanMin:60, readyHours:10, chunk:200, cap:1000};
const GD = "https://greendot.prod.letsdowonders.io/greendot";
/* creators: how WIRA records each agent as a task's creator (exact text, used in the Lightdash filter) */
const ROSTER_DEFAULT = [
  {name:"Brix Estrope", logins:["bestropegd","zzbestrope","bestrope","zzbestropecb"], creators:["brixestropewonderscocom","zzbestrope"]},
  {name:"Velka Pasion", logins:["vpasiongd","zzvpasion","vpasion","zzvpasioncb"], creators:["velkapassionwonderscocom","zzvpasion"]},
  {name:"Christ Aragon", logins:["zzcaragon","caragongd","caragon","zzcaragoncb","caragononline"], creators:["christaragonwonderscocom"]},
  {name:"Cherry Balonio", logins:["zzcbalonio","cbaloniogd","cbalonio"], creators:["cherrybaloniowonderscocom"]},
  {name:"CJ Domingo", logins:["cjdomingogd","zzcjdomingo"], creators:["cjdomingowonderscocom"]},
  {name:"Angel Lacsamana", logins:["zzalacsamana","alacsamanagd"], creators:["marlaangelalacsamanawondersco","Angel Lacsamana"]}];
/* Who can appear in a linked call. The sampled Super Agent is graded on their own calls; everyone else in the chain is context.
   positions: exact Lightdash position names; positionContains: any position containing the text; include / exclude: logins */
const SCOPE_DEFAULT = {positions:["Pizza Super Agent"], positionContains:["CSR"], include:["zzyarcan","zzjdelara","zzjtormis"], exclude:["zzwsuaboksan"]};
const LD_DIMS = ["calls_conversation_id","calls_call_started_at_est","calls_call_duration_in_seconds","internal_users_user_login_name","internal_users_full_name",
  "internal_users_position_name","calls_call_type","calls_call_skills_required","calls_call_phone_detail","calls_restaurant_id","restaurants_unique_code",
  "restaurants_english_name","calls_call_status"];

/* Lightdash returns Eastern wall-clock time with a Z suffix; keep it as wall-clock (read and print in UTC) */
function ldTs(v){const m=String(v??"").trim().match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(:\d{2})?/);return m?Date.parse(m[1]+"T"+m[2]+(m[3]||":00")+"Z"):NaN}
const etDay = ms => new Date(ms).toISOString().slice(0,10);
const etClock = ms => new Date(ms).toISOString().slice(11,16);
function addDaysU(s,n){const [y,m,d]=String(s).split("-").map(Number);return new Date(Date.UTC(y,m-1,d+n)).toISOString().slice(0,10)}
const isPhone = p => /^\+?\d{7,15}$/.test(p);
const cleanName = s => String(s||"").replace(/[*^]/g,"").replace(/\s+/g," ").trim();
const cleanAgent = s => String(s||"").replace(/(\s+(gd|sme))+\s*$/i,"").replace(/\s+/g," ").trim();
const ldVal = v => /^[A-Za-z0-9_-]+$/.test(v) ? v : '"'+String(v).replace(/["\\]/g,"\\$&")+'"';
function fnv(s){let h=0x811c9dc5;for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,0x01000193)>>>0}return h>>>0}

function kindOf(dir,skills){if(dir!=="in")return null;return /\bclient\b/.test(skills)?"CL":/\bmanager\b/.test(skills)?"MGR":/\bdelivery_enabled\b/.test(skills)?"DE":null}
function normRows(raw){
  const seen=new Map();
  (raw||[]).forEach(x=>{const id=x&&x.calls_conversation_id;if(!id||seen.has(String(id)))return;
    const t0=ldTs(x.calls_call_started_at_est);if(isNaN(t0))return;
    const sec=Math.max(0,Math.round(Number(x.calls_call_duration_in_seconds)||0)),ty=x.calls_call_type,dir=ty==="inbound_call"?"in":ty==="outbound_call"?"out":"";
    const skills=String(x.calls_call_skills_required||"");
    seen.set(String(id),{id:String(id),t0,t1:t0+sec*1000,sec,login:String(x.internal_users_user_login_name||"").trim().toLowerCase(),dir,skills,kind:kindOf(dir,skills),
      phone:String(x.calls_call_phone_detail??"").trim(),rid:String(x.calls_restaurant_id||""),code:String(x.restaurants_unique_code||"").trim().toUpperCase(),
      name:cleanName(x.restaurants_english_name),status:String(x.calls_call_status||""),agent:cleanAgent(x.internal_users_full_name),pos:String(x.internal_users_position_name||"").trim()})});
  return [...seen.values()].sort((a,b)=>a.t0-b.t0||(a.id<b.id?-1:1));
}
const normWho = s => String(s||"").toLowerCase().replace(/[^a-z0-9]/g,"");
function makeRoster(list,scope){
  const agents=(list||[]).map(a=>{const name=String(a.name||"").trim(),def=ROSTER_DEFAULT.find(d=>d.name===name)||{};
    return {name,logins:[...new Set((a.logins||[]).map(l=>String(l).trim().toLowerCase()).filter(Boolean))],
      creators:[...new Set((Array.isArray(a.creators)?a.creators:def.creators||[]).map(c=>String(c).trim()).filter(Boolean))]}}).filter(a=>a.name&&a.logins.length);
  const byLogin=new Map();agents.forEach(a=>{a.set=new Set(a.logins);a.logins.forEach(l=>byLogin.set(l,a.name));
    a.keys=new Set(a.creators.map(normWho).concat(a.logins.map(normWho)).filter(Boolean));a.nameKey=normWho(a.name)});
  const sc=Object.assign({},SCOPE_DEFAULT,scope&&typeof scope==="object"?scope:{}),low=a=>(Array.isArray(a)?a:[]).map(x=>String(x).trim().toLowerCase()).filter(Boolean);
  return {agents,byLogin,logins:[...byLogin.keys()],names:new Map(),groups:new Map(),
    scope:{positions:new Set(low(sc.positions)),contains:low(sc.positionContains),include:new Set(low(sc.include)),exclude:new Set(low(sc.exclude))}};
}
/* sa: Super Agent · pool: shared Super Agent seat · crt: Customer Resolution · csr: CSR · other: included by login · null: left out of linked calls */
function groupOf(r,R){
  const l=r.login,S=R.scope;if(!l||S.exclude.has(l))return null;
  if(R.byLogin.has(l))return "sa";
  const p=String(r.pos||"").toLowerCase(),seat=/^gdpizza/.test(l);
  if(S.positions.has(p))return seat?"pool":"sa";
  if(S.include.has(l)||S.contains.some(c=>p.includes(c)))return p.includes("customer resolution")?"crt":p.includes("csr")?"csr":p.includes("super agent")?(seat?"pool":"sa"):"other";
  return null;
}
function scopeRows(rows,R){return rows.filter(r=>{const g=groupOf(r,R);if(!g)return false;r.group=g;R.groups.set(r.login,g);if(r.agent&&!R.names.has(r.login))R.names.set(r.login,r.agent);return true})}
function whoOf(login,R){login=String(login||"").toLowerCase();if(!login)return "Unknown";
  if(R.byLogin.has(login))return R.byLogin.get(login);
  if(R.groups.get(login)==="pool")return "SA pool "+login.replace(/^gdpizza/,"").toUpperCase();
  return R.names.get(login)||login}

/* A chain starts at the sampled call and keeps adding calls, within gapMin of the chain so far and spanMin of the sampled call, when
   (1) the same agent handled it for a restaurant already in the chain (any number), or
   (2) it was to or from a phone number already in the chain, or
   (3) the agent placed it as an internal call (the other side shows the agent's login as the number). */
function buildChain(S,rows,L,o){
  const gap=o.gapMin*60e3,cap=o.spanMin*60e3,lo=S.t0-cap,hi=S.t1+cap;
  const pool=rows.filter(r=>r.id!==S.id&&r.t0<=hi&&r.t1>=lo);
  const got=new Map([[S.id,S]]),nums=new Set(isPhone(S.phone)?[S.phone]:[]),rids=new Set(S.rid?[S.rid]:[]);
  let a=S.t0,b=S.t1,grew=true;
  while(grew){grew=false;
    for(const r of pool){
      if(got.has(r.id)||r.t0>b+gap||r.t1<a-gap)continue;
      const own=L.has(r.login);
      if(!((own&&r.rid&&rids.has(r.rid))||(isPhone(r.phone)&&nums.has(r.phone))||L.has(r.phone.toLowerCase())))continue;
      got.set(r.id,r);if(isPhone(r.phone))nums.add(r.phone);if(r.rid&&own)rids.add(r.rid);
      if(r.t0<a)a=r.t0;if(r.t1>b)b=r.t1;grew=true;
    }
  }
  return [...got.values()].sort((x,y)=>x.t0-y.t0||(x.id<y.id?-1:1));
}
/* Candidates: the agent's inbound CL / MGR / DE calls that started in the week (Eastern), each with its linked call.
   Eligible when the agent's own talk time across the linked call is at least minSec; the rest are short and only top up an agent who'd otherwise get fewer than perAgent. */
function candidatesFor(ag,w,rows,o){
  const end=addDaysU(w,6),out=[];
  rows.forEach(S=>{if(!S.kind||!ag.set.has(S.login))return;const d=etDay(S.t0);if(d<w||d>end)return;
    const legs=buildChain(S,rows,ag.set,o),own=legs.reduce((t,l)=>t+(ag.set.has(l.login)?l.sec:0),0);
    out.push({S,legs,own,short:own<o.minSec,h:fnv(S.id+"|"+w)})});
  return out.sort((x,y)=>x.h-y.h||(x.S.id<y.S.id?-1:1));
}
function eligibleFor(ag,w,rows,o){return candidatesFor(ag,w,rows,o).filter(e=>!e.short)}
function linkedNumbers(w,rows,R,o){
  const nums=new Set();
  R.agents.forEach(ag=>candidatesFor(ag,w,rows,o).forEach(e=>e.legs.forEach(l=>{if(isPhone(l.phone))nums.add(l.phone)})));
  return [...nums].sort();
}
/* existing: queue docs (live and removed); skip: call ids already audited, never sampled again */
function choosePicks(w,rows,R,o,existing,skip){
  const plan=[];
  R.agents.forEach(ag=>{
    const mine=(existing||[]).filter(q=>q.week===w&&q.agent===ag.name),live=mine.filter(q=>!q.removed);
    const taken=new Set(skip||[]);mine.forEach(q=>{if(q.callId)taken.add(String(q.callId));((q.chain&&q.chain.legs)||[]).forEach(l=>l&&l.id&&taken.add(String(l.id)))});
    const all=candidatesFor(ag,w,rows,o),el=all.filter(e=>!e.short),short=all.filter(e=>e.short),need=Math.max(0,o.perAgent-live.length),picks=[];
    const counts={CL:0,MGR:0,DE:0,short:short.length};el.forEach(e=>counts[e.S.kind]++);
    const cl=el.filter(e=>e.S.kind==="CL"),md=el.filter(e=>e.S.kind!=="CL");
    const fill=(list,n)=>{for(const e of list){if(n<=0||picks.length>=need)return;if(e.legs.some(l=>taken.has(l.id)))continue;picks.push(e);e.legs.forEach(l=>taken.add(l.id));n--}};
    const wantCL=Math.max(0,o.cl-live.filter(q=>q.type==="call").length),wantMD=Math.max(0,o.mgrde-live.filter(q=>q.type==="mgr").length);
    fill(cl,Math.min(wantCL,need));fill(md,Math.min(wantMD,need-picks.length));
    fill(cl,need-picks.length);fill(md,need-picks.length);
    fill(short,need-picks.length);
    plan.push({agent:ag.name,set:ag.set,ag,picks,counts,eligible:el.length,all,live:live.length,need});
  });
  return plan;
}
/* the restaurant a case is filed under: the sampled call's, else the graded agent's legs', else any leg's */
function caseCoded(e,L){return [e.S].concat(e.legs.filter(l=>L.has(l.login)),e.legs).find(l=>l.code)||null}
function partyOf(r,S,R){const p=r.phone;if(!p)return "";if(isPhone(p))return p===S.phone?"caller":"…"+p.slice(-4);return whoOf(p,R)}
function queueDoc(e,ag,w,R,pos,now,tasks){
  const S=e.S,L=ag.set,legs=e.legs;
  const coded=caseCoded(e,L);
  const code=coded?coded.code:"",name=coded?coded.name:(S.name||"");
  const link=code?`${GD}/restaurant/${encodeURIComponent(code)}?caller_id=${encodeURIComponent(S.phone)}&callId=${encodeURIComponent(S.id)}`:`${GD}/callrecordings?callIds=${encodeURIComponent(S.id)}`;
  const t0=Math.min(...legs.map(l=>l.t0)),t1=Math.max(...legs.map(l=>l.t1));
  return {link,agent:ag.name,type:S.kind==="CL"?"call":"mgr",kind:S.kind,callDate:etDay(S.t0),callTime:etClock(S.t0),restaurantId:code,restaurantName:name,
    callId:S.id,durationSec:S.sec,
    chain:{legs:legs.map(l=>{const own=L.has(l.login);return {id:l.id,at:new Date(l.t0).toISOString().slice(0,19),sec:l.sec,who:whoOf(l.login,R),login:l.login,
        group:own?"graded":(R.groups.get(l.login)||l.group||""),dir:l.dir,party:partyOf(l,S,R),own,graded:own,sampled:l.id===S.id,before:l.t0<S.t0}}),
      count:legs.length,spanSec:Math.round((t1-t0)/1000),talkSec:legs.reduce((t,l)=>t+l.sec,0),ownSec:e.own,ownCount:legs.filter(l=>L.has(l.login)).length,
      agents:new Set(legs.map(l=>whoOf(l.login,R))).size},
    week:w,pos,source:"lightdash",short:!!e.short,auditId:null,score:null,removed:false,addedAt:now,
    tasks:Array.isArray(tasks)?tasks:null,tasksAt:Array.isArray(tasks)?now:null};
}
/* every candidate call for the week, compact, for the Database view (sampled ones are matched by id against the queue) */
function populationOf(plan,R){
  const out=[];
  plan.forEach(pl=>pl.all.forEach(e=>{const S=e.S,coded=caseCoded(e,pl.set);
    out.push({id:S.id,agent:pl.agent,kind:S.kind,at:new Date(S.t0).toISOString().slice(0,19),sec:S.sec,code:coded?coded.code:"",name:coded?coded.name:(S.name||""),
      n:e.legs.length,own:e.own,talk:e.legs.reduce((t,l)=>t+l.sec,0),ctx:e.legs.filter(l=>!pl.set.has(l.login)).length,short:!!e.short,ids:e.legs.map(l=>l.id)})}));
  return out;
}
function ldConfig(o,field,from,to,values){return {exploreName:o.explore,dimensions:LD_DIMS,metrics:["calls_total_conversation_calls"],
  sorts:[{fieldId:"calls_call_started_at_est",descending:false}],limit:o.cap,
  filters:{dimensions:`calls_call_started_at_est_day inBetween=${from},${to} AND ${field} equals=${values.map(ldVal).join(",")}`}}}

/* ---- WIRA tasks ----
   A task belongs to a case when it was created between beforeMin before the first linked call and afterMin after the last one ended, and
   (1) it is on the case's restaurant, or (2) the graded agent created it and it has no restaurant (or the case has none), or (3) it names one of the calls.
   QA audits and automated feedback texts are left out. */
const TASKS = {explore:"wira_tasks", beforeMin:10, afterMin:20, skipProjects:["customer-feedback","real-time-audits-pizza"], textCap:2000, chunk:150};
const TASK_SCAN_DIMS = ["wira_tasks_wira_task_id","wira_tasks_task_created_at_est","wira_tasks_task_created_by","wira_tasks_project_name","wira_tasks_restaurant_unique_code","wira_tasks_conversation_id"];
const TASK_DIMS = TASK_SCAN_DIMS.concat(["wira_tasks_intent","wira_tasks_sub_intent","wira_tasks_task_type","wira_tasks_task_title","wira_tasks_task_description","wira_tasks_task_comments",
  "wira_tasks_task_commentors","wira_tasks_task_status","wira_tasks_sub_status","wira_tasks_priority","wira_tasks_closed_at_est","wira_tasks_issue_type","wira_tasks_issue_category",
  "wira_tasks_diagnosis","wira_tasks_ideal_outcome","wira_tasks_is_callback_required","wira_tasks_fcr_agent","wira_tasks_fcr_client","wira_tasks_order_number","wira_tasks_task_assigned_to"]);
const validCode = c => /^R\d{4,6}$/.test(String(c||""));
function isAgentWho(s,ag){const k=normWho(s);if(!k||!ag)return false;if(ag.keys&&ag.keys.has(k))return true;
  if(ag.keys)for(const c of ag.keys){if(c.length>=15&&(k.startsWith(c)||(k.length>=15&&c.startsWith(k))))return true}
  return !!(ag.nameKey&&ag.nameKey.length>=8&&k.includes(ag.nameKey))}
function taskScanConfig(o,field,from,to,values){return {exploreName:o.explore,dimensions:TASK_SCAN_DIMS,metrics:[],sorts:[{fieldId:"wira_tasks_task_created_at_est",descending:false}],limit:PULL.cap,
  filters:{dimensions:`wira_tasks_task_created_at_est_day inBetween=${from},${to} AND ${field} equals=${values.map(ldVal).join(",")}`}}}
function taskDetailConfig(o,from,to,ids){return {exploreName:o.explore,dimensions:TASK_DIMS,metrics:[],sorts:[{fieldId:"wira_tasks_task_created_at_est",descending:false}],limit:PULL.cap,
  filters:{dimensions:`wira_tasks_task_created_at_est_day inBetween=${from},${to} AND wira_tasks_wira_task_id equals=${ids.map(ldVal).join(",")}`}}}
function taskRows(raw){const m=new Map();
  (raw||[]).forEach(x=>{const id=String((x&&x.wira_tasks_wira_task_id)||"").trim();if(!id||m.has(id))return;const t=ldTs(x.wira_tasks_task_created_at_est);if(isNaN(t))return;
    m.set(id,{id,t,by:String(x.wira_tasks_task_created_by||"").trim(),cat:String(x.wira_tasks_project_name||x.wira_tasks_intent||"").trim(),
      code:String(x.wira_tasks_restaurant_unique_code||"").trim().toUpperCase(),conv:String(x.wira_tasks_conversation_id||"").trim(),raw:x})});
  return [...m.values()].sort((a,b)=>a.t-b.t||(a.id<b.id?-1:1))}
/* the calls of a case as {id,t0,t1}: from a pull candidate, or from a queue doc's linked calls (or its single call) */
function legsOfDoc(q){const c=q&&q.chain;
  if(c&&Array.isArray(c.legs)&&c.legs.length)return c.legs.map(l=>{const t0=ldTs(l.at);return {id:String(l.id||""),t0,t1:t0+(Number(l.sec)||0)*1000}}).filter(l=>!isNaN(l.t0)).sort((a,b)=>a.t0-b.t0);
  if(q&&q.callDate&&q.callTime){const t0=ldTs(q.callDate+"T"+q.callTime);if(!isNaN(t0))return [{id:String(q.callId||""),t0,t1:t0+(Number(q.durationSec)||0)*1000}]}
  return []}
function caseSpan(legs){return {t0:Math.min(...legs.map(l=>l.t0)),t1:Math.max(...legs.map(l=>l.t1))}}
function taskDays(legs,o){const {t0,t1}=caseSpan(legs);return [etDay(t0-o.beforeMin*6e4),etDay(t1+o.afterMin*6e4)]}
function linkTasks(cs,tasks,ag,o){
  const legs=(cs&&cs.legs)||[];if(!legs.length)return [];
  const {t0,t1}=caseSpan(legs),lo=t0-o.beforeMin*6e4,hi=t1+o.afterMin*6e4,ids=new Set(legs.map(l=>l.id).filter(Boolean)),skip=new Set(o.skipProjects||[]);
  return (tasks||[]).filter(k=>!skip.has(k.cat)&&((k.conv&&ids.has(k.conv))||(k.t>=lo&&k.t<=hi&&((cs.code&&k.code===cs.code)||(isAgentWho(k.by,ag)&&(!cs.code||!validCode(k.code)))))))
    .map(k=>{const i=legs.findIndex(l=>k.t>=l.t0&&k.t<=l.t1);
      return {id:k.id,t:k.t,when:k.t<t0?"before":k.t>t1?"after":"during",min:Math.round((k.t<t0?t0-k.t:k.t>t1?k.t-t1:k.t-t0)/6e4),leg:i<0?null:i+1}});
}
const capText=(s,n)=>{s=String(s??"").replace(/\r/g,"").trim();return s.length>n?s.slice(0,n-1)+"…":s};
function mdPlain(s){return String(s||"").replace(/!\[[^\]]*\]\([^)]*\)/g,"[image]").replace(/\[@\s*([^\]]+?)\s*\]\(\s*\)/g,"@$1").replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,(m,a,b)=>a===b?b:`${a} (${b})`)}
const ldBool=v=>v===true||v==="true"?true:v===false||v==="false"?false:null;
/* one linked task as stored on a queue doc / audit: what the agent entered, plus where it sits against the calls */
function taskDoc(raw,link,ag,o){const x=raw||{},cap=n=>s=>capText(mdPlain(s),n);
  const split=s=>String(s||"").split("##").map(v=>v.trim());
  const cm=split(x.wira_tasks_task_comments),cw=split(x.wira_tasks_task_commentors);
  const comments=cm.map((text,i)=>({who:String(cw[i]||"").trim(),text:cap(600)(text)})).filter(c=>c.text);
  const by=String(x.wira_tasks_task_created_by||"").trim(),blob=[x.wira_tasks_task_description,x.wira_tasks_task_comments].join(" ").toLowerCase();
  return {id:link.id,at:new Date(link.t).toISOString().slice(0,19),when:link.when,min:link.min,leg:link.leg,
    by,mine:by?isAgentWho(by,ag):null,commented:!!(ag&&cw.some(w=>isAgentWho(w,ag))),mentioned:!!(ag&&blob.includes("@"+ag.name.toLowerCase())),
    cat:String(x.wira_tasks_project_name||x.wira_tasks_intent||"").trim(),intent:String(x.wira_tasks_sub_intent||"").trim(),type:String(x.wira_tasks_task_type||"").trim(),
    title:cap(300)(x.wira_tasks_task_title),desc:cap(o.textCap)(x.wira_tasks_task_description),comments:comments.slice(-12),
    status:String(x.wira_tasks_task_status||"").trim(),sub:String(x.wira_tasks_sub_status||"").trim(),pri:String(x.wira_tasks_priority??"").trim(),
    closed:x.wira_tasks_closed_at_est?String(x.wira_tasks_closed_at_est).slice(0,19):"",
    issue:String(x.wira_tasks_issue_type||"").trim(),issueCat:String(x.wira_tasks_issue_category||"").trim(),diagnosis:cap(600)(x.wira_tasks_diagnosis),ideal:cap(600)(x.wira_tasks_ideal_outcome),
    callback:String(x.wira_tasks_is_callback_required??"").trim(),fcrAgent:ldBool(x.wira_tasks_fcr_agent),fcrClient:ldBool(x.wira_tasks_fcr_client),
    order:String(x.wira_tasks_order_number??"").trim(),assignee:String(x.wira_tasks_task_assigned_to||"").trim(),code:String(x.wira_tasks_restaurant_unique_code||"").trim().toUpperCase()};
}
const wiraUrl=id=>`${GD}/wira/tasks/${encodeURIComponent(String(id||"").replace(/^T/i,""))}`;

/* ---- What Claude got: the case facts Claude reads from the linked calls and tasks, in the reviewer's own fields ---- */
const FACTS_V = "facts-1";
const AI_ENUMS = {faultAgent:["tarro","restaurant","customer","unclear","none"],faultCorrect:["tarro","restaurant","customer","unclear","no_error"],errorType:["product","process","both"],singleTouch:["yes","no"]};
const AI_TEXT = {summary:800,rootCause:600,faultWhy:450,actionTaken:350,promised:300,followUpOwner:160,gaps:500};
function cleanAiFacts(x){if(!x||typeof x!=="object"||Array.isArray(x))return null;const out={};
  for(const [k,n] of Object.entries(AI_TEXT))out[k]=capText(typeof x[k]==="string"?x[k]:"",n);
  for(const [k,list] of Object.entries(AI_ENUMS)){const v=String(x[k]??"").trim().toLowerCase().replace(/[\s-]+/g,"_");out[k]=list.includes(v)?v:(k==="faultAgent"&&/^(didn.?t|did_not|not)_?say|^no_?mention|^n\/?a$/.test(v)?"none":k==="faultCorrect"&&/^(none|no)$/.test(v)?"no_error":"")}
  if(!out.rootCause&&!out.summary)return null;
  if(out.faultCorrect==="no_error"&&!out.errorType)out.errorType="";
  return out}
const KIND_TEXT={CL:"the restaurant client called support",MGR:"a call routed to the manager line",DE:"a delivery call"};
function clock12u(ms){const d=new Date(ms),h=d.getUTCHours(),m=d.getUTCMinutes();return (h%12||12)+":"+String(m).padStart(2,"0")+(h<12?" AM":" PM")}
function dur(s){s=Math.max(0,Math.round(Number(s)||0));return Math.floor(s/60)+":"+String(s%60).padStart(2,"0")}
function whenTask(k){const m=k.min;return k.when==="before"?`${m} min before the first call`:k.when==="after"?(m<1?"right after the last call":`${m} min after the last call`):k.leg?`during call ${k.leg}`:"between calls"}
/* c: {agent, kind, restaurant, code, date (YYYY-MM-DD), legs:[{at,sec,who,graded,dir,party,text}], tasks:[taskDoc]} */
function casePrompt(c){
  const first=String(c.agent||"the agent").split(" ")[0],legs=c.legs||[],tasks=c.tasks||[],g=legs.filter(l=>l.graded).length;
  const day=c.date?new Date(c.date+"T12:00:00Z").toLocaleDateString("en-US",{timeZone:"UTC",weekday:"short",month:"short",day:"numeric",year:"numeric"}):"";
  const head=[`You are helping a QA lead at Tarro audit one support case. Tarro answers the phones and runs the POS, online ordering and delivery for pizza restaurants. ${c.agent||"The agent"} is a Super Agent who handles escalated calls.`,
    `Read the linked calls below as one case, played end to end, along with the WIRA tasks (tickets) created around them. Write down the case facts as you understand them. Do not grade the agent.`,
    ``,`Things to know:`,
    `- Transcripts are machine speech-to-text with no speaker labels: work out who is talking from context. Names are often misheard ("Darrow", "Tauro" or "Tarot" usually means Tarro).`,
    `- Calls marked GRADED were handled by ${c.agent||"the audited agent"}, the agent being audited. The other calls were handled by colleagues and are context only.`,
    `- A call with no transcript may be a voicemail, a ring-out or audio that wasn't transcribed.`,
    `- WIRA tasks show what was documented and escalated. A task with no recorded creator may still be ${first}'s.`,
    `- State only what the calls and tasks support. When something can't be told, say so in "gaps" and use "unclear" or an empty string.`,
    `- Write plainly and briefly, the way a QA lead fills in a form. Refer to people by name or role (${first}, the client, the customer, the store manager), never as he or she.`,
    ``,`Reply with only a JSON object with exactly these keys:`,
    `{"summary": "what happened across the calls, in order, in 2-3 short sentences",`,
    ` "rootCause": "what went wrong and why, in 1-2 sentences; if nothing went wrong, what the caller needed",`,
    ` "faultAgent": "who ${first} told the caller was at fault: tarro | restaurant | customer | unclear | none (none = ${first} didn't say)",`,
    ` "faultCorrect": "who was actually at fault, by the evidence: tarro | restaurant | customer | unclear | no_error",`,
    ` "faultWhy": "one short sentence with the evidence for both fault answers, citing call numbers",`,
    ` "errorType": "product | process | both | \\"\\" (product = software, menu, hardware or an integration behaved wrong; process = a person or a step in the workflow failed; empty when there was no error)",`,
    ` "singleTouch": "yes | no (yes = ${first} resolved it without handing it to another team)",`,
    ` "actionTaken": "what ${first} did on these calls, in under 20 words",`,
    ` "promised": "what ${first} promised the caller (a refund, a callback, a fix by a time), in under 15 words; empty if nothing",`,
    ` "followUpOwner": "the team or person who owns any follow-up, in a few words; empty if none",`,
    ` "gaps": "what you couldn't tell from these calls and tasks, in 1-2 short sentences; empty if nothing"}`,
    ``,`CASE`,
    `Audited agent: ${c.agent||"unknown"}`,
    `Sampled call: ${[c.kind?`${c.kind} (${KIND_TEXT[c.kind]||c.kind})`:"",c.restaurant?`${c.restaurant}${c.code?` (${c.code})`:""}`:(c.code||"no restaurant on record"),day].filter(Boolean).join(" · ")}`,
    `Linked calls: ${legs.length} (${g} graded)`].concat(c.team&&c.team.length>1?[
    `This is a CASE: several agents worked it (${c.team.join(", ")}). It is graded as a team. In "actionTaken", say briefly who did what. "faultAgent" is what ${first} told the caller; if others told the caller something different, say so in "faultWhy".`]:[]);
  return head.join("\n")+"\n\n"+caseEvidence(c);
}
function caseEvidence(c){const legs=c.legs||[],tasks=c.tasks||[];
  let budget=60000;
  const calls=legs.map((l,i)=>{const t0=ldTs(l.at),dir=l.dir==="in"?"inbound from":l.dir==="out"?"outbound to":"with";
    let tx=String(l.text||"").trim();if(tx.length>8000)tx=tx.slice(0,8000)+" …";if(tx.length>budget)tx=tx.slice(0,Math.max(0,budget))+" …";budget-=tx.length;
    const party=l.party==="caller"?"the caller":l.party||"unknown";
    return `\nCALL ${i+1} · ${isNaN(t0)?"":clock12u(t0)+" ET · "}${dur(l.sec)} · ${l.graded?"GRADED · ":""}${l.who||"Unknown"}, ${dir} ${party}\n${tx||"[no transcript]"}`});
  const tk=tasks.length?tasks.map(k=>{const f=[];
      const kt=ldTs(k.at);f.push(`\nTASK ${k.id} · created ${isNaN(kt)?"":clock12u(kt)+" ET, "}${whenTask(k)} · ${k.by?`created by ${k.by}`:"creator not recorded"} · category ${k.cat||"none"}${k.intent?` · intent ${k.intent}`:""} · status ${k.status||"unknown"}${k.pri?` · priority ${k.pri}`:""}`);
      f.push(`Title: ${k.title||""}`);if(k.desc)f.push(`Description: ${capText(k.desc,1500)}`);
      [["Issue type",k.issue],["Issue category",k.issueCat],["Diagnosis",k.diagnosis],["Ideal outcome",k.ideal],["Callback required",k.callback],["Order",k.order],["Assigned to",k.assignee]].forEach(([a,b])=>{if(b)f.push(`${a}: ${b}`)});
      if(k.comments&&k.comments.length)f.push("Comments:\n"+k.comments.map(x=>`- ${x.who||"someone"}: ${capText(x.text,400)}`).join("\n"));
      return f.join("\n")}).join("\n"):`\nNo WIRA task was found from ${TASKS.beforeMin} minutes before the first call to ${TASKS.afterMin} minutes after the last.`;
  const sl=(c.slack||[]).length?"\n\nSLACK THREADS (where the team coordinated)"+c.slack.map(t=>{const st=ldTs(t.at);return `\n#${t.channel} · ${isNaN(st)?"":"posted "+clock12u(st)+" ET · "}${t.author||"someone"}: ${capText(t.text,600)}`+(t.replies||[]).map(r=>`\n- reply · ${r.who}: ${capText(r.text,300)}`).join("")}).join("\n"):"";
  return "LINKED CALLS"+calls.join("\n")+"\n\nWIRA TASKS"+tk+sl+"\n";
}
/* ---- Two passes. Pass 1 (facts): what was said and done, per call and in one timeline, plus explicit promises. No conclusions.
   Pass 2 (analysis): reads only the pass-1 facts, never the transcripts, and concludes; every conclusion cites fact ids. ---- */
const FACTS2_V = "facts-2";
const CTX = "Tarro answers the phones and runs the POS, online ordering and delivery for pizza restaurants. Super Agents handle escalated calls from restaurant clients (store owners and managers) and their customers.";
function caseLine(c){return `Restaurant: ${c.restaurant?`${c.restaurant}${c.code?` (${c.code})`:""}`:(c.code||"not on record")}${c.date?" · "+c.date:""}`}
function factsPrompt(c){
  const first=String(c.agent||"the agent").split(" ")[0];
  const head=[`You are the note-taker for a QA lead at Tarro reviewing one support case. ${CTX}`,
    `Record what happened in the calls, WIRA tasks (tickets) and Slack threads below. A reviewer will judge the case from your record later, so be complete and exact.`,
    ``,`Rules:`,
    `- Record only what was said or done. Do NOT interpret, explain, judge or conclude: no fault, no root cause, no "should have", no opinion on how well anyone did.`,
    `- Attribute every statement to the person who said it: "Store manager says the customer paid by card", not "the customer paid by card". A claim stays a claim.`,
    `- Record actions actually taken: tickets reprinted, orders remade or refunded, drivers reassigned, transfers, tasks created or closed (with their status), Slack posts.`,
    `- Transcripts are machine speech-to-text with no speaker labels: work out who is talking from context. "Darrow", "Tauro", "Taro" or "Tyro" usually means Tarro. Agents introduce themselves with an alias, so call the Tarro agent by the name in the call header.`,
    `- If something isn't in the evidence, leave it out. Never guess or fill in.`,
    `- Refer to people by name or role (the store manager, the customer, the driver, ${first}), never as he or she.`,
    ``,`Reply with only a JSON object:`,
    `{"calls": [{"n": 1, "bullets": ["3 to 5 bullets for this call, each under 15 words, in order: who called and why, what was reported, what the agent did, how the call ended"]}],`,
    ` "timeline": [{"src": "Call 1 | Task T123 | Slack", "when": "5:04 PM", "who": "who said or did it", "kind": "said | did", "what": "the fact, under 20 words"}],`,
    ` "promises": [{"src": "Call 2", "who": "who promised", "to": "who it was promised to", "what": "what was promised, under 12 words", "by": "deadline if one was given, else empty"}]}`,
    ``,`"when" is the clock time in the call, task or post header; Slack replies take their post's time. "calls" has one entry for every call that has a transcript, using the call numbers below. "timeline" is in time order and covers calls, tasks and Slack. "promises" lists only explicit commitments (a callback, a refund, a remake, a fix by a time) and is empty if there were none.`,
    ``,`CASE`,`Audited agent: ${c.agent||"unknown"}`,caseLine(c)].concat(c.team&&c.team.length>1?[`Agents who worked it: ${c.team.join(", ")}`]:[]);
  return head.join("\n")+"\n\n"+caseEvidence(c);
}
const FACT_KINDS=["said","did"];
function cleanFacts(x,legs){if(!x||typeof x!=="object"||Array.isArray(x))return null;const s=(v,n)=>capText(typeof v==="string"?v:v==null?"":String(v),n);
  const calls={};(Array.isArray(x.calls)?x.calls:[]).forEach(k=>{const n=Number(k&&k.n),l=(legs||[])[n-1];if(!l||!l.id)return;
    const b=(Array.isArray(k.bullets)?k.bullets:[]).map(t=>s(t,200).replace(/^[-•*]\s*/,"")).filter(Boolean).slice(0,6);if(b.length)calls[l.id]=b});
  const timeline=(Array.isArray(x.timeline)?x.timeline:[]).filter(t=>t&&typeof t==="object"&&t.what).slice(0,60).map((t,i)=>({id:"F"+(i+1),src:s(t.src,40),when:s(t.when,20),who:s(t.who,60),
    kind:FACT_KINDS.includes(String(t.kind).toLowerCase())?String(t.kind).toLowerCase():"said",what:s(t.what,240)}));
  const promises=(Array.isArray(x.promises)?x.promises:[]).filter(t=>t&&typeof t==="object"&&t.what).slice(0,15).map((t,i)=>({id:"P"+(i+1),src:s(t.src,40),who:s(t.who,60),to:s(t.to,60),what:s(t.what,160),by:s(t.by,60)}));
  if(!timeline.length&&!Object.keys(calls).length)return null;
  return {calls,timeline,promises}}
function factLines(F){return F.timeline.map(t=>`${t.id} · ${[t.when,t.src].filter(Boolean).join(" · ")} · ${t.who||"someone"} ${t.kind==="did"?"[did]":"[said]"}: ${t.what}`).join("\n")+
  "\n\nPROMISES\n"+(F.promises.length?F.promises.map(p=>`${p.id} · ${p.src} · ${p.who||"someone"} to ${p.to||"someone"}: ${p.what}${p.by?` (by ${p.by})`:""}`).join("\n"):"None were made.")}
function analysisPrompt(c,F){
  const first=String(c.agent||"the agent").split(" ")[0],team=c.team&&c.team.length>1;
  const head=[`You are helping a QA lead at Tarro review one support case. ${CTX} ${c.agent||"The agent"} is the Super Agent being audited.`,
    `Below is the record of the case: facts F1, F2… and promises P1, P2…. You do not see the calls. Draw conclusions from these facts only, and do not add facts that aren't listed.`,
    ``,`Rules:`,
    `- Every conclusion cites the fact ids it rests on. If the facts don't support a conclusion, answer "unclear" (or leave the text empty) rather than guess.`,
    `- A claim made by one party is not proof. Weigh who said what.`,
    `- A promise is "kept" only if a later fact shows it was done; "not_kept" if the record covers the time it was due and it wasn't done; otherwise "cant_tell".`,
    `- Write plainly and briefly, the way a QA lead fills in a form. Refer to people by name or role, never as he or she.`].concat(team?[`- This is a team case (${c.team.join(", ")}). In "actionTaken" say briefly who did what. "faultAgent" is what ${first} told the caller; if others told the caller something different, say so in "faultWhy".`]:[]).concat([
    ``,`Reply with only a JSON object with exactly these keys:`,
    `{"summary": "what happened, in order, in 2-3 short sentences",`,
    ` "rootCause": "what went wrong and why, in 1-2 sentences; if nothing went wrong, what the caller needed",`,
    ` "faultAgent": "who ${first} told the caller was at fault: tarro | restaurant | customer | unclear | none (none = ${first} didn't say)",`,
    ` "faultCorrect": "who was actually at fault, by the facts: tarro | restaurant | customer | unclear | no_error",`,
    ` "faultWhy": "one short sentence on the evidence for both fault answers",`,
    ` "errorType": "product | process | both | empty (product = software, menu, hardware or an integration behaved wrong; process = a person or a step in the workflow failed; empty when there was no error)",`,
    ` "singleTouch": "yes | no (yes = ${first} resolved it without handing it to another team)",`,
    ` "actionTaken": "what ${first} did, in under 20 words",`,
    ` "promised": "what ${first} promised the caller, in under 15 words; empty if nothing",`,
    ` "followUpOwner": "the team or person who owns any follow-up, in a few words; empty if none",`,
    ` "cites": {"rootCause": ["F2"], "faultAgent": [], "faultCorrect": [], "errorType": [], "singleTouch": [], "actionTaken": [], "promised": []},`,
    ` "promiseStatus": [{"id": "P1", "status": "kept | not_kept | cant_tell", "why": "under 15 words", "cites": ["F5"]}]}`,
    ``,`CASE`,`Audited agent: ${c.agent||"unknown"}`,caseLine(c),``,`FACTS`]);
  return head.join("\n")+"\n"+factLines(F)+"\n";
}
const CITE_KEYS=["rootCause","faultAgent","faultCorrect","errorType","singleTouch","actionTaken","promised"];
const PROMISE_ST=["kept","not_kept","cant_tell"];
function cleanAnalysis(x,F){const out=cleanAiFacts(x);if(!out)return null;delete out.gaps;
  const ids=new Set(F.timeline.map(t=>t.id).concat(F.promises.map(p=>p.id))),ok=a=>(Array.isArray(a)?a:[]).map(v=>String(v).trim().toUpperCase()).filter(v=>ids.has(v)).slice(0,8);
  const cites={},c=x.cites&&typeof x.cites==="object"?x.cites:{};CITE_KEYS.forEach(k=>{const v=ok(c[k]);if(v.length)cites[k]=v});out.cites=cites;
  const st=new Map((Array.isArray(x.promiseStatus)?x.promiseStatus:[]).filter(p=>p&&p.id).map(p=>[String(p.id).trim().toUpperCase(),p]));
  out.facts={calls:F.calls,timeline:F.timeline,promises:F.promises.map(p=>{const v=st.get(p.id)||{},s=String(v.status||"").trim().toLowerCase().replace(/[\s-]+/g,"_");
    return Object.assign({},p,{status:PROMISE_ST.includes(s)?s:"cant_tell",why:capText(typeof v.why==="string"?v.why:"",160),cites:ok(v.cites)})})};
  return out}

function transcriptConfig(from,to,ids){return {exploreName:PULL.explore,dimensions:["calls_conversation_id","asr_transcript_call_transcript"],metrics:[],
  sorts:[{fieldId:"calls_conversation_id",descending:false}],limit:PULL.cap,filters:{dimensions:`calls_call_started_at_est_day inBetween=${from},${to} AND calls_conversation_id equals=${ids.map(ldVal).join(",")}`}}}

/* ---- talked calls, and calls vs cases ----
   A leg counts only if people talked on it: a transcript that's a voicemail greeting, or one with (almost) nothing in it, is set aside.
   A sampled call becomes a CASE when another Super Agent (or a shared SA seat, or Pizza CRT) talked on one of its legs: it was a team effort,
   so it's graded once as a case. Otherwise it's a CALL, graded on the agent alone. */
const VM_RE = /forwarded to (an? )?(voice ?mail|automated)|leave (a|your) (message|name)|after the (tone|beep)|not available.{0,40}(message|tone)|mailbox (is )?full|voice ?mail|record your message|the (number|person|subscriber) you (have dialed|are trying to reach)|is not in service|cannot be completed/i;
function legTalk(text){const t=String(text||"").trim();if(!t||t.length<40)return "silent";if(VM_RE.test(t)&&t.length<400)return "voicemail";return "talk"}
const talked = l => !l || !l.talk || l.talk==="talk";
const TEAM_GROUPS = ["sa","pool","crt"];
function caseTeam(legs){return [...new Set((legs||[]).filter(l=>talked(l)&&!(l.graded??l.own)&&TEAM_GROUPS.includes(l.group)).map(l=>l.who).filter(Boolean))]}
/* group the week's queue docs into cases: docs whose talked legs overlap belong to the same case */
function groupCases(docs){
  const parent=new Map(),find=x=>{while(parent.get(x)!==x){parent.set(x,parent.get(parent.get(x)));x=parent.get(x)}return x};
  const byLeg=new Map();docs.forEach(d=>parent.set(d.id,d.id));
  docs.forEach(d=>((d.chain&&d.chain.legs)||[]).filter(talked).forEach(l=>{if(!l.id)return;const o=byLeg.get(l.id);if(o)parent.set(find(d.id),find(o));else byLeg.set(l.id,d.id)}));
  const out=new Map();docs.forEach(d=>{const r=find(d.id);(out.get(r)||out.set(r,[]).get(r)).push(d)});return out}
/* PULL-CORE END */
if(typeof module!=="undefined")module.exports={PULL,GD,ROSTER_DEFAULT,SCOPE_DEFAULT,LD_DIMS,ldTs,etDay,etClock,addDaysU,isPhone,cleanName,cleanAgent,ldVal,fnv,kindOf,normRows,makeRoster,groupOf,scopeRows,whoOf,buildChain,eligibleFor,linkedNumbers,candidatesFor,choosePicks,partyOf,queueDoc,populationOf,ldConfig,
  legTalk,talked,caseTeam,groupCases,VM_RE,TASKS,TASK_SCAN_DIMS,TASK_DIMS,normWho,isAgentWho,validCode,caseCoded,taskScanConfig,taskDetailConfig,taskRows,legsOfDoc,caseSpan,taskDays,linkTasks,taskDoc,mdPlain,wiraUrl,FACTS_V,cleanAiFacts,casePrompt,caseEvidence,factsPrompt,cleanFacts,factLines,analysisPrompt,cleanAnalysis,FACTS2_V,transcriptConfig,whenTask};
