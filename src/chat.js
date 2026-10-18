/* CHAT-CORE START */
/* ---- The chat brain: audit a Super Agent's WIRA chat. See docs/brain-wira-chats.md.
   Route: facts -> analysis (fault, policy bucket, ideal resolution) -> solution quality -> grade + coaching.
   Code does the data work and all the money; Claude reads and judges. ---- */
const CHAT = {explore:"wira_project_tasks", perSA:5, relBeforeH:2, relAfterH:24, txCap:7000, budget:60000, calibMax:3, maxCalls:6, quietCalls:2, gradeRuns:1, lessonMax:20, slowReplyMin:15,
  outBeforeMin:5, outAfterMin:60, outRestH:3, outOpenH:24, outLimit:80, maxOutCalls:4, quietOut:2};
const CHAT_V = "chat-2";
const CHAT_DIMS = ["wira_project_tasks_wira_id","wira_project_tasks_short_wira_id","wira_project_tasks_created_at_est","wira_project_tasks_closed_at_est",
  "wira_project_tasks_status","wira_project_tasks_sub_status","wira_project_tasks_task_title","wira_project_tasks_task_comments","wira_project_tasks_task_commentors",
  "wira_project_tasks_conversation_direction","wira_project_tasks_created_by","wira_project_tasks_created_by_title","wira_project_tasks_assigned_user",
  "wira_project_tasks_agent_alias","wira_project_tasks_client_alias","wira_project_tasks_first_response_time_minutes","wira_project_tasks_first_client_message_time_est",
  "wira_project_tasks_first_agent_reply_time_est","wira_project_tasks_shape_name","wira_project_tasks_rating","wira_project_tasks_wira_ticket_url",
  "wira_project_tasks_shape_fields","wira_project_tasks_caller_id","wira_project_tasks_order2_root_wids_array",
  "restaurants_unique_code","restaurants_english_name"];
const REL_DIMS = ["wira_project_tasks_wira_id","wira_project_tasks_short_wira_id","wira_project_tasks_parent_wid","wira_project_tasks_created_at_est","wira_project_tasks_closed_at_est",
  "wira_project_tasks_project_name","wira_project_tasks_shape_name","wira_project_tasks_shape_fields","wira_project_tasks_task_title","wira_project_tasks_description",
  "wira_project_tasks_status","wira_project_tasks_assigned_user","wira_project_tasks_created_by","wira_project_tasks_task_comments","wira_project_tasks_task_commentors",
  "wira_project_tasks_wira_ticket_url","wira_project_tasks_order2_root_wids_array"];
const OA = "greendot_orders_analytics_aggregate_";
const ORDER_DIMS = ["order_id","order_ticket_number","order_created_at_est","order_source","order_type","list_coupon_name","call_id","list_call_ids","order_status","list_void_reason_type","list_void_reason_detail","payment_state","payment_refunded_amount","refund_type"].map(x=>OA+x);
const ORDER_METRICS = ["total_sub_total_sales","total_sales_amount","total_tax_amount","total_tip_amount"].map(x=>OA+x);
const CALL_DIMS = ["calls_conversation_id","calls_call_started_at_est","calls_call_duration_in_seconds","internal_users_full_name","internal_users_user_login_name",
  "calls_call_type","calls_call_phone_detail","asr_transcript_call_transcript"];
const SKIP_PROJECTS = ["real-time-audits-pizza","customer-feedback"];
/* who's who beyond the SA roster, keyed by the email prefix WIRA uses as the commentor */
const STAFF_DEFAULT = {"howard.ho":{name:"Howard Ho",role:"lead"},"patrick.evangelista":{name:"Patrick Evangelista",role:"lead"},"weijie.chiew":{name:"CJ Chiew",role:"ae"}};
const ROLE_L = {client:"Client",sa:"Support",sa_other:"Support (other SA)",ae:"AE/CSM",crt:"CRT",lead:"Lead",staff:"Staff",bot:"System"};

const r2 = n => Math.round((Number(n)||0)*100)/100;
const money = n => n==null||isNaN(n)?"–":"$"+r2(n).toFixed(2);
const titleCase = s => String(s||"").split(/[._\s-]+/).filter(Boolean).map(w=>w[0].toUpperCase()+w.slice(1)).join(" ");

/* ---------- 0. The base ---------- */
function chatBaseConfig(from,to,assignees){
  const who=(assignees||[]).filter(Boolean);
  return {exploreName:CHAT.explore,dimensions:CHAT_DIMS,metrics:[],sorts:[{fieldId:"wira_project_tasks_created_at_est",descending:false}],limit:PULL.cap,
    filters:{dimensions:[`restaurants_cuisine_type equals=pizza`,`wira_project_tasks_project_name equals=conversation`,
      `wira_project_tasks_created_at_est_day inBetween=${from},${to}`].concat(who.length?[`wira_project_tasks_assigned_user equals=${who.map(ldVal).join(",")}`]:[]).join(" AND ")}}}
/* client-initiated, or created by an Account Executive (the Lightdash chart's two subsets) */
const isBaseChat = r => r && (r.direction==="inbound" || r.createdByTitle==="Account Executive");
const prefixOf = e => String(e||"").trim().toLowerCase().split("@")[0];

/* WIRA's shape fields (a JSON object) and the order WIDs a task worked on ("Wid(0,1,2,0,3)", the same text as the order's id) */
function parseFields(v){let o=v;if(typeof v==="string"){try{o=JSON.parse(v)}catch(e){return {}}}
  if(!o||typeof o!=="object"||Array.isArray(o))return {};const out={};
  Object.keys(o).slice(0,30).forEach(k=>{if(/^[A-Za-z0-9_-]{1,40}$/.test(k)&&o[k]!=null&&typeof o[k]!=="object")out[k]=String(o[k]).slice(0,200)});return out}
const parseWids = v => [...new Set((Array.isArray(v)?v.map(String):[String(v==null?"":v)]).join(" ").match(/Wid\([0-9,\s]+\)/g)||[])].map(w=>w.replace(/\s+/g,""));
/* order clues a chat's own fields give: ticket, phone and order id by field name */
function fieldClues(fields){const t=[],p=[],w=[],d=[];
  Object.entries(fields||{}).forEach(([k,v])=>{const s=String(v);
    if(/ticket/i.test(k)){const n=s.replace(/\D/g,"");if(n&&n.length<=4)t.push(String(Number(n)))}
    else if(/phone|caller/i.test(k)){const n=s.replace(/\D/g,"");if(n.length>=7)p.push(n)}
    else if(/order/i.test(k))parseWids(s).forEach(x=>w.push(x));
    if(/time|date|when/i.test(k))datesIn(s).forEach(x=>d.push(x))});
  return {tickets:t,phones:p,wids:w,dates:d}}

/* one normalized chat from a wira_project_tasks row */
function chatRow(x,ctx){const g=k=>x["wira_project_tasks_"+k];const s=v=>v==null?"":String(v);
  const c={wid:s(g("wira_id")),sid:s(g("short_wira_id")),url:s(g("wira_ticket_url")),at:s(g("created_at_est")).slice(0,19),closedAt:s(g("closed_at_est")).slice(0,19),
    status:s(g("status")),sub:s(g("sub_status")),title:s(g("task_title")),direction:s(g("conversation_direction")),createdBy:s(g("created_by")),createdByTitle:s(g("created_by_title")),
    sa:s(g("assigned_user")),saEmail:s(g("agent_alias")),clientId:s(g("client_alias")),frt:g("first_response_time_minutes")==null?null:Number(g("first_response_time_minutes")),
    firstClientAt:s(g("first_client_message_time_est")).slice(0,19),firstReplyAt:s(g("first_agent_reply_time_est")).slice(0,19),intent:s(g("shape_name")),rating:s(g("rating")),
    code:s(x.restaurants_unique_code).toUpperCase(),restaurant:cleanName(x.restaurants_english_name),
    fields:parseFields(g("shape_fields")),callerId:s(g("caller_id")),orderWids:parseWids(g("order2_root_wids_array"))};
  c.initiator=c.direction==="inbound"?"client":c.createdByTitle==="Account Executive"?"ae":c.direction||"";
  c.msgs=chatMessages(g("task_comments"),g("task_commentors"),Object.assign({saEmail:c.saEmail,sa:c.sa},ctx||{}));
  c.clientName=(c.msgs.find(m=>m.role==="client"&&m.name!=="Client")||{}).name||"";
  c.timing=chatTiming(c,[]);
  return c}

/* ---------- 1. Messages with owners ---------- */
const MENTION_RE = /\[@[^\]]+\]\(|(^|\s)@[A-Z][a-z]+/;
const THIRD_RE = /\b(client|cl|customer|cx|he|she|him|her|they)\b[^.?!]{0,40}\b(called|yelled|said|says|wants|asked|is asking|demanded|refused|agreed|insists)\b/i;
const GREET_RE = /^\s*(hi|hello|hey|good (morning|afternoon|evening)|thanks for)\b/i;
/* how an SA writes to a colleague, never to the restaurant: "CL"/"CX" for client and customer, "the client" in the third person, "po" (Filipino politeness to a colleague) */
const STAFF_TALK_RE = /\b(?:cl|cx)\b|\b(?:the|this|that)\s+client\b|\b(?:call|message|inform|tell|ask|update|notify|text|email|contact|remind)\s+client\b|^\s*client\b|\b(?:po|opo)\b(?![-'])/i;
/* authors that are not people at Tarro: the restaurant's POS app (the client typing on their terminal) and Tarro's own automation */
const POS_RE = /^(cma|pos)-(pin-)?user/i, BOT_RE = /^(sa|bot|system|wira)[-_]|[-_](bot|workflow|wonka|automation)([-_]|$)/i;
/* names: tokens of an email prefix or a full name, matched on the last name (one typo allowed) and the first name */
const nameToks = s => String(s||"").toLowerCase().replace(/[^a-z\s._-]/g,"").split(/[\s._-]+/).filter(Boolean);
function editDist(a,b){if(a===b)return 0;if(Math.abs(a.length-b.length)>1)return 2;
  const m=a.length,n=b.length;let prev=Array.from({length:n+1},(_,j)=>j);
  for(let i=1;i<=m;i++){const cur=[i];for(let j=1;j<=n;j++)cur[j]=Math.min(prev[j]+1,cur[j-1]+1,prev[j-1]+(a[i-1]===b[j-1]?0:1));prev=cur}
  return prev[n]}
/* the roster entry (or null) that an email prefix or a name belongs to. The roster may carry logins and creators (core.js ROSTER_DEFAULT); names alone also work */
function rosterOf(who,roster){const t=nameToks(who);if(!t.length)return null;const joined=t.join(""),f=t[0],l=t[t.length-1];
  const dflt=typeof ROSTER_DEFAULT!=="undefined"?ROSTER_DEFAULT:[];
  for(const r of roster||[]){const rt=nameToks(r.name);if(!rt.length)continue;
    if(t.join(" ")===rt.join(" "))return r;
    const rf=rt[0],rl=rt[rt.length-1];
    if(t.length>=2&&rt.length>=2){
      const lastOk=l===rl||(l.length>=5&&rl.length>=5&&editDist(l,rl)<=1);
      const firstOk=f===rf||(f.length>=3&&rf.length>=3&&(f.includes(rf)||rf.includes(f)))||(f.length>=4&&rf.length>=4&&editDist(f,rf)<=1);
      if(lastOk&&firstOk)return r}
    const d=dflt.find(x=>x.name===r.name)||{},lg=[].concat(r.logins||[],d.logins||[]).map(x=>String(x).toLowerCase().replace(/^zz/,"").replace(/(gd|cb|online)$/,"")),
      cr=[].concat(r.creators||[],d.creators||[]).map(x=>String(x).toLowerCase().replace(/wondersco(com)?$/,"").replace(/[^a-z]/g,"")),
      keys=new Set(lg.concat(cr).filter(x=>x.length>=6)),cands=[joined.replace(/^zz/,""),f.replace(/^zz/,"")[0]+l];
    if(cands.some(k=>k.length>=6&&[...keys].some(x=>x===k||(x.length>=7&&editDist(x,k)<=1))))return r}
  return null}
const esc_re = s => String(s).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");
/* WIRA joins comments with " ## " and authors the same way, one author per comment. An empty first comment leaves the string starting with " ## " (or "## " once something trims it):
   split without trimming, pair by position, and only then drop the empty ones */
function pairComments(comments,commentors){
  const C=String(comments==null?"":comments).split(" ## "),W=String(commentors==null?"":commentors).split(" ## ");
  if(C.length<W.length&&/^##(\s|$)/.test(C[0])){C[0]=C[0].replace(/^##\s*/,"");C.unshift("")}
  while(C.length<W.length)C.push("");
  return C.map((t,i)=>({who:String(W[i]==null?"":W[i]).trim(),raw:String(t)}))}
function chatMessages(comments,commentors,ctx){ctx=ctx||{};
  const raw=String(comments==null?"":comments);if(!raw.trim())return [];
  const pairs=pairComments(comments,commentors),staff=Object.assign({},STAFF_DEFAULT,ctx.staff||{});
  const roster=(ctx.roster&&ctx.roster.length?ctx.roster:typeof ROSTER_DEFAULT!=="undefined"?ROSTER_DEFAULT:[]);
  /* the audited SA is who WIRA assigned the chat to. agent_alias is only a last resort for an SA missing from the roster: it is empty on AE-created chats and someone else's on about 1 chat in 25 */
  const meR=rosterOf(ctx.sa,roster),me=meR||(ctx.sa?{name:ctx.sa}:null),R=meR||!me?roster:roster.concat([me]),aliasP=meR?"":prefixOf(ctx.saEmail);
  const kept=[];let blank=0;
  pairs.forEach(({who:w,raw:t})=>{const p=prefixOf(w),text=mdPlain(t).trim(),at=w.includes("@");
    if(!text&&!String(t).trim()){blank++;return}
    let role="staff",name=titleCase(p)||"Unknown",via="";
    if(/^client-/i.test(w)){role="client";name="Client"}
    else if(!at&&POS_RE.test(w)){role="client";name="Client";via="pos"}
    else if(!at&&BOT_RE.test(w)){role="bot";name="Automation";via="bot"}
    else if(staff[p]){const st=staff[p];
      if(st.role==="sa"){const sm=rosterOf(st.name||p,roster),mine=!!me&&(sm?sm.name===me.name:nameToks(st.name).join(" ")===nameToks(me.name).join(" "));role=mine?"sa":"sa_other";name=(sm&&sm.name)||st.name||titleCase(p)}
      else{role=st.role||"staff";name=st.name||titleCase(p)}}
    else{const ro=p?rosterOf(p,R):null;
      if(ro){role=me&&ro.name===me.name?"sa":"sa_other";name=ro.name}
      else if(aliasP&&p===aliasP){role="sa";name=ctx.sa||titleCase(p)}}
    const m={n:0,author:w,role,name,raw:String(t).trim(),text,internal:false,inferred:false};if(via)m.via=via;if(blank){m.blankBefore=blank;blank=0}
    kept.push(m)});
  const out=kept.map((m,i)=>Object.assign(m,{n:i+1}));
  /* the client's sign-off names them ("This is Sam") */
  const sign=out.filter(m=>m.role==="client").map(m=>(m.text.match(/\b(?:[Tt]his is|[Ii]t'?s|[Rr]egards,?|[Tt]hanks,?|[Ff]rom|-)\s+([A-Z][a-z]{1,20})\b/)||[])[1]).find(Boolean);
  if(sign)out.forEach(m=>{if(m.role==="client")m.name=sign});
  /* first names of the people at Tarro in this chat: "Hi <a staff first name>" is to staff, "Hi <the client's sign-off name>" is to the client. A speaker's own first name never counts */
  const first=new Map();const addFirst=full=>{const f=nameToks(full)[0];if(f){if(!first.has(f))first.set(f,new Set());first.get(f).add(nameToks(full).join(" "))}};
  roster.forEach(r=>addFirst(r.name));Object.values(staff).forEach(v=>addFirst(v&&v.name));out.forEach(m=>{if(!["client","bot"].includes(m.role)&&m.name!=="Unknown")addFirst(m.name)});
  if(sign)first.delete(sign.toLowerCase());
  const reFor=(own,ownFull)=>{const names=[...first].filter(([f,who])=>f.length>=2&&!(f===own&&who.size===1&&who.has(ownFull))).map(([f])=>esc_re(f));
    return names.length?new RegExp("^\\s*(?:(?:hi|hello|hey|good (?:morning|afternoon|evening)|got it|thanks?|thank you|sure|okay|ok|noted|alright|yes|yep)\\b[\\s,!.]*)?@?(?:"+names.join("|")+")\\b","i"):null},cache={};
  /* internal notes are inferred: WIRA has no flag */
  out.forEach(m=>{if(m.role==="client"||m.role==="bot"){delete m.raw;return}
    const own=nameToks(m.name)[0],ownFull=nameToks(m.name).join(" "),re=cache[ownFull]||(cache[ownFull]=reFor(own,ownFull)),greets=GREET_RE.test(m.text)||(sign&&new RegExp("\\b"+sign+"\\b").test(m.text)),
      toClient=!!sign&&new RegExp("^\\s*(?:(?:hi|hello|hey|dear|good (?:morning|afternoon|evening))\\b[\\s,!.]*)?@?"+esc_re(sign)+"\\b","i").test(m.text);
    if(MENTION_RE.test(m.raw)||MENTION_RE.test(m.text))m.internal=true;
    else if(re&&re.test(m.text))m.internal=true;
    else if(m.role==="sa"&&!toClient&&STAFF_TALK_RE.test(m.text))m.internal=true;
    else if(m.role!=="sa"&&!greets)m.internal=true;
    m.inferred=m.internal;delete m.raw});
  return out}
function chatTranscript(c){return (c.msgs||[]).map(m=>`M${m.n} · ${ROLE_L[m.role]||m.role}${m.role==="client"?"":" — "+m.name}${m.role==="sa"?" (audited)":""}${m.internal?" [internal note, inferred]":""}: ${capText(m.text,1600)}`).join("\n")}

/* ---------- 1b. Timing ----------
   WIRA keeps NO time per message. Checked in Lightdash (Oct 14): wira_project_tasks, rt_wira_tasks and wira_tasks carry only the ' ## '-joined comment text and authors;
   wira_tasks_state, escalations and chats_with_internal_pending_handoff carry task-level times only. What exists: the chat's own times (opened, first client message,
   first Support reply, closed) and its status changes (wira_tasks_state, one row per change). The status does NOT follow the conversation: it flips on the first Support reply,
   on a handoff and on close, never on each client message (no chat of the week of Oct 5 has a second pending_reply). So these times say how long the first reply took
   and how long the chat sat in each status, never how long any later reply took. timing.perMessage is false until that changes. */
const rnd1 = n => Math.round(Number(n)*10)/10;
const minBetween = (a,b) => {const x=ldTs(a),y=ldTs(b);return isNaN(x)||isNaN(y)?null:rnd1((y-x)/6e4)};
const chatStatesConfig = wid => ({exploreName:"wira_tasks_state",dimensions:["wira_tasks_state_task_id","wira_tasks_state_task_status","wira_tasks_state_task_sub_status","wira_tasks_state_created_at_est"],
  metrics:[],sorts:[{fieldId:"wira_tasks_state_task_id",descending:false},{fieldId:"wira_tasks_state_created_at_est",descending:false}],limit:PULL.cap,
  /* no day window: a chat's later status changes (a close, a re-open) can come days after it opened. wid may be one id or a list (a week at a time) */
  filters:{dimensions:`wira_tasks_state_task_id equals=${[].concat(wid).map(ldVal).join(",")}`}});
const stateRow = x => {const s=v=>v==null||v==="None"?"":String(v);return {wid:s(x.wira_tasks_state_task_id),at:s(x.wira_tasks_state_created_at_est).slice(0,19),status:s(x.wira_tasks_state_task_status),sub:s(x.wira_tasks_state_task_sub_status)}};
/* whose turn WIRA's status says it is */
const stateOn = (status,sub) => status==="closed"?"closed":sub==="waiting_on_client"?"client":sub==="pending_internal_handoff"?"handoff":status==="open"||status==="in_progress"?"support":"";
function chatTiming(c,rows){
  const sts=(rows||[]).map(stateRow).filter(s=>s.at&&(!s.wid||!c.wid||s.wid===c.wid)).sort((a,b)=>ldTs(a.at)-ldTs(b.at));
  const states=sts.map((s,i)=>({at:s.at,status:s.status,sub:s.sub,on:stateOn(s.status,s.sub),min:sts[i+1]?minBetween(s.at,sts[i+1].at):null}));
  const last=states[states.length-1];if(last&&last.on!=="closed")last.ongoing=true;
  const sum=on=>states.length?rnd1(states.filter(s=>s.on===on).reduce((t,s)=>t+(s.min||0),0)):null;
  const closedAt=c.closedAt||((states.find(s=>s.on==="closed")||{}).at)||"";
  /* the two times, which the status change confirms; WIRA's first_response_time_minutes (c.frt) is kept beside it because it disagrees on about 1 chat in 80 (chat 1814251: 2.1 min against 23.2 between the times and the status change) */
  const fromTimes=minBetween(c.firstClientAt,c.firstReplyAt),wira=c.frt!=null&&!isNaN(c.frt)?rnd1(c.frt):null;
  const ae=c.initiator==="ae"?aeFirstReply(c.at,states):null;
  const firstReplyMin=c.initiator==="ae"?(ae?ae.min:null):fromTimes!=null?fromTimes:wira;
  return {perMessage:false,opened:c.at||"",firstClientAt:c.firstClientAt||"",firstReplyAt:c.initiator==="ae"?(ae?ae.at:""):c.firstReplyAt||"",firstReplyMin,firstReplyFrom:c.initiator==="ae"?"ae":"client",wiraFirstReplyMin:wira,slowFirstReply:firstReplyMin!=null&&firstReplyMin>CHAT.slowReplyMin,
    closedAt,handleMin:closedAt?minBetween(c.at,closedAt):null,states,
    waitingOnSupportMin:sum("support"),waitingOnClientMin:sum("client"),waitingOnHandoffMin:sum("handoff")}}
/* an AE-started chat has no client message to time from: its first reply is the SA's first reply after the AE opened it,
   which WIRA shows as the first status change after the chat was created (status changes on the first reply, a handoff or the close) */
function aeFirstReply(opened,states){const o=ldTs(opened);if(isNaN(o))return null;
  const s=(states||[]).find(x=>{const t=ldTs(x.at);return !isNaN(t)&&t>=o-60e3});
  return s?{at:s.at,min:Math.max(0,rnd1((ldTs(s.at)-o)/60e3))}:null}
const STATE_ON_L = {support:"Support's turn",client:"waiting on the client",handoff:"waiting on an internal handoff",closed:"closed","":""};
/* the timing lines the facts pass and the grader read */
function chatTimingLines(t,c){if(!t)return [];const day=String(t.opened||"").slice(0,10),at=v=>!v?"–":(String(v).slice(0,10)===day?"":String(v).slice(5,10)+" ")+String(v).slice(11,16),mn=v=>v==null?"–":v+" min";
  const L=[`TIMING (WIRA status times, Eastern, 24-hour clock)`,
    `Opened ${at(t.opened)} · first client message ${at(t.firstClientAt)} · first Support reply ${at(t.firstReplyAt)}${t.firstReplyMin!=null?` (${mn(t.firstReplyMin)} after ${t.firstReplyFrom==="ae"?"the AE opened the chat; WIRA has no time for each message, so this is the first status change after the AE's message":"the first client message"}${t.wiraFirstReplyMin!=null&&Math.abs(t.wiraFirstReplyMin-t.firstReplyMin)>=1?`; WIRA's own first-response figure says ${mn(t.wiraFirstReplyMin)}, which the times do not support`:""})`:""} · closed ${at(t.closedAt)}${t.handleMin!=null?` (open ${mn(t.handleMin)})`:""}`];
  if(t.states.length)L.push(`Status changes: `+t.states.map(s=>`${s.status}${s.sub?"/"+s.sub:""} at ${at(s.at)}${s.ongoing?" (still the status when this data was pulled)":s.min!=null?` (${mn(s.min)})`:""}${STATE_ON_L[s.on]?`, ${STATE_ON_L[s.on]}`:""}`).join(" → "));
  L.push(`WIRA does not time each message and its status does not change with every client message: do not work out how long any reply after the first took, and do not fault the SA on reply speed beyond the first reply and these status times.`);
  return L}

/* ---------- 2. Context: tasks, orders, recordings ---------- */
function relatedTasksConfig(code,from,to){return {exploreName:CHAT.explore,dimensions:REL_DIMS,metrics:[],sorts:[{fieldId:"wira_project_tasks_created_at_est",descending:false}],limit:PULL.cap,
  filters:{dimensions:`restaurants_unique_code equals=${ldVal(code)} AND wira_project_tasks_created_at_est_day inBetween=${from},${to}`}}}
function relTask(x){const g=k=>x["wira_project_tasks_"+k];const s=v=>v==null?"":String(v);
  return {wid:s(g("wira_id")),sid:s(g("short_wira_id")),parent:s(g("parent_wid")),at:s(g("created_at_est")).slice(0,19),closedAt:s(g("closed_at_est")).slice(0,19),
    project:s(g("project_name")),intent:s(g("shape_name")),fields:s(g("shape_fields")),title:capText(g("task_title"),300),desc:capText(g("description"),2000),status:s(g("status")),
    assigned:s(g("assigned_user")),by:s(g("created_by")),url:s(g("wira_ticket_url")),orderWids:parseWids(g("order2_root_wids_array")),
    comments:pairComments(g("task_comments"),g("task_commentors")).map(p=>({who:p.who,text:capText(p.raw,600)})).filter(c=>c.text)}}
/* person names a text gives: a capitalised word after "customer", "cx", "from", "Mr"… */
const NAME_CUE_RE=/\b(?:customer|cust|cx|mr\.?|mrs\.?|ms\.?|miss|named|name is|from)\s+([A-Za-z][a-z]{2,15})\b/gi;
const NOT_NAMES=new Set("doordash uber ubereats grubhub adyen stripe greendot wira slack toast square clover google yelp facebook instagram tarro wonka last now before here there earlier later again home work store shop the this that our your his her their client customer tarro menu order orders ticket phone call calls agent team store resto restaurant pizza delivery pickup card credit debit cash today yesterday tomorrow monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december".split(" "));
function personNames(text){const out=new Set();
  String(text||"").replace(NAME_CUE_RE,(m,n)=>{if(/^[A-Z]/.test(n)&&!NOT_NAMES.has(n.toLowerCase()))out.add(n.toLowerCase());return m});return out}
/* does an SA's other task clearly point at this chat? Its sid or wid, the same associated order, the same ticket or phone, or the same customer name. Time and SA alone are not enough */
function refersToChat(c,t,chatCtx){
  const body=[t.title,t.desc,t.fields].concat(t.comments.map(x=>x.text)).join("\n");
  if(c.sid&&new RegExp("\\b"+esc_re(c.sid)+"\\b").test(body))return true;if(c.wid&&body.includes(c.wid))return true;
  if(t.sid&&new RegExp("\\b"+esc_re(t.sid)+"\\b").test(chatCtx.all))return true;
  if((t.orderWids||[]).some(w=>(c.orderWids||[]).includes(w)))return true;
  const tr=textRefs([body]);
  if(tr.tickets.some(x=>chatCtx.cr.tickets.includes(x))||tr.phones.some(x=>chatCtx.cr.phones.includes(x)))return true;
  const tn=personNames(body);return [...tn].some(n=>chatCtx.names.has(n))||[...chatCtx.names].some(n=>new RegExp("\\b"+esc_re(n)+"\\b","i").test(body))}
/* the chat's own children, plus the SA's other tasks at the same restaurant around the chat that clearly point at this chat. Tasks from the SA's other cases are dropped */
function pickRelated(c,rows){const t0=ldTs(c.at),lo=t0-CHAT.relBeforeH*36e5,hi=t0+CHAT.relAfterH*36e5;
  const texts=(c.msgs||[]).map(m=>m.text),all=texts.join("\n"),names=personNames(all);
  const ctx={all,cr:textRefs(texts),names};
  return (rows||[]).map(relTask).filter(t=>t.wid&&t.wid!==c.wid&&!SKIP_PROJECTS.includes(t.project)).filter(t=>{
    if(t.parent&&t.parent===c.wid)return true;if(t.project==="conversation")return false;
    const at=ldTs(t.at);if(isNaN(at)||at<lo||at>hi)return false;
    return !!c.sa&&(t.by===c.sa||t.assigned===c.sa)&&refersToChat(c,t,ctx)}).slice(0,8)}
function orderConfig(code,from,to){return {exploreName:"greendot_orders_analytics_aggregate",dimensions:ORDER_DIMS,metrics:ORDER_METRICS,
  sorts:[{fieldId:OA+"order_created_at_est",descending:false}],limit:PULL.cap,
  filters:{dimensions:`restaurants_unique_code equals=${ldVal(code)} AND ${OA}order_created_at_est_day inBetween=${from},${to}`}}}
/* orders WIRA ties to the chat that are older than the day window */
function ordersByIdsConfig(code,ids,from,to){return {exploreName:"greendot_orders_analytics_aggregate",dimensions:ORDER_DIMS,metrics:ORDER_METRICS,
  sorts:[{fieldId:OA+"order_created_at_est",descending:false}],limit:PULL.cap,
  filters:{dimensions:`restaurants_unique_code equals=${ldVal(code)} AND ${OA}order_created_at_est_day inBetween=${from},${to} AND ${OA}order_id equals=${ids.map(ldVal).join(",")}`}}}
const UUID_RE=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function orderRow(x){const g=k=>x[OA+k];const ids=new Set([String(g("call_id")||"")].concat(String(g("list_call_ids")||"").match(UUID_RE)||[]).filter(Boolean));
  const items=r2(g("total_sub_total_sales")),tax=r2(g("total_tax_amount")),tip=r2(g("total_tip_amount")),total=g("total_sales_amount")==null?r2(items+tax+tip):r2(g("total_sales_amount"));
  return {id:String(g("order_id")||""),ticket:g("order_ticket_number")==null?"":String(g("order_ticket_number")),at:String(g("order_created_at_est")||"").slice(0,19),
    source:String(g("order_source")||""),type:String(g("order_type")||""),coupon:String(g("list_coupon_name")||""),callIds:[...ids],items,tax,tip,total,
    other:r2(total-items-tax-tip),status:String(g("order_status")||"").toLowerCase(),
    voidWhy:[g("list_void_reason_type"),g("list_void_reason_detail")].map(v=>String(v||"").trim()).filter(Boolean).join(": "),
    pay:String(g("payment_state")||"").toLowerCase().replace(/^payment_state_/,""),refunded:r2(g("payment_refunded_amount")),refundType:String(g("refund_type")||"")}}
/* order status line: voided, refunded, never finalized; empty for a normal submitted order */
function orderState(o){const p=[];if(o.status&&o.status!=="submitted")p.push(o.status.toUpperCase()+(o.voidWhy?` (${o.voidWhy})`:""));
  if(o.refunded>0)p.push(`refunded ${money(o.refunded)}${o.refundType?" "+o.refundType:""}`);else if(/refunded/.test(o.pay))p.push("payment refunded");
  return p.join(", ")}
/* references the chat and its tasks make to an order: ticket numbers, dollar amounts, phone numbers, and whether it is about money or about yesterday */
const MIN_AMT = 5;  /* amounts of $5 or less are fees, tips and credits, not order totals */
const YESTERDAY_RE = /\b(?:yesterday|ytd|last night|previous day)\b/i, COMP_RE = /\b(?:comp|compensat\w*|credit(?:ed|s)?|refund\w*|cogs|remake\w*|redeliver\w*)\b|\b30\s?%/i;
const MONTH_ABBR = "jan feb mar apr may jun jul aug sep oct nov dec".split(" ");
function datesIn(text){const out=new Set(),t=String(text||""),pad=n=>String(n).padStart(2,"0");
  for(const m of t.matchAll(/\b(1[0-2]|0?[1-9])[\/-](3[01]|[12]\d|0?[1-9])(?!\d)/g))out.add(pad(m[1])+"-"+pad(m[2]));
  for(const m of t.matchAll(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b/gi))out.add(pad(MONTH_ABBR.indexOf(m[1].toLowerCase())+1)+"-"+pad(m[2]));
  return [...out]}
function textRefs(texts){const all=(texts||[]).filter(Boolean).join("\n"),amounts=new Set(),tickets=new Set(),phones=new Set();
  (all.match(/\$\s?\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?|\b\d{1,4}\.\d{2}\b/g)||[]).forEach(a=>{const v=Number(a.replace(/[$,\s]/g,""));if(v>0&&v<5000)amounts.add(r2(v))});
  for(const m of all.matchAll(/(?:#|\bC(?=\d)|\b(?:ticket|tkt)\s*(?:#|number|no\.?)?|\border\s*(?:#|number|no\.?))\s?(\d{1,4})\b/gi))tickets.add(String(Number(m[1])));
  (all.match(/\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b/g)||[]).forEach(p=>phones.add(p.replace(/\D/g,"")));
  return {amounts:[...amounts],tickets:[...tickets],phones:[...phones],yesterday:YESTERDAY_RE.test(all),dates:datesIn(all),comp:COMP_RE.test(all)}}
function mergeRefs(a,b){const u=(x,y)=>[...new Set([].concat(x||[],y||[]).map(String))];a=a||{};b=b||{};
  return {amounts:u(a.amounts,(b.amounts||[]).map(Number).filter(n=>n>0).map(r2)).map(Number),tickets:u(a.tickets,(b.tickets||[]).map(t=>String(t).replace(/\D/g,"")).filter(Boolean)),
    phones:u(a.phones,(b.phones||[]).map(p=>String(p).replace(/\D/g,"")).filter(p=>p.length>=7)),names:u([],b.customerNames),items:u([],b.items),orderType:b.orderType||"",
    wids:u(a.wids,[]),yesterday:!!a.yesterday||(b.times||[]).some(t=>YESTERDAY_RE.test(String(t))),dates:u(a.dates,(b.times||[]).flatMap(datesIn)),comp:!!a.comp}}
/* rank the restaurant's orders against the references; a clear winner is linked, close calls are left for the reviewer.
   An order WIRA itself ties to the chat (refs.wids) comes first. A ticket number repeats every day, so the chat's own day wins unless the chat says yesterday or names the date.
   An amount counts as much as it is rare: one order that day with exactly that total (5) counts more than its item subtotal or "30% of the order" (3, and the 30% only on a money chat), because a menu price equals the subtotal of a one-item order; a round dollar amount counts half */
function rankOrders(orders,refs,chatAt){const t0=ldTs(chatAt),day0=String(chatAt||"").slice(0,10),prev=day0?addDaysU(day0,-1):"",dayOf=o=>String(o.at||"").slice(0,10);
  const O=(orders||[]).filter(o=>o.ticket||o.total>0||o.items>0),tix=refs.tickets||[],wids=refs.wids||[],amts=(refs.amounts||[]).filter(a=>a>MIN_AMT);
  const named=d=>!!d&&((refs.yesterday&&d===prev)||(refs.dates||[]).includes(d.slice(5)));
  const todayTicket=new Set(O.filter(o=>o.ticket&&tix.includes(o.ticket)&&dayOf(o)===day0).map(o=>o.ticket)),namedTicket=new Set(O.filter(o=>o.ticket&&tix.includes(o.ticket)&&dayOf(o)!==day0&&named(dayOf(o))).map(o=>o.ticket));
  const how=(a,o)=>Math.abs(a-o.total)<=0.01?"total":o.items>0&&Math.abs(a-o.items)<=0.01?"items":refs.comp&&o.total>0&&(Math.abs(a/0.3-o.total)<=0.05||(o.items>0&&Math.abs(a/0.3-o.items)<=0.05))?"pct":"";
  const seen=new Map(),key=(a,k,o)=>a+"|"+(k==="pct"?"pct":"x")+"|"+dayOf(o);
  amts.forEach(a=>O.forEach(o=>{const k=how(a,o);if(k)seen.set(key(a,k,o),(seen.get(key(a,k,o))||0)+1)}));
  return O.map(o=>{let score=0,strong=false,assoc=false;const why=[];
    if(wids.includes(o.id)){score+=10;strong=assoc=true;why.push("WIRA ties this order to the chat")}
    if(o.ticket&&tix.includes(o.ticket)){const d=dayOf(o);
      if(d&&!named(d)&&namedTicket.has(o.ticket)){score+=2;why.push(`ticket ${o.ticket} mentioned, but the chat names another day`)}
      else if(d&&d!==day0&&todayTicket.has(o.ticket)&&!named(d)){score+=2;why.push(`ticket ${o.ticket} mentioned, but the chat's own day has one too`)}
      else if(d&&d!==day0&&d!==prev&&!named(d)){score+=2;why.push(`ticket ${o.ticket} mentioned, but on another day than the chat`)}
      else{score+=5;strong=true;why.push(`ticket ${o.ticket} mentioned`)}}
    amts.forEach(a=>{const k=how(a,o);if(!k)return;
      const n=seen.get(key(a,k,o))||1,base=k==="total"?5:3,w=Math.round(base*(n===1?1:n===2?0.5:0)*(a===Math.round(a)?0.5:1)*10)/10;
      if(w>0){score+=w;why.push(k==="total"?`total ${money(o.total)} mentioned`:k==="items"?`item subtotal ${money(o.items)} mentioned`:`${money(a)} is 30% of this order`)}});
    if(refs.orderType&&o.type&&refs.orderType===o.type)score+=1;
    const at=ldTs(o.at);if(!isNaN(at)&&!isNaN(t0)){if(at<=t0&&t0-at<=12*36e5)score+=1;else if(at>t0)score-=2}
    return {order:o,score,why,strong,assoc}}).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||String(b.order.at).localeCompare(String(a.order.at))).slice(0,5)}
/* WIRA's own tie is linked (up to 3 orders), with any other order the chat names by ticket. Otherwise one order: a ticket match needs a score of 5, amounts alone need 6 (a unique total that came just before the chat, or two amounts that agree).
   A close second leaves it to the reviewer */
function linkedOrders(ranked){if(!ranked.length)return [];
  const wira=ranked.filter(r=>r.assoc);
  if(wira.length)return wira.concat(ranked.filter(r=>!r.assoc&&r.strong&&r.score>=5)).slice(0,3).map(r=>r.order);  /* plus an order the text names that WIRA did not tie: a wrong bag, a swapped order */
  const top=ranked[0];if(top.score<(top.strong?5:6))return [];if(ranked[1]&&ranked[1].score>=top.score-1)return [];return [top.order]}
function callsByIdsConfig(ids,from,to){return {exploreName:PULL.explore,dimensions:CALL_DIMS,metrics:[],sorts:[{fieldId:"calls_call_started_at_est",descending:false}],limit:PULL.cap,
  filters:{dimensions:`calls_call_started_at_est_day inBetween=${from},${to} AND calls_conversation_id equals=${ids.map(ldVal).join(",")}`}}}
function phoneCallsConfig(phones,from,to,code){return {exploreName:PULL.explore,dimensions:CALL_DIMS,metrics:[],sorts:[{fieldId:"calls_call_started_at_est",descending:false}],limit:PULL.cap,
  filters:{dimensions:`calls_call_started_at_est_day inBetween=${from},${to} AND calls_call_phone_detail equals=${phones.map(ldVal).join(",")}`+(code?` AND restaurants_unique_code equals=${ldVal(code)}`:"")}}}
function callRow(x){return {id:String(x.calls_conversation_id||""),at:String(x.calls_call_started_at_est||"").slice(0,19),sec:Number(x.calls_call_duration_in_seconds)||0,
  agent:cleanAgent(x.internal_users_full_name||""),login:String(x.internal_users_user_login_name||""),dir:x.calls_call_type==="outbound_call"?"out":"in",
  phone:String(x.calls_call_phone_detail||""),code:String(x.restaurants_unique_code||""),text:String(x.asr_transcript_call_transcript||"")}}

/* ---------- 2b. Outbound calls the chat's SA made while working the chat ---------- */
/* one query per chat: the SA's outbound calls over the days the chat's window touches (no transcripts; those are fetched only for the calls that are kept).
   The agent is matched by login, the way the roster matches the SA (every login the SA has used) */
const SAOUT_DIMS = CALL_DIMS.filter(d=>d!=="asr_transcript_call_transcript").concat(["restaurants_unique_code"]);
function saOutboundConfig(logins,from,to){return {exploreName:PULL.explore,dimensions:SAOUT_DIMS,metrics:[],sorts:[{fieldId:"calls_call_started_at_est",descending:false}],limit:CHAT.outLimit,
  filters:{dimensions:`calls_call_started_at_est_day inBetween=${from},${to} AND calls_call_type equals=outbound_call AND internal_users_user_login_name equals=${logins.map(ldVal).join(",")}`}}}
const last10 = p => String(p||"").replace(/\D/g,"").slice(-10);
/* the window a chat is worked in: from 5 min before it opened to 60 min after it closed; an open chat gets 24 h, cut at the pull's end (until) */
function chatWindow(c,closedAt,until){const o=ldTs(c.at);if(isNaN(o))return null;
  const lo=o-CHAT.outBeforeMin*6e4,cl=ldTs(closedAt);let hi=!isNaN(cl)?cl+CHAT.outAfterMin*6e4:o+CHAT.outOpenH*36e5;
  if(isNaN(cl)){const u=ldTs(until);if(!isNaN(u))hi=Math.min(hi,u)}
  return {lo,hi:Math.max(lo,hi),open:isNaN(cl)}}
function relMin(ms,c,closedAt){const o=ldTs(c.at),cl=ldTs(closedAt),fmt=m=>m<120?`${m} min`:`${Math.round(m/6)/10} h`;
  if(!isNaN(cl)&&ms>cl){return `${fmt(Math.round((ms-cl)/6e4))} after the chat closed`}
  const d=Math.round((ms-o)/6e4);return d>=0?`${fmt(d)} after the chat opened`:`${fmt(-d)} before the chat opened`}
/* Which of the SA's outbound rows belong to this chat.
   in:  c (chat row), rows (callRow objects), phones {customer:[..],restaurant:[..]} (10-digit), closedAt, until, logins, siblings (the pull's other chats; optional)
   A call is kept when (a) the dialed number is one the chat, its tasks or its orders mention (match "phone"), else (b) the call's restaurant code is the chat's (match "restaurant"), else dropped.
   A restaurant-only match is also dropped when another chat of the same SA and restaurant has the call inside its window (the SA may have been working that one).
   out: {kept:[call with link/match/why], stats:{rows,inWindow,phone,restaurant,other,ambiguous}} */
function linkSaOutbound(c,rows,o){o=o||{};const W=chatWindow(c,o.closedAt,o.until),st={rows:(rows||[]).length,inWindow:0,phone:0,restaurant:0,other:0,ambiguous:0,late:0,deduped:0},kept=[];
  if(!W)return {kept,stats:st};
  const cust=new Set(((o.phones||{}).customer||[]).map(last10).filter(x=>x.length===10)),rest=new Set(((o.phones||{}).restaurant||[]).map(last10).filter(x=>x.length===10));
  const logins=new Set((o.logins||[]).map(x=>String(x).toLowerCase())),code=String(c.code||"").toUpperCase(),first=String(c.sa||"The SA").split(/\s+/)[0];
  const sibs=(o.siblings||[]).filter(s=>s&&String(s.sid)!==String(c.sid)&&s.sa===c.sa&&code&&String(s.code||"").toUpperCase()===code).map(s=>({w:chatWindow(s,(s.timing&&s.timing.closedAt)||s.closedAt||"",o.until)})).filter(s=>s.w);
  const clock=ms=>clock12u(ms);
  const seen=new Set();
  (rows||[]).forEach(l=>{if(!l.id||seen.has(l.id))return;seen.add(l.id);
    const t=ldTs(l.at);if(isNaN(t)||t<W.lo||t>W.hi||l.dir!=="out")return;
    if(logins.size&&!logins.has(String(l.login||"").toLowerCase()))return;
    st.inWindow++;const ph=last10(l.phone),lc=String(l.code||"").toUpperCase();
    let match="",whose="";
    if(ph.length===10&&cust.has(ph)){match="phone";whose="the customer's number"}
    else if(ph.length===10&&rest.has(ph)){match="phone";whose="the restaurant's number"}
    else if(code&&lc&&lc===code)match="restaurant";
    if(!match){st.other++;return}
    const shared=sibs.some(s=>t>=s.w.lo&&t<=s.w.hi);
    /* a restaurant-only match must be close to the chat: within 3 h of its opening, or in the 60 min after it closed. A phone match keeps the whole window */
    if(match==="restaurant"){const cl=ldTs(o.closedAt);
      if(!(t<=ldTs(c.at)+CHAT.outRestH*36e5||(!isNaN(cl)&&t>=cl&&t<=cl+CHAT.outAfterMin*6e4))){st.late++;return}}
    if(match==="restaurant"&&shared){st.ambiguous++;return}
    st[match]++;
    const rel=relMin(t,c,o.closedAt);
    const why=(match==="phone"?`${first} called ${whose} …${ph.slice(-4)} at ${clock(t)}, ${rel}`:`${first} made an outbound call at ${clock(t)}, ${rel}; it is logged to this chat's restaurant ${code} and the number is not in the chat`)+(shared?`; ${first} had another chat open for this restaurant`:"");
    kept.push(Object.assign({},l,{link:"sa_outbound",match,why,shared}))});
  return {kept,stats:st}}

/* ---------- 3. Money: always computed here, never by Claude ---------- */
const CHAT_POLICY_EMPTY = {version:"",text:"",comp:{base:"items",approvalLimit:25,approver:"",buckets:[]}};
function compFor(A,orders,policy){policy=policy||CHAT_POLICY_EMPTY;const P=policy.comp||CHAT_POLICY_EMPTY.comp;
  const b=(P.buckets||[]).find(x=>x.id===(A&&A.bucket&&A.bucket.id));const o=(orders||[]).find(x=>A&&A.affectedOrder&&(x.label===A.affectedOrder||x.id===A.affectedOrder))||null;
  const out={bucket:b?b.id:"",label:b?b.label:"",pct:b?b.pct:null,order:o?o.label||o.id:"",base:o?o.items:null,baseLabel:"item subtotal",fee:null,amount:null,formula:"",needsApproval:false,limit:P.approvalLimit};
  if(!b)return Object.assign(out,{formula:"No policy bucket chosen"});
  if(!b.pct){out.amount=0;out.formula=`${b.label}: no compensation`;return out}
  if(!o)return Object.assign(out,{formula:`${b.pct}% of the affected order's items (order not linked)`});
  const fee=b.deliveryFee&&A.selfDelivery&&Number(A.deliveryFee)>0?r2(A.deliveryFee):0;out.fee=fee||null;
  out.amount=r2(o.items*b.pct/100+fee);
  out.formula=`${b.pct}% × ${money(o.items)} items${fee?` + ${money(fee)} delivery fee`:""} = ${money(out.amount)}`;
  out.needsApproval=out.amount>(P.approvalLimit||25);return out}
/* what the SA's offer was built on, if it matches a simple formula */
function offerCheck(offer,comp,orders){const a=offer&&Number(offer.amount);if(!(a>=0)||offer.amount==null)return {amount:null,match:"none",note:"No amount offered"};
  const res={amount:r2(a),match:"other",note:""};
  if(comp&&comp.amount!=null&&Math.abs(a-comp.amount)<=0.01)return Object.assign(res,{match:"right",note:"Matches the policy amount"});
  const o=(orders||[]).find(x=>comp&&(x.label===comp.order||x.id===comp.order));
  if(o&&comp.pct){
    if(Math.abs(a-r2(o.total*comp.pct/100))<=0.01)return Object.assign(res,{match:"wrong_base",note:`${comp.pct}% of the full bill ${money(o.total)} (tax${o.tip?", tip":""}${o.other?", fees":""} included) instead of ${money(o.items)} items`});
    if(Math.abs(a-o.total)<=0.01)return Object.assign(res,{match:"full_bill",note:`The full bill ${money(o.total)}`})}
  if(comp&&comp.amount!=null)res.note=`${money(a)} vs the policy amount ${money(comp.amount)}`;
  return res}

/* ---------- 3b. The compensation check: what was due, what the SA gave, and exactly how it went wrong ----------
   Compensation cases only, and all arithmetic on Tarro's order data. Claude supplies only the policy row, the affected order, whether the SA gave or
   promised compensation, the amount and where it is written, and whether a lead approved it. The result sets Resolution accuracy (amt). */
const COMP_ERR = {tax:"Taxes included", tip:"Tip included", fees:"Fees included", pct:"Wrong percentage", order:"Wrong order", fee_missing:"Delivery fee left out",
  rounding:"Rounded", math:"Math error", not_recorded:"Amount not recorded", not_given:"Not offered", not_due:"Not due", shared:"Offered on a shared fault without approval",
  over_limit:"Over the limit without approval"};
/* which formula the SA's amount came from: the affected order first (every base, every policy %, with and without the delivery fee), then other orders that day (items or total at the due %) */
function compDiagnose(g,due,orders,day,P){
  const pcts=[...new Set([due.pct].concat((P.buckets||[]).map(b=>b.pct).filter(x=>x>0)))],fee=due.fee||0;
  const aff=(orders||[]).find(o=>o.label===due.order||o.id===due.order)||null;
  const parts=o=>[[[],o.items],[["tax"],o.items+o.tax],[["tip"],o.items+o.tip],[["fees"],o.items+o.other],[["tax","tip"],o.items+o.tax+o.tip],[["tax","fees"],o.items+o.tax+o.other],[["tax","tip","fees"],o.items+o.tax+o.tip+o.other]]
    .filter(([p])=>p.every(x=>x==="tax"?o.tax>0:x==="tip"?o.tip>0:o.other>0));
  const baseL=(o,p,b)=>p.length?`${money(b)} (items ${money(o.items)}${p.includes("tax")?` + tax ${money(o.tax)}`:""}${p.includes("tip")?` + tip ${money(o.tip)}`:""}${p.includes("fees")?` + fees ${money(o.other)}`:""})`:`${money(o.items)} items`;
  const tryO=(o,pl,bases)=>{for(const pct of pl)for(const [p,b] of bases)for(const f of fee?[fee,0]:[0]){const v=r2(b*pct/100+f);if(Math.abs(v-g)>0.011)continue;
    const codes=[];if(aff&&o!==aff)codes.push({code:"order",detail:`Built on ticket ${o.ticket||"?"} instead of ticket ${aff.ticket||"?"}.`});
    if(pct!==due.pct)codes.push({code:"pct",detail:`Used ${pct}% where "${due.label}" is ${due.pct}%.`});
    p.forEach(x=>codes.push({code:x,detail:x==="tax"?`Tax (${money(o.tax)}) was in the base. Compensation is on the food only.`:x==="tip"?`The tip (${money(o.tip)}) was in the base.`:`Fees (${money(o.other)}) were in the base.`}));
    if(fee&&!f)codes.push({code:"fee_missing",detail:`Self-delivery: the ${money(fee)} delivery fee goes on top.`});
    if(codes.length)return {formula:`${pct}% × ${baseL(o,p,b)}${f?` + ${money(f)} delivery fee`:""} = ${money(v)}`,codes}}return null};
  if(aff){const m=tryO(aff,pcts,parts(aff));if(m)return m}
  for(const o of (orders||[]).concat((day||[]).filter(x=>!(orders||[]).some(y=>y.id===x.id))))if(o!==aff){const m=tryO(o,[due.pct],parts(o).filter(([p])=>!p.length||p.length===3));if(m)return m}
  return null}
function compCheck(A,k,policy){policy=policy||CHAT_POLICY_EMPTY;const P=policy.comp||CHAT_POLICY_EMPTY.comp,lim=P.approvalLimit||25,sa=((k&&k.chat&&k.chat.sa)||"The SA").split(" ")[0];
  if(!A||(A.caseType&&A.caseType!=="compensation"))return {applies:false};
  const orders=(k&&k.orders)||[],due=compFor(A,orders,policy),so=A.saOffer||{},ap=A.approval||{};
  const g=so.amount==null||isNaN(so.amount)?null:r2(so.amount),gave=so.given===true||g!=null;
  const out={applies:true,due,given:{amount:g,given:gave,where:so.where||"",text:so.text||"",cites:so.cites||[]},status:"unknown",errors:[],flags:[],computed:"",diff:null,score:null,summary:""};
  const err=(code,detail)=>out.errors.push({code,label:COMP_ERR[code],detail});
  if(!due.bucket){out.summary="No policy row was chosen, so the amount due is unknown.";return out}
  if(!due.pct){if(gave){out.status="not_due";out.score=0;err("not_due",`"${due.label}": nothing was due, but ${g!=null?money(g):"compensation"} was given.`)}
    else{out.status="none_due";out.score="na"}
    out.summary=gave?out.errors[0].detail:`"${due.label}": nothing due, nothing given.`;return out}
  /* shared or unclear fault: the policy says don't offer; escalate if the client insists. Above the limit: hold until the lead approves. Holding is right, and Escalation scores it */
  const shared=["shared_tarro","shared_other","unclear"].includes(A.fault&&A.fault.who);
  if(!gave&&(shared||due.needsApproval)){out.status="held";out.score="na";out.summary=shared?"Shared or unclear fault: compensation isn't offered unless a lead approves it.":`Above the ${money(lim)} limit: compensation waits for ${P.approver||"the lead"}'s approval.`;return out}
  if(!gave){out.status="missing";out.score=0;err("not_given",`Compensation was due${due.amount!=null?` (${money(due.amount)})`:""} and none was given or promised.`);out.summary=out.errors[0].detail;return out}
  /* offering on a shared fault without approval is a process miss (Escalation / Resolution path), flagged here, not an amount error */
  if(shared&&ap.approved!==true)out.flags.push({code:"shared",label:COMP_ERR.shared,detail:`The fault is shared or unclear, and ${sa} offered compensation without ${P.approver||"the lead"}'s approval.`});
  if(g==null){out.status="not_recorded";out.score=0;err("not_recorded","Compensation was given or promised, but its amount is written nowhere: not in the chat, a note or a WIRA ticket.");
    out.summary=`${out.errors[0].detail}${due.amount!=null?` Due: ${due.formula}.`:""}`;return out}
  if(due.amount==null){out.summary=`${sa} gave ${money(g)}. The affected order isn't linked, so the amount can't be checked.`;return out}
  out.diff=r2(g-due.amount);
  if(Math.abs(out.diff)<0.005&&!out.errors.length){out.status="right";out.score=3;out.computed=due.formula;out.summary=`Right: ${due.formula}.`}
  else if(Math.abs(out.diff)<0.005){out.status="wrong";out.score=1;out.computed=due.formula;out.summary=`${due.formula}, but ${out.errors[0].detail.charAt(0).toLowerCase()+out.errors[0].detail.slice(1)}`}
  else{const m=compDiagnose(g,due,orders,(k&&k.allOrders)||[],P);
    if(m){out.computed=m.formula;m.codes.forEach(c=>err(c.code,c.detail))}
    else if(Math.abs(out.diff)<1&&Math.round(g*100)%50===0)err("rounding",`${money(g)} instead of the exact ${money(due.amount)}.`);
    else err("math",`${money(g)} matches no policy formula on this order.`);
    const minor=out.errors.every(e=>e.code==="rounding");out.status=minor?"minor":"wrong";out.score=minor?2:1;
    out.summary=`Due ${money(due.amount)} (${due.formula}). ${sa} gave ${money(g)}${out.computed?`: ${out.computed}`:""}. ${out.diff>0?"Over":"Under"} by ${money(Math.abs(out.diff))}.`}
  /* above the limit the lead approves before the client is told; that is an escalation matter, flagged here and scored under Escalation */
  if(g>lim&&ap.approved!==true)out.flags.push({code:"over_limit",label:COMP_ERR.over_limit,detail:`${money(g)} is above the ${money(lim)} limit; ${P.approver||"the lead"} must approve before the client is told.`});
  return out}

/* ---------- 4. Prompts ---------- */
const CHAT_CTX = "Tarro answers the phones and runs the POS, online ordering and delivery for pizza restaurants. The restaurant is Tarro's client. Super Agents (SAs) support clients through WIRA chat and phone. AEs/CSMs manage client accounts; leads (e.g. Howard Ho) approve exceptions.";
const EVIDENCE_RULES = [
  `- Some facts live where Tarro can't see them: the client's own online ordering or website, what their kitchen made, payments taken in store. There the client's own account is acceptable evidence. Note that it is the client's word; do not mark the SA down for not verifying what Tarro has no access to.`,
  `- Linked tasks, orders and recordings were matched automatically and can belong to another case. Use only what matches this chat's request; never judge the SA on another case.`,
  `- This record is not everything the SA could see. The SA works in GreenDot (tickets with item notes, payment records, menu, printer and account settings) and can play recordings that are not linked here. A cant_check claim is not a mistake and costs the SA nothing; only a contradicted claim counts against the SA.`,
  `- If a point can't be settled only because this record lacks something the SA could see, and the SA's account fits the client's report and any recordings, take the SA's account as the working fact and say it is unverified. Never conclude the SA skipped a check because this record doesn't show it.`,
  `- Chat messages have no times. A call that started after the chat opened happened while the chat was going on; don't place it before or after a message unless a message refers to it, and never fault the SA on an order of events you can't see.`];
const SCORE_ONCE = [`- Score each flaw once, in the one criterion it belongs to, and nowhere else:`,
  `  a defense or conclusion before checking: First response if it was in the first reply, otherwise Gathered the evidence (never both) · a wrong account of what happened given to the client: Restated · blaming the wrong party for the client's problem: Fault attribution · the wrong action or next step for the client: Resolution path · a wrong number, base or terms, or an amount recorded nowhere: Resolution accuracy · the client left unsure what they get, why or when (including an amount the client asked for and didn't get): Solution explained · how the lead was told or asked (summary, recommendation, logic): Escalation · tone, ownership, over-promising: Reply quality.`,
  `  Fault attribution is about the problem the client brought, not the SA's own slips in this chat (a misread request, a wrong first answer); those count once where they happened.`,
  `  When the SA corrected a wrong statement and ended right, score the other criteria on where the SA ended; the slip counts once, where it happened.`,
  `- Marks: 3 right · 2 right with a small gap · 1 attempted but wrong in a way that matters · 0 not done, or the opposite of what was needed.`].join("\n");
const NO_PRONOUNS = `- Refer to people by name or role, never as he or she.`;
/* the QA lead's standing grading decisions (Oct 14) */
const leadRules = sa => [
  `- Grade only what ${sa} wrote or did. Messages from another SA, an AE or a lead are context. If another SA answered the client in this chat, credit ${sa} for a clean handoff (the other SA had what was needed and the client wasn't left waiting) and mark down only ${sa}'s own gaps.`,
  `- A compensation amount counts wherever ${sa} recorded it: in the chat, an internal note or a WIRA ticket. ${sa} doesn't have to tell the client the amount unless the client asks; if asked, ${sa} must give it and explain it. Compensation given or promised with its amount recorded nowhere is a failed Resolution accuracy (0).`,
  `- When ${sa} didn't keep a promise an earlier Tarro agent made, judge how ${sa} read the situation (noticed the promise; had a sound reason not to keep it, such as the restaurant's decision, the policy or a lead's call) and how ${sa} managed it with the client (acknowledged it, explained, offered what was possible). The decision counts under Resolution path, the handling under Reply quality.`];
const SPEAKER_RULES = [
  `Who said it, in call transcripts (the hardest part; get it right):`,
  `- Transcripts are machine speech-to-text with NO speaker labels. "Darrow", "Tauro", "Taro", "Tiro" or "Tyro" usually means Tarro.`,
  `- The Tarro agent is the person named in the call header. Agents use an alias and often answer as the restaurant ("<restaurant name>, pickup or delivery?", "This is Sam, the manager"). That greeting is the agent. Always write the agent's header name.`,
  `- The other side is usually the customer ordering food, or restaurant staff. The agent's turns are mostly greetings, read-backs, totals, questions and the agent's own actions or offers. Reports of what happened almost always come from the caller.`,
  `- A question or read-back is not a claim. If a line can't be placed on one speaker with confidence, set "who" to "unclear". An "unclear" fact is fine; a fact on the wrong person is a serious error.`];
/* WIRA forms store money in minor units ("5910mu usd" = $59.10) */
const muUsd = s => String(s||"").replace(/\b(\d+)\s*mu\s*usd\b/gi,(m,n)=>money(Number(n)/100));
function chatEvidence(k){const c=k.chat,L=[];
  L.push(`CHAT ${c.sid} · ${c.restaurant}${c.code?` (${c.code})`:""} · opened ${c.at.replace("T"," ")} ET · ${c.initiator==="client"?"started by the client (M1 is the client's message)":c.initiator==="ae"?`created by AE ${c.createdBy}`:"started by "+(c.createdBy||"staff")}`);
  L.push(`Audited SA: ${c.sa}${c.frt!=null?` · first reply ${c.frt} min after the first client message`:""} · status ${c.status}${c.sub?" / "+c.sub:""}`);
  L.push(`Messages are in order; WIRA keeps no per-message times. Internal notes are inferred from the text (an @mention, or staff talking about the client); if one clearly reads as written to the client, treat it as client-visible.`);
  chatTimingLines(k.timing||c.timing,c).forEach((x,i)=>L.push(...(i?[x]:["",x])));
  L.push("",chatTranscript(c));
  if((k.tasks||[]).length){L.push("","LINKED TASKS");k.tasks.forEach(t=>{L.push(`\nTASK ${t.sid}${t.parent===c.wid?" (child of this chat)":" (the SA's other task at this restaurant; may be another case)"} · created ${t.at.replace("T"," ")} ET by ${t.by||"unknown"} · assigned ${t.assigned||"nobody"} · ${t.intent||t.project} · status ${t.status}`);
    L.push(`Title: ${t.title}`);if(t.desc)L.push(`Description: ${t.desc}`);if(t.fields&&t.fields!=="{}")L.push(`Fields: ${capText(muUsd(t.fields),300)}`);
    t.comments.forEach(cm=>L.push(`- ${cm.who||"someone"}: ${cm.text}`))})}
  if((k.orders||[]).length){L.push("","LINKED ORDERS (Tarro's order data, matched automatically from clues in the chat and tasks; may be wrong)");k.orders.forEach(o=>L.push(`${o.label} · ticket ${o.ticket||"?"} · created ${o.at.replace("T"," ")} ET · ${o.source}${o.type?" · "+o.type:""}${o.coupon?" · coupon "+o.coupon:""} · items ${money(o.items)} + tax ${money(o.tax)}${o.tip?" + tip "+money(o.tip):""}${o.other?` + other ${money(o.other)}`:""} = total ${money(o.total)}${orderState(o)?" · STATUS "+orderState(o):o.status?" · status "+o.status:""}`))}
  else L.push("","LINKED ORDERS: none matched with confidence.");
  if(k.orderNote)L.push(k.orderNote);
  let budget=CHAT.budget;
  if((k.calls||[]).length){L.push("","LINKED CALL RECORDINGS (the linked order's calls and the same caller's other calls; may be wrong)");k.calls.forEach((l,i)=>{let tx=String(l.text||"").trim();if(tx.length>CHAT.txCap)tx=tx.slice(0,CHAT.txCap)+" …";if(tx.length>budget)tx=tx.slice(0,Math.max(0,budget))+" …";budget-=tx.length;
    const when=c.at&&l.at?(l.at>=c.at?"after the chat opened":"before the chat opened"):"";
    L.push(`\nCALL ${i+1} · ${l.at.replace("T"," ")} ET${when?` (${when})`:""} · ${dur(l.sec)} · agent ${l.agent||"unknown"} · ${l.dir==="out"?"outbound to":"inbound from"} …${String(l.phone).slice(-4)}${l.orders?` · tied to ${l.orders}`:""}\n${tx||"[no transcript]"}`)})}
  else L.push("","LINKED CALL RECORDINGS: none found.");
  if((k.slack||[]).length){L.push("","SLACK");k.slack.forEach(t=>{L.push(`#${t.channel} · ${t.author||"someone"}: ${capText(t.text,600)}`);(t.replies||[]).forEach(r=>L.push(`- reply · ${r.who}: ${capText(r.text,300)}`))})}
  if(k.notFound&&k.notFound.length)L.push("","LOOKED FOR BUT NOT IN THE DATA: "+k.notFound.join("; "));
  return L.join("\n")}
function chatRefsPrompt(k){return [`You are helping a QA lead at Tarro find the order a support chat is about. ${CHAT_CTX}`,
  `Read the chat and tasks below. List every reference that could identify the order or the phone call it is about. Copy what is written; do not interpret.`,
  `Reply with only a JSON object: {"tickets": ["ticket or check numbers, e.g. C46 -> 46"], "amounts": [dollar amounts as numbers], "customerNames": [], "phones": [], "items": ["menu items mentioned"], "orderType": "pickup | delivery | empty", "times": ["times mentioned"]}`,
  ``,`CHAT ${k.chat.sid} · ${k.chat.restaurant} · opened ${k.chat.at.replace("T"," ")} ET`,chatTranscript(k.chat)].concat((k.tasks||[]).map(t=>`\nTASK ${t.sid}: ${t.title}\n${t.desc}`)).join("\n")}
function chatFactsPrompt(k){const sa=k.chat.sa||"the SA";
  return [`You are the note-taker for a QA lead at Tarro auditing one WIRA support chat. ${CHAT_CTX}`,
    `Write the record a reviewer will judge from. Be complete and exact. Do NOT judge: no fault, no root cause, no "should have".`,
    ``,`Rules:`,
    `- Record what was said or done, attributed to who said or did it. A claim stays a claim ("Client says the agent should not have submitted the order").`,
    `- Include internal notes as facts, marked as internal.`,
    `- Record what the call recordings and order data show, in the same attributed way, with times.`,
    `- If something isn't in the evidence, leave it out.`,
    `- Linked tasks, orders and recordings were matched automatically and can belong to another case. If one is about a different request, ticket, day or customer than this chat, record one fact saying it does not match this chat, and nothing else from it.`,
    NO_PRONOUNS,
    ...SPEAKER_RULES,
    ``,`Then CHECK THE SA'S CLAIMS. List every factual claim ${sa} made about what happened (to the client, in internal notes, or in tasks), e.g. "the customer chose pickup" or "the agent failed to confirm whether to keep the phone order". For each, check it against the recordings, order data and tasks:`,
    `- "supported": the evidence shows it. "contradicted": the evidence shows otherwise. "cant_check": the evidence here doesn't cover it (the SA may have seen it in GreenDot).`,
    `- Evidence is a short quote or fact from a call, order or task. Judge each claim on its own, including claims ${sa} later took back.`,
    ``,`Reply with only a JSON object:`,
    `{"brief": ["5 to 7 bullets, each under 18 words, that tell the case at a glance: what the client asked, what the order and calls show, what ${sa} did and said, how it ended. Facts only, no judging."],`,
    ` "calls": [{"n": 1, "bullets": ["3 to 5 bullets, each under 15 words: who called and why, what happened, how it ended"]}],`,
    ` "timeline": [{"src": "M3 | Call 2 | O1 | Task 1234567 | Slack | Header", "when": "time if known, else empty", "who": "who said or did it, or unclear", "kind": "said | did | internal", "what": "the fact, under 25 words"}],`,
    ` "claims": [{"src": "M3", "claim": "what ${sa} claimed, under 20 words", "check": "supported | contradicted | cant_check", "evidence": "quote or fact, under 25 words"}],`,
    ` "promises": [{"src": "M8", "who": "", "to": "", "what": "under 12 words"}]}`,
    `"timeline" puts recordings and orders in time order first, then the chat in message order. A chat fact's src is its message number (M1, M2…); "Header" is only for when and by whom the chat was opened. "calls" has one entry per call recording, numbered as below.`,
    ``,chatEvidence(k)].join("\n")}
function chatFactLines(F){return F.timeline.map(t=>`${t.id} · ${[t.when,t.src].filter(Boolean).join(" · ")} · ${t.who||"someone"} [${t.kind}]: ${t.what}`).join("\n")+
  "\n\nSA CLAIMS CHECK\n"+(F.claims.length?F.claims.map(c=>`${c.id} · ${c.src} · ${c.check.toUpperCase()}: ${c.claim} — ${c.evidence}`).join("\n"):"No factual claims.")+
  "\n\nPROMISES\n"+(F.promises.length?F.promises.map(p=>`${p.id} · ${p.src} · ${p.who} to ${p.to}: ${p.what}`).join("\n"):"None.")}
function calibLines(cal){return (cal||[]).slice(0,CHAT.calibMax).map((c,i)=>`CASE ${i+1} · ${c.agent||"SA"} · ${c.restaurant||""} · ${c.date||""} · QA lead's verdict: ${String(c.verdict||"").toUpperCase()}\n`+(c.lessons||[]).map(l=>"- "+l).join("\n")).join("\n\n")}
/* the QA lead's corrections: findings marked "not a mistake" (newest first) */
function lessonLines(ls){return (ls||[]).slice(0,CHAT.lessonMax).map(l=>{const c=`${l.label||l.crit||"Finding"}${l.type?` · ${l.type}`:""}`,why=l.note||l.reason;
  if(l.kind==="reinforce")return `- ${c}${l.caseType?` (${l.caseType} case)`:""}: the coach gave ${l.from??l.to} and that mark is right, but the reasoning was off${l.what?` (coach's reason: "${capText(l.what,160)}")`:""}. The right reason: ${capText(why||"",300)}`;
  if(l.kind==="contest")return `- ${c}${l.caseType?` (${l.caseType} case)`:""}: the coach gave ${l.from}, the QA lead says ${l.to}${why?`. Why: ${capText(why,300)}`:"."}${l.what?` (coach's reason: "${capText(l.what,160)}")`:""}`;
  return `- ${c}: the coach said "${capText(l.what||"",200)}"; the QA lead marked it not a mistake${why?`: ${capText(why,200)}`:"."}`}).join("\n")}
/* what the client asked for; only "compensation" uses the policy buckets and the money */
const CASE_TYPES = [
  ["compensation","the client reports an order problem that may be Tarro's mistake, or compensation was asked for, offered or promised"],
  ["order_issue","check or correct an order or a call (what the customer ordered, a recording request, a complaint) with no money at stake"],
  ["customer_recovery","the restaurant decides a credit, refund or remake for its own customer and the SA carries it out"],
  ["contact_customer","the restaurant asks Tarro to call or update a customer"],
  ["menu_setup","menu items, prices, modifiers or promos"],
  ["hours_service","opening hours, closures, turning call service or delivery on or off"],
  ["device_printer","printers, tablets, the POS app, receipts"],
  ["billing_payment","charges, card fees, payouts, statements"],
  ["order_admin","void an order, mark it paid or unpaid, change its type, dispatch or driver problems"],
  ["how_to","how to use Tarro's tools"],
  ["other","anything else"]];
function chatAnalysisPrompt(k,F,policy,cal,lessons){const sa=k.chat.sa||"the SA",P=(policy&&policy.comp)||CHAT_POLICY_EMPTY.comp;
  const buckets=(P.buckets||[]).map(b=>`${b.id} (${b.label}: ${b.pct}%${b.deliveryFee?", + delivery fee on self-delivery":""})`).join("; ")||"none loaded";
  return [`You are the analyst for a QA lead at Tarro. ${CHAT_CTX}`,
    `Below is the record of one support chat (facts F#, SA claims C#, promises P#) and the orders it was tied to (O#). Analyze it the way the QA lead does: FIRST the facts, THEN fault, THEN the right solution, THEN how the SA's solution compares. Use only the record and the policy; cite fact ids.`,
    ``,`Rules:`,
    `- Case type first, from what the client asked for in the chat (not from linked data):`,
    ...CASE_TYPES.map(([id,d])=>`  ${id}: ${d}`),
    `- Fault, by who caused the problem the client brought to the chat (not how the SA handled the chat):`,
    `  "tarro": a Tarro agent's or system's own action or omission caused it (a wrong instruction or quote, an item or note not entered, an order not confirmed or not cancelled), confirmed by the recording.`,
    `  "restaurant" or "customer": they caused it and Tarro followed process.`,
    `  "shared_tarro": the customer or restaurant caused it, and a Tarro agent could have caught it but didn't.`,
    `  "shared_other": Tarro followed process; the error came from ambiguous input or the restaurant's action.`,
    `  "unclear": the evidence conflicts or nobody could know. "none": nothing went wrong (a plain request).`,
    `  A customer or restaurant acting on a Tarro agent's instruction (told to order online, told to call back) is not their fault: the instruction is Tarro's. A client's claim is not proof; the recording is. Fault is about who caused it, not how sure we are: when the recording confirms a Tarro agent's own miss and the rest is the client's word about what Tarro can't see, it is "tarro".`,
    `- Compensation policy applies only to the compensation type. There, pick the bucket that fits the facts and the affected order (O#); pick the bucket even when no order is linked. "none" is only for a fault that isn't Tarro's. Do NOT calculate money; the system does it from the bucket and the order's item subtotal. For any other type, set bucket.id and affectedOrder to "" and saOffer.amount to null. A credit or refund the restaurant gives its own customer is not Tarro compensation.`,
    `- Say what the ideal SA would have done for the client (and the customer, if relevant), whether escalation to a lead was needed, and why.`,
    `- Record what ${sa} offered or recorded: given (compensation given or promised by ${sa}: true or false), the amount exactly as written (null if written nowhere), where it is written (chat, note or ticket), and whether ${sa}'s path matches the ideal. Copy the amount; never compute it.`,
    `- Approval: whether ${sa}'s amount or an exception needed a lead's approval (above the limit, or more than the policy gives), whether ${sa} asked, and whether the lead approved before the client was told.`,
    `- AE/CSM involvement: "over_head" (the client went over the SA to the AE), "corrected_sa" (the AE had to correct the SA), "ae_initiated" (the AE created the chat), "context" (the AE added context), or "none". Say whether ${sa} could reasonably have prevented it.`,
    `- First response: did ${sa}'s first substantive reply defend, blame or conclude before checking the evidence? Cite it.`,
    `- Follow the QA lead's calibration cases below where they apply; they show how the lead grades.`,
    ...leadRules(sa),
    ...EVIDENCE_RULES,
    NO_PRONOUNS,
    ``,`Reply with only a JSON object:`,
    `{"caseType": "${CASE_TYPES.map(c=>c[0]).join(" | ")}", "request": "what the client asked for, under 20 words",`,
    ` "summary": "what happened, 2-3 sentences",`,
    ` "fault": {"who": "tarro | restaurant | customer | shared_tarro | shared_other | unclear | none", "why": "one sentence", "cites": ["F2"]},`,
    ` "bucket": {"id": "one of: ${(P.buckets||[]).map(b=>b.id).join(" | ")||"none"}", "why": "one sentence", "cites": []},`,
    ` "affectedOrder": "O1 or empty", "selfDelivery": false, "deliveryFee": null,`,
    ` "ideal": {"client": "what the ideal SA tells and gives the client, under 40 words", "customer": "under 25 words, or empty"},`,
    ` "escalation": {"needed": true, "why": "under 25 words", "to": "who"},`,
    ` "saOffer": {"given": true, "amount": 12.34, "where": "chat | note | ticket | none", "text": "what ${sa} offered or recorded, under 20 words", "cites": ["F8"]},`,
    ` "approval": {"needed": false, "asked": false, "approved": false, "by": "", "cites": []},`,
    ` "saPath": {"match": "yes | partly | no", "why": "under 30 words"},`,
    ` "aeInvolvement": {"kind": "over_head | corrected_sa | ae_initiated | context | none", "saCouldPrevent": false, "why": "under 30 words"},`,
    ` "firstResponse": {"concludedBeforeEvidence": false, "why": "under 30 words", "cites": []}}`,
    `(The numbers in the example are placeholders.)`,
    ``,`COMPENSATION POLICY (${policy&&policy.version||"none loaded"})`,(policy&&policy.text)||"No policy loaded: say so in every answer that depends on it.",
    `Buckets: ${buckets}. Approval limit: ${money(P.approvalLimit)} (above it, ${P.approver||"the lead"} approves first).`,
    ``,`QA LEAD'S CALIBRATION CASES`,calibLines(cal)||"None yet.",
    ...(lessons&&lessons.length?[``,`QA LEAD'S CORRECTIONS (findings the lead marked "not a mistake", and right marks given for the wrong reason)`,lessonLines(lessons)]:[]),
    ``,`CHAT ${k.chat.sid} · ${k.chat.restaurant} · audited SA ${sa}`,
    `ORDERS`,(k.orders||[]).map(o=>`${o.label} · ticket ${o.ticket||"?"} · ${o.type||o.source} · items ${money(o.items)}, tax ${money(o.tax)}${o.tip?`, tip ${money(o.tip)}`:""}, total ${money(o.total)}${orderState(o)?` · ${orderState(o)}`:""}`).join("\n")||"None linked.",
    ``,`RECORD`,chatFactLines(F)].join("\n")}
/* naWhen (added): the only situation in which a row may be marked N/A; the grade prompt prints it */
const CHAT_RUBRIC = [
  {id:"fr",label:"First response",w:10,max:3,na:true,naWhen:"the SA started the chat, so there was no message to answer",d:"Acknowledges the issue, says what they're checking, asks only for what's needed. Does not defend, blame or conclude before checking the evidence."},
  {id:"ev",label:"Gathered the evidence",w:15,max:3,d:"Checked what the case needed before concluding or acting: the recording and the order for an order problem; the setup, settings or account for a request. Every factual claim holds up."},
  {id:"rs",label:"Restated the case correctly",w:10,max:3,d:"Told the client what happened, or confirmed the request back, accurately and plainly."},
  {id:"fa",label:"Fault attribution",w:15,max:3,na:true,naWhen:"nothing went wrong, so there was no fault to attribute (a plain request: menu, hours, settings, how-to)",d:"Correct fault; owned clearly when it's Tarro's; pushed back when it isn't."},
  {id:"path",label:"Resolution path",w:15,max:3,d:"Chose the right path for the case type: the policy path for compensation; for a request, the right action, team or ticket, confirmed with the client; for a customer credit, the restaurant's decision carried out."},
  {id:"amt",label:"Resolution accuracy",w:10,max:3,na:true,naWhen:"no compensation, credit, refund or fee was given, promised or due",d:"The amount and terms are exactly right, wherever the SA recorded them (chat, internal note or WIRA ticket): for Tarro compensation, the right base (items only), right % and fees handled; for a credit or refund the restaurant decided, exactly what the restaurant approved. Given or promised but recorded nowhere: 0. On compensation cases the system's compensation check sets this mark."},
  {id:"expl",label:"Solution explained",w:5,max:3,na:true,naWhen:"there was nothing to explain beyond confirming it was done",d:"The client understands what they get, why and when; explains the math when challenged. The SA need not state a compensation amount unless the client asks."},
  {id:"esc",label:"Escalation",w:15,max:4,na:true,naWhen:"no escalation was needed",d:"0 needed but not done · 1 tagged the lead · 2 + a summary the lead will read (chat or ticket) · 3 + a recommended solution, asking the lead's opinion · 4 + the recommendation is correct, with clear logic."},
  {id:"tone",label:"Reply quality",w:5,max:3,d:"Clear, warm, professional; owns mistakes; no over-promising."}];
const VERDICTS = [["great",90,"Great"],["good",80,"Good"],["okay",65,"Okay"],["needs_work",50,"Needs work"],["miss",0,"Miss"]];
function chatGradePrompt(k,F,A,comp,offer,cal,check,lessons){const sa=k.chat.sa||"the SA",first=sa.split(" ")[0];
  const sys=check&&check.applies&&check.score!=null;
  return [`You are Swift Coach, the QA lead's coaching assistant at Tarro. ${CHAT_CTX}`,
    `Grade how ${sa} handled this chat and coach ${sa.split(" ")[0]}. You have the record, the analysis and the system's compensation math. Do not re-decide the facts or the money; grade against them.`,
    ``,`The QA lead's route: (1) establish the case facts, (2) analyze them and attribute fault, (3) give the right solution, (4) reply well. Judge each step.`,
    ``,`SCORECARD (0-3 unless noted). Use "na" only where a row says "N/A when", and then always when that is true; never score a row that doesn't apply:`,
    ...CHAT_RUBRIC.map(r=>`- ${r.id} · ${r.label}${r.max!==3?` (0-${r.max})`:""}: ${r.d}${r.naWhen?` N/A when ${r.naWhen}.`:""}`),
    ...(A.fault&&A.fault.who==="none"?[`- The analysis found nothing went wrong, so fa is "na".`]:[]),
    ...(A.caseType&&!["compensation","customer_recovery"].includes(A.caseType)?[`- This is not a compensation or customer-credit case: amt is "na" unless the SA gave or set a credit, refund or fee in this chat.`]:[]),
    ...(sys?[`- amt is set by the system's compensation check below: score it ${check.score==="na"?'"na"':check.score} and give the check's reason.`]:[]),
    ``,`Rules:`,
    `- For each criterion write the reason first, then the score that follows from it. Every reason cites facts (F#, C#, M#) and says exactly what was right or wrong, in one sentence; an "na" reason says why the row doesn't apply.`,
    `- Use the calibration cases and the QA lead's corrections: they are how the QA lead grades.`,
    ...leadRules(sa),
    SCORE_ONCE,
    ...EVIDENCE_RULES,
    NO_PRONOUNS,
    `- Findings: one for every criterion scored below full marks (not for "na"), in the QA ticket format. type is a short name for the mistake ("Taxes in the base", "Defended before checking"). what: what ${first} did. evidence: 1-3 exact quotes, each copied word for word from one source (a chat message M#, a call, an order or a task) with that source; quotes are checked against the source. should: what ${first} should have done. model: a message ${first} could have sent; for an escalation, a Level 4 escalation (summary + recommendation + logic).`,
    `- Coaching is for ${first}. Plain, direct, specific.`,
    ``,`Reply with only a JSON object:`,
    `{"criteria": {${CHAT_RUBRIC.map(r=>`"${r.id}": {"why": "one sentence", "score": ${r.na?`"0-${r.max} or na"`:`"0-${r.max}"`}}`).join(", ")}},`,
    ` "route": {"facts": {"mark": "right | partly | wrong", "why": ""}, "analysis": {"mark": "", "why": ""}, "solution": {"mark": "", "why": ""}, "escalation": {"mark": "", "why": ""}},`,
    ` "wentWell": ["2-3 items, each under 20 words"],`,
    ` "findings": [{"criterion": "${CHAT_RUBRIC.map(r=>r.id).join(" | ")}", "type": "under 6 words", "what": "under 30 words", "why": "why it matters, under 25 words", "evidence": [{"src": "M8 | Call 2 | O1 | Task 1234567", "quote": "exact words from that source, under 25 words"}], "should": "under 30 words", "model": "a message ${first} could have sent"}],`,
    ` "verdictWhy": "two sentences on the overall grade"}`,
    ``,`QA LEAD'S CALIBRATION CASES`,calibLines(cal)||"None yet.",
    ``,`QA LEAD'S CORRECTIONS (marks the lead contested, findings marked "not a mistake", and right marks whose reasoning the lead corrected; grade and reason the same way)`,lessonLines(lessons)||"None yet.",
    ``,`ANALYSIS`,JSON.stringify({caseType:A.caseType,request:A.request,summary:A.summary,fault:A.fault,bucket:A.bucket,ideal:A.ideal,saOffer:A.saOffer,approval:A.approval,saPath:A.saPath,aeInvolvement:A.aeInvolvement,firstResponse:A.firstResponse}),
    A.caseType&&A.caseType!=="compensation"?`COMPENSATION: not a compensation case (${A.caseType}); the policy amount does not apply.`:
    check&&check.applies?`COMPENSATION CHECK (system, final): ${check.status}. ${check.summary}${check.errors.length?` Errors: ${check.errors.map(e=>`${e.label} (${e.detail})`).join("; ")}.`:""}${check.flags.length?` Flags: ${check.flags.map(f=>f.detail).join("; ")}`:""}`:
    `COMPENSATION MATH (system): right amount ${comp.amount==null?"unknown":money(comp.amount)} (${comp.formula}); ${sa} offered ${offer.amount==null?"nothing":money(offer.amount)}${offer.note?` — ${offer.note}`:""}.${comp.needsApproval?` Above the ${money(comp.limit)} approval limit.`:""}`,
    ``,`CHAT ${k.chat.sid} · ${k.chat.restaurant} · audited SA ${sa} · first reply ${k.chat.frt==null?"unknown":k.chat.frt+" min"}`,
    chatTranscript(k.chat),``,`RECORD`,chatFactLines(F)].join("\n")}

/* ---------- 5. Cleaning Claude's replies ---------- */
const chS=(v,n)=>capText(typeof v==="string"?v:v==null?"":String(v),n);
const arr=v=>Array.isArray(v)?v:[];
function cleanChatRefs(x){if(!x||typeof x!=="object")return {};return {tickets:arr(x.tickets).map(String).slice(0,10),amounts:arr(x.amounts).map(Number).filter(n=>n>0).slice(0,20),
  customerNames:arr(x.customerNames).map(String).slice(0,6),phones:arr(x.phones).map(String).slice(0,6),items:arr(x.items).map(String).slice(0,12),
  orderType:["pickup","delivery"].includes(String(x.orderType).toLowerCase())?String(x.orderType).toLowerCase():"",times:arr(x.times).map(String).slice(0,6)}}
const CHECKS=["supported","contradicted","cant_check"],KINDS=["said","did","internal"];
function cleanChatFacts(x,calls){if(!x||typeof x!=="object"||Array.isArray(x))return null;
  const callsOut={};arr(x.calls).forEach(k=>{const l=(calls||[])[Number(k&&k.n)-1];if(!l)return;const b=arr(k.bullets).map(t=>chS(t,200).replace(/^[-•*]\s*/,"")).filter(Boolean).slice(0,6);if(b.length)callsOut[l.id]=b});
  const timeline=arr(x.timeline).filter(t=>t&&t.what).slice(0,80).map((t,i)=>({id:"F"+(i+1),src:chS(t.src,40),when:chS(t.when,40),who:chS(t.who,60),kind:KINDS.includes(String(t.kind).toLowerCase())?String(t.kind).toLowerCase():"said",what:chS(t.what,260)}));
  const claims=arr(x.claims).filter(c=>c&&c.claim).slice(0,30).map((c,i)=>{const k=String(c.check||"").toLowerCase().replace(/[\s-]+/g,"_");return {id:"C"+(i+1),src:chS(c.src,20),claim:chS(c.claim,220),check:CHECKS.includes(k)?k:"cant_check",evidence:chS(c.evidence,260)}});
  const promises=arr(x.promises).filter(p=>p&&p.what).slice(0,15).map((p,i)=>({id:"P"+(i+1),src:chS(p.src,20),who:chS(p.who,60),to:chS(p.to,60),what:chS(p.what,160)}));
  /* brief (added chat-2): the case at a glance, 5-7 bullets */
  const brief=arr(x.brief).map(t=>chS(t,220).replace(/^[-•*]\s*/,"")).filter(Boolean).slice(0,8);
  if(!timeline.length)return null;return {brief,calls:callsOut,timeline,claims,promises}}
const FAULTS=["tarro","restaurant","customer","shared_tarro","shared_other","unclear","none"],AE_KINDS=["over_head","corrected_sa","ae_initiated","context","none"],MATCH=["yes","partly","no"];
function cleanChatAnalysis(x,F,policy){if(!x||typeof x!=="object"||Array.isArray(x))return null;const ids=new Set(F.timeline.map(t=>t.id).concat(F.claims.map(c=>c.id),F.promises.map(p=>p.id)));
  const cites=a=>arr(a).map(v=>String(v).trim().toUpperCase()).filter(v=>ids.has(v)).slice(0,8),o=v=>v&&typeof v==="object"?v:{},low=v=>String(v||"").trim().toLowerCase().replace(/[\s-]+/g,"_");
  const bucketIds=((policy&&policy.comp&&policy.comp.buckets)||[]).map(b=>b.id),f=o(x.fault),b=o(x.bucket),id=o(x.ideal),es=o(x.escalation&&typeof x.escalation==="object"?x.escalation:id.escalation),so=o(x.saOffer),sp=o(x.saPath),ae=o(x.aeInvolvement),fr=o(x.firstResponse);
  const amt=so.amount==null||so.amount===""?null:Number(String(so.amount).replace(/[$,]/g,""));
  const caseType=CASE_TYPES.some(c=>c[0]===low(x.caseType))?low(x.caseType):x.caseType==null||x.caseType===""?"":"other",comp=!caseType||caseType==="compensation";
  /* added fields: caseType (one of CASE_TYPES, "" when the reply has none) and request. Buckets, the affected order and the SA's offer only count on a compensation case */
  return {caseType,request:chS(x.request,200),summary:chS(x.summary,700),fault:{who:FAULTS.includes(low(f.who))?low(f.who):"unclear",why:chS(f.why,300),cites:cites(f.cites)},
    bucket:{id:comp&&bucketIds.includes(low(b.id))?low(b.id):"",why:chS(b.why,300),cites:cites(b.cites)},
    affectedOrder:comp&&/^O\d+$/i.test(String(x.affectedOrder||"").trim())?String(x.affectedOrder).trim().toUpperCase():"",
    selfDelivery:x.selfDelivery===true,deliveryFee:Number(x.deliveryFee)>0?r2(x.deliveryFee):null,
    ideal:{client:chS(id.client,400),customer:chS(id.customer,250),escalation:{needed:es.needed===true,why:chS(es.why,250),to:chS(es.to,60)}},
    saOffer:{given:comp&&(so.given===true||(!isNaN(amt)&&amt!=null)),amount:!comp||isNaN(amt)?null:amt,where:["chat","note","ticket"].includes(low(so.where))?low(so.where):"",text:chS(so.text,200),cites:cites(so.cites)},
    approval:(()=>{const a=o(x.approval);return {needed:a.needed===true,asked:a.asked===true,approved:a.approved===true,by:chS(a.by,60),cites:cites(a.cites)}})(),
    saPath:{match:MATCH.includes(low(sp.match))?low(sp.match):"partly",why:chS(sp.why,300)},
    aeInvolvement:{kind:AE_KINDS.includes(low(ae.kind))?low(ae.kind):"none",saCouldPrevent:ae.saCouldPrevent===true,why:chS(ae.why,300)},
    firstResponse:{concludedBeforeEvidence:fr.concludedBeforeEvidence===true,why:chS(fr.why,300),cites:cites(fr.cites)}}}
const MARKS=["right","partly","wrong"];
/* reads {criteria:{id:{why,score}}} (asked since chat-1 b13) or the older {scores, reasons}; returns {scores, reasons, ...} either way */
function cleanChatGrade(x){if(!x||typeof x!=="object"||Array.isArray(x))return null;const cr=x.criteria&&typeof x.criteria==="object"&&!Array.isArray(x.criteria)?x.criteria:null;
  /* a reply that never closed "criteria" carries the rest inside it: lift those keys back up */
  if(cr)["route","wentWell","nextTime","findings","verdictWhy"].forEach(k=>{if(x[k]==null&&cr[k]!=null)x=Object.assign({},x,{[k]:cr[k]})});
  const pick=(k,f)=>{const o={};if(cr)Object.entries(cr).forEach(([id,v])=>{if(v&&typeof v==="object")o[id]=v[k]});return Object.keys(o).length?o:f};
  const sc=pick("score",x.scores&&typeof x.scores==="object"?x.scores:{}),rs=pick("why",x.reasons&&typeof x.reasons==="object"?x.reasons:{});
  const scores={},reasons={};CHAT_RUBRIC.forEach(r=>{const v=sc[r.id];const na=/^\s*(n\/?a|not applicable)\s*$/i.test(String(v))||v==null;
    scores[r.id]=na&&r.na?"na":Math.max(0,Math.min(r.max,Math.round(Number(v)||0)));reasons[r.id]=chS(rs[r.id],300)});
  const rt=x.route&&typeof x.route==="object"?x.route:{},route={};["facts","analysis","solution","escalation"].forEach(k=>{const v=rt[k]&&typeof rt[k]==="object"?rt[k]:{};
    route[k]={mark:MARKS.includes(String(v.mark).toLowerCase())?String(v.mark).toLowerCase():"partly",why:chS(v.why,300)}});
  /* findings (asked since chat-2): one per criterion below full marks, in the QA ticket format */
  const ids=CHAT_RUBRIC.map(r=>r.id),findings=arr(x.findings).filter(f=>f&&typeof f==="object"&&ids.includes(String(f.criterion||"").trim().toLowerCase())).slice(0,12).map(f=>({
    criterion:String(f.criterion).trim().toLowerCase(),type:chS(f.type,60),what:chS(f.what,400),why:chS(f.why,300),
    evidence:arr(f.evidence).filter(e=>e&&e.quote).slice(0,3).map(e=>({src:chS(e.src,24),quote:chS(e.quote,300)})),should:chS(f.should,400),model:chS(f.model,900)}));
  const nextTime=arr(x.nextTime).filter(n=>n&&(n.what||n.do)).slice(0,5).map(n=>({what:chS(n.what,300),why:chS(n.why,300),do:chS(n.do,300),model:chS(n.model,900)}));
  return {scores,reasons,route,wentWell:arr(x.wentWell).map(t=>chS(t,200)).filter(Boolean).slice(0,4),findings,
    nextTime:nextTime.length?nextTime:findings.map(f=>({what:f.what,why:f.why,do:f.should,model:f.model})).slice(0,5),
    verdictWhy:chS(x.verdictWhy,500)}}
/* two reads of the grade: marks averaged per criterion (a half mark means the reads differed by one); N/A only when both reads say so.
   Reasons, route and coaching come from the first read. Added fields: runs (each read's marks), runPcts, spread (points between the reads) */
function mergeGrades(G1,G2){if(!G2)return G1;if(!G1)return G2;const scores={};
  CHAT_RUBRIC.forEach(r=>{const a=G1.scores[r.id],b=G2.scores[r.id];
    scores[r.id]=a==="na"&&b==="na"?"na":a==="na"?b:b==="na"?a:Math.round((Number(a)+Number(b)))/2});
  const p1=chatScore(G1.scores),p2=chatScore(G2.scores);
  return Object.assign({},G1,{scores,runs:[G1.scores,G2.scores],runPcts:[p1,p2],spread:p1!=null&&p2!=null?Math.round(Math.abs(p1-p2)*10)/10:null})}
/* ---------- 5b. The QA ticket: one finding per criterion below full marks ----------
   Priority by impact (the QA lead's rule): P1 money wrong, wrong fault, or a needed escalation missed; P2 other real misses; P3 polish. */
const PRIO = {P1:0,P2:1,P3:2};
function findingPriority(r,s,A,check){const v=Number(s),gap=r.max-v;
  if(r.id==="amt"&&check&&check.applies)return check.status==="minor"?"P2":"P1";
  if(r.id==="amt"&&A&&["compensation","customer_recovery"].includes(A.caseType))return "P1";
  if(r.id==="fa"&&v<=1)return "P1";
  if(r.id==="esc"&&v===0)return "P1";
  return gap<=0.5||r.w<=5?"P3":"P2"}
/* a quote is checked against its source: chat messages and call transcripts. A chat quote that isn't in the message is replaced by the message itself */
const qNorm=s=>String(s||"").toLowerCase().replace(/[\u2018\u2019]/g,"'").replace(/[^a-z0-9$.%']+/g," ").replace(/\s+/g," ").trim();
function quoteCheck(k,src,quote){const q=qNorm(String(quote||"").split(/\.\.\.|…/)[0]).slice(0,80);if(!q)return {ok:false};
  let m=/^M(\d+)$/i.exec(String(src||"").trim());
  if(m){const msg=((k&&k.chat&&k.chat.msgs)||[]).find(x=>x.n===Number(m[1]));if(!msg)return {ok:false};return qNorm(msg.text).includes(q)?{ok:true}:{ok:false,text:capText(msg.text,280)}}
  m=/^Call\s*(\d+)$/i.exec(String(src||"").trim());
  if(m){const l=((k&&k.calls)||[])[Number(m[1])-1];return l?{ok:qNorm(l.text).includes(q.slice(0,60))}:{ok:false}}
  return {ok:null}}
function buildFindings(G,A,check,k,F,G2){const raw=arr(G&&G.findings).concat(arr(G2&&G2.findings)),out=[];if(!G)return out;
  const factEv=reason=>[...new Set(String(reason||"").match(/\b[FCP]\d+\b/g)||[])].slice(0,3).map(id=>{const t=F&&(F.timeline.find(x=>x.id===id)||F.claims.find(x=>x.id===id));
    return t?{src:t.src||id,quote:t.what||t.claim,ok:null,fact:id}:null}).filter(Boolean);
  CHAT_RUBRIC.forEach(r=>{const sc=G.scores[r.id];if(sc==="na"||sc==null||Number(sc)>=r.max)return;
    const f=raw.find(x=>x.criterion===r.id)||{};let type=f.type||"",what=f.what||G.reasons[r.id]||"";
    if(r.id==="amt"&&check&&check.applies&&check.errors.length){type=check.errors.map(e=>e.label).join(" · ");what=check.errors.map(e=>e.detail).join(" ")}
    let ev=arr(f.evidence).map(e=>{const v=quoteCheck(k,e.src,e.quote);return {src:e.src,quote:v.ok===false&&v.text?v.text:e.quote,ok:v.ok===false&&v.text?true:v.ok,swapped:v.ok===false&&!!v.text}});
    if(!ev.length)ev=factEv(r.id==="amt"&&check&&check.applies?arr(check.given.cites).join(" ")+" "+(G.reasons[r.id]||""):G.reasons[r.id]);
    out.push({id:r.id,label:r.label,score:sc,max:r.max,priority:findingPriority(r,sc,A,check),type:chS(type,80),what:chS(what,500),why:f.why||"",evidence:ev,should:f.should||"",model:f.model||"",reason:G.reasons[r.id]||""})});
  (check&&check.flags||[]).forEach(fl=>{if(!out.some(x=>x.id==="esc"&&x.priority==="P1"))out.push({id:"approval",label:"Approval",score:null,max:null,priority:"P1",type:fl.label,what:fl.detail,why:"The policy holds the confirmation until the lead approves.",evidence:[],should:"Hold the confirmation, send the lead a summary with the order, fault, policy row and amount, and tell the client once approved.",model:"",reason:""})});
  return out.sort((a,b)=>PRIO[a.priority]-PRIO[b.priority]||CHAT_RUBRIC.findIndex(r=>r.id===a.id)-CHAT_RUBRIC.findIndex(r=>r.id===b.id))}
/* the two reads merged, the compensation check's mark on Resolution accuracy, then the ticket's findings and the coaching items (gradeChat and the eval both use this) */
function finishGrade(G1,G2,A,check,k,F){let G=G2?mergeGrades(G1,G2):Object.assign({},G1);
  if(check&&check.applies&&check.score!=null)G=Object.assign({},G,{scores:Object.assign({},G.scores,{amt:check.score}),reasons:Object.assign({},G.reasons,{amt:check.summary}),amtBy:"system"});
  G.findings=buildFindings(G,A,check,k,F,G2);
  if(!G1.nextTime.length||G1.findings.length)G.nextTime=G.findings.filter(f=>f.priority!=="P3"||G.findings.length<=3).slice(0,5).map(f=>({what:f.what,why:f.why,do:f.should,model:f.model}));
  return G}
/* score and verdict are computed, so the same marks always give the same grade */
function chatScore(scores){let got=0,den=0;CHAT_RUBRIC.forEach(r=>{const v=scores&&scores[r.id];if(v==="na"||v==null||v==="")return;den+=r.w;got+=r.w*Math.min(r.max,Number(v))/r.max});
  return den?Math.round(got/den*1000)/10:null}
function chatVerdict(pct){if(pct==null)return null;const v=VERDICTS.find(([,min])=>pct>=min)||VERDICTS[VERDICTS.length-1];return {id:v[0],label:v[2]}}
/* ---------- 6. The week, and one chat end to end (the page, the eval and the tests all run these) ---------- */
const CHAT_STEPS = [["tasks","Linked tasks"],["refs","Order clues"],["orders","Orders"],["calls","Recordings"],["slack","Slack"],["facts","Case facts"],["analysis","Analysis"],["grade","Grade and coaching"]];
/* Monday-start week of an Eastern wall-clock timestamp */
function chatWeek(at){const d=String(at||"").slice(0,10),[y,m,dd]=d.split("-").map(Number);if(!y||!m||!dd)return "";return addDaysU(d,-((new Date(Date.UTC(y,m-1,dd)).getUTCDay()+6)%7))}
/* the week's base chats; a reply that comes back full may be cut off, so split the dates until it isn't */
async function pullChatWeek(w,assignees,query,ctx){
  const get=async(a,b)=>{const rows=await query(chatBaseConfig(a,b,assignees),`QA Desk · chats ${a} to ${b}`);
    if(rows.length<PULL.cap||a>=b)return rows;const n=Math.round((Date.parse(b)-Date.parse(a))/864e5),mid=addDaysU(a,Math.floor(n/2));
    return (await get(a,mid)).concat(await get(addDaysU(mid,1),b))};
  const seen=new Set();
  return (await get(w,addDaysU(w,6))).map(x=>chatRow(x,ctx)).filter(c=>c.wid&&!seen.has(c.wid)&&!!seen.add(c.wid)&&isBaseChat(c))}
/* a chat can be graded once the assigned SA has replied in it */
const chatGradable = c => (c.msgs||[]).some(m=>m.role==="sa");
/* N gradable chats per SA, in a stable random order (the same week always gives the same picks) */
function chatPicks(chats,perSA){const by=new Map();
  (chats||[]).filter(chatGradable).forEach(c=>{if(!by.has(c.sa))by.set(c.sa,[]);by.get(c.sa).push(c)});
  const out=[];by.forEach(list=>list.slice().sort((a,b)=>fnv(String(a.sid))-fnv(String(b.sid))).slice(0,perSA).forEach(c=>out.push(c.sid)));return out}
/* a reply cut short or left open: keep the complete part and close what's open (no second call: the page never retries Claude from code) */
function repairJson(text){const t=String(text||""),a=t.indexOf("{");if(a<0)return null;
  const stack=[];let inStr=false,esc=false,lastSafe=-1,safeStack=null;
  for(let i=a;i<t.length;i++){const ch=t[i];
    if(inStr){if(esc)esc=false;else if(ch==="\\")esc=true;else if(ch==='"')inStr=false;continue}
    if(ch==='"'){inStr=true;continue}
    if(ch==="{"||ch==="[")stack.push(ch==="{"?"}":"]");
    else if(ch==="}"||ch==="]"){if(stack.pop()!==ch)return null;if(!stack.length){try{return JSON.parse(t.slice(a,i+1))}catch(e){return null}}}
    if(ch===","||ch==="}"||ch==="]"){lastSafe=ch===","?i:i+1;safeStack=stack.slice()}}
  if(lastSafe<0||!safeStack)return null;
  let body=t.slice(a,lastSafe).replace(/,\s*$/,"");
  for(let i=safeStack.length-1;i>=0;i--)body+=safeStack[i];
  try{return JSON.parse(body)}catch(e){return null}}
/* one Claude pass: a reply that isn't valid JSON is repaired from its text when possible */
async function askPass(deps,prompt,pass,opts){try{return await deps.ask(prompt,pass,opts)}
  catch(e){if(e&&e.code==="invalid_json"&&e.text){const v=repairJson(e.text);if(v&&typeof v==="object")return v}throw e}}
/* the outbound-call pull for chatContext: the query, the linking, then transcripts for the kept calls the context does not already hold */
async function saOutbound(c,k,deps,x){const stats={rows:0,inWindow:0,phone:0,restaurant:0,other:0,ambiguous:0,late:0,deduped:0},none={stats};
  const {calls,own10,T,q,step}=x;
  const W=chatWindow(c,(k.timing&&k.timing.closedAt)||c.closedAt||"",deps.until);if(!W||!c.sa)return none;
  const ro=rosterOf(c.sa,deps.roster&&deps.roster.length?deps.roster:typeof ROSTER_DEFAULT!=="undefined"?ROSTER_DEFAULT:[]);
  const dflt=typeof ROSTER_DEFAULT!=="undefined"?ROSTER_DEFAULT.find(d=>ro&&d.name===ro.name):null,logins=[...new Set([].concat((ro&&ro.logins)||[],(dflt&&dflt.logins)||[]).map(l=>String(l).toLowerCase()).filter(Boolean))];
  if(!logins.length){stats.error="no login for the SA in the roster";return none}
  let rows=[];
  try{rows=(await q(saOutboundConfig(logins,etDay(W.lo),etDay(W.hi)),T+" · SA outbound")).map(callRow)}
  catch(e){if(deps.isStop&&deps.isStop(e))throw e;stats.error="the SA's outbound-call query didn't run";return none}
  /* the numbers this chat mentions: its text, shape fields, child tasks and the callers on the order's own recordings. The restaurant's own number (the client author id) counts too: calling the restaurant back is working the chat */
  const customer=[].concat(k.refs.phones||[],calls.filter(l=>l.link==="order"&&l.dir==="in").map(l=>l.phone)).map(last10).filter(p=>p.length===10&&!own10.has(p));
  const res=linkSaOutbound(c,rows,{closedAt:(k.timing&&k.timing.closedAt)||c.closedAt||"",until:deps.until,logins,siblings:deps.siblings,phones:{customer,restaurant:[...own10]}});
  const have=new Map(calls.map(l=>[l.id,l])),fresh=[];
  res.kept.forEach(l=>{const h=have.get(l.id);
    if(!h)fresh.push(l);
    else{res.stats.deduped++;if(h.link!=="order")Object.assign(h,{link:l.link,match:l.match,why:l.why,shared:l.shared})}});  /* an order's own recording stays "order" */
  if(fresh.length){const days=fresh.map(l=>String(l.at).slice(0,10)).sort();
    let tx=new Map();
    try{(await q(callsByIdsConfig(fresh.map(l=>l.id),days[0],days[days.length-1]),T+" · SA outbound recordings")).map(callRow).forEach(r=>tx.set(r.id,r.text))}
    catch(e){if(deps.isStop&&deps.isStop(e))throw e;res.stats.error="the recordings query for the SA's outbound calls didn't run"}
    fresh.forEach(l=>{l.text=tx.get(l.id)||"";calls.push(l)})}
  return res}
/* everything tied to the chat: linked tasks, the order, its recordings and the same caller's other calls, Slack.
   deps: {query(cfg,title) -> rows, ask(prompt,pass) -> parsed JSON, slack(chat,k) -> threads (optional), orderIds (reviewer's pick, optional), step(id,state,note)} */
async function chatContext(c,deps){const q=deps.query,step=deps.step||(()=>{}),day=String(c.at).slice(0,10),from=addDaysU(day,-1),T=`QA Desk · chat ${c.sid}`;
  const k={chat:c,tasks:[],orders:[],allOrders:[],ranked:[],refs:mergeRefs({},{}),calls:[],slack:[],notFound:[],orderNote:""};
  /* the chat's status changes: a failed query leaves the times WIRA gave on the chat row */
  k.timing=c.timing||chatTiming(c,[]);
  if(c.wid){try{k.timing=c.timing=chatTiming(c,await q(chatStatesConfig(c.wid),T+" · states"))}
    catch(e){if(deps.isStop&&deps.isStop(e))throw e;k.notFound.push("WIRA status times (the query didn't run)")}}
  step("tasks","run");
  if(c.code)k.tasks=pickRelated(c,await q(relatedTasksConfig(c.code,from,addDaysU(day,2)),T+" · tasks"));
  step("tasks","done",k.tasks.length?`${k.tasks.length} linked`:"none");
  step("refs","run");
  /* order clues come from the chat, its shape fields and its own child tasks, never from the SA's other tasks */
  const kids=k.tasks.filter(t=>t.parent&&t.parent===c.wid),fc=[c.fields].concat(kids.map(t=>parseFields(t.fields))).map(fieldClues);
  const cat=key=>[].concat(...fc.map(x=>x[key]));
  const refs=textRefs(c.msgs.map(m=>m.text).concat(kids.flatMap(t=>[t.title,t.desc])));
  const U=(...xs)=>[...new Set([].concat(...xs))];
  refs.tickets=U(refs.tickets,cat("tickets"));refs.phones=U(refs.phones,cat("phones"));refs.dates=U(refs.dates,cat("dates"));
  refs.wids=U(c.orderWids||[],...kids.map(t=>t.orderWids||[]),cat("wids"));
  k.refs=mergeRefs(refs,deps.ask?cleanChatRefs(await askPass(deps,chatRefsPrompt(Object.assign({},k,{tasks:kids})),"refs")):{});
  step("refs","done");
  step("orders","run");
  /* a date the chat names (up to a week back) widens the order window to that day */
  const dated=(k.refs.dates||[]).map(md=>{const y=Number(day.slice(0,4)),d=`${y}-${md}`;return d>day?`${y-1}-${md}`:d}).filter(d=>d<from&&d>=addDaysU(day,-7)).sort();
  let orders=c.code?(await q(orderConfig(c.code,dated[0]||from,day),T+" · orders")).map(orderRow):[];
  /* an order WIRA ties to the chat can be older than the day window */
  const gone=k.refs.wids.filter(w=>!orders.some(o=>o.id===w));
  if(gone.length&&c.code)(await q(ordersByIdsConfig(c.code,gone,addDaysU(day,-30),day),T+" · orders")).map(orderRow).forEach(o=>{if(o.id&&!orders.some(x=>x.id===o.id))orders.push(o)});
  k.allOrders=orders;
  k.ranked=rankOrders(orders,k.refs,c.at);
  const pick=Array.isArray(deps.orderIds)?orders.filter(o=>deps.orderIds.includes(o.id)):linkedOrders(k.ranked);
  k.orders=pick.map((o,i)=>{const r=k.ranked.find(x=>x.order.id===o.id);return Object.assign({},o,{label:"O"+(i+1),tie:Array.isArray(deps.orderIds)?"reviewer":r&&r.assoc?"wira":r&&r.strong?"ticket":"amount"})});
  const close=k.ranked.filter(r=>r.score>=5);
  if(!k.orders.length&&close.length)k.orderNote=`Possible orders, none clear enough to link: ${close.slice(0,3).map(r=>`ticket ${r.order.ticket||"?"} (total ${money(r.order.total)}; ${r.why.join(", ")})`).join("; ")}.`;
  step("orders","done",k.orders.length?k.orders.map(o=>`ticket ${o.ticket||"?"}`).join(", "):close.length?"not clear":"none");
  step("calls","run");
  const ids=[...new Set(k.orders.flatMap(o=>o.callIds))];let calls=[];
  /* a linked order can be older than the chat's day window (a WIRA tie or a named date): look for its calls from its own day */
  const cFrom=k.orders.map(o=>String(o.at).slice(0,10)).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)&&d<from).sort()[0]||from;
  if(ids.length)calls=(await q(callsByIdsConfig(ids,cFrom,day),T+" · order recordings")).map(callRow);
  calls.forEach(l=>{l.link="order"});
  /* the caller is the order's customer. A phone in the chat text can be the restaurant's own (the client's WIRA author id carries it), and a regular customer's earlier orders are other cases:
     calls from the same number count from 2 hours before the linked order (12 hours before the chat when no order is linked) */
  const own10=new Set(c.msgs.filter(m=>m.role==="client").map(m=>String(m.author||"").replace(/\D/g,"").slice(-10)).filter(x=>x.length===10));
  const phones=[...new Set(calls.filter(l=>l.dir==="in").map(l=>l.phone).concat(k.refs.phones).filter(isPhone).filter(ph=>!own10.has(String(ph).replace(/\D/g,"").slice(-10))))];
  const lo=k.orders.length?ldTs(k.orders[0].at)-2*36e5:ldTs(c.at)-12*36e5;
  if(phones.length&&c.code)(await q(phoneCallsConfig(phones,cFrom,day,c.code),T+" · same caller")).map(callRow).forEach(l=>{if(!calls.some(x=>x.id===l.id)&&!(ldTs(l.at)<lo))calls.push(Object.assign(l,{link:"same_caller"}))});
  /* the chat's SA called someone while working the chat: their outbound calls in the chat's window, kept when the dialed number or the restaurant ties to this chat */
  const out=await saOutbound(c,k,deps,{calls,own10,T,q,step});
  const t0=k.orders.length?ldTs(k.orders[0].at):ldTs(c.at);
  /* silent and voicemail legs never take one of the slots for calls with talk: they follow the talked ones, at most CHAT.quietCalls of them */
  const near=ls=>ls.filter(l=>l.id).map(l=>({l,own:ids.includes(l.id)?1:0,d:Math.abs(ldTs(l.at)-t0)||0})).sort((a,b)=>b.own-a.own||a.d-b.d),byTime=ls=>ls.sort((a,b)=>a.at.localeCompare(b.at));
  calls.forEach(l=>{l.talk=legTalk(l.text)});
  const mine=l=>l.link==="sa_outbound",reg=calls.filter(l=>!mine(l)),sao=calls.filter(mine);
  const talk=byTime(near(reg.filter(l=>l.talk==="talk")).slice(0,CHAT.maxCalls).map(x=>x.l)),quiet=byTime(near(reg.filter(l=>l.talk!=="talk")).slice(0,CHAT.quietCalls).map(x=>x.l));
  /* the SA's own outbound calls have their own slots, nearest the chat's opening first (a phone match before a restaurant match), so they never push out the order's recordings */
  const o0=ldTs(c.at),nearOut=ls=>ls.slice().sort((a,b)=>(a.match==="phone"?0:1)-(b.match==="phone"?0:1)||Math.abs(ldTs(a.at)-o0)-Math.abs(ldTs(b.at)-o0)),
    outTalk=nearOut(sao.filter(l=>l.talk==="talk")).slice(0,CHAT.maxOutCalls),outQuiet=nearOut(sao.filter(l=>l.talk!=="talk")).slice(0,CHAT.quietOut);
  k.outbound=Object.assign({},out.stats,{shown:outTalk.length+outQuiet.length,cut:sao.length-outTalk.length-outQuiet.length});
  k.calls=byTime(talk.concat(outTalk)).concat(byTime(quiet.concat(outQuiet)));
  k.calls.forEach(l=>{const o=k.orders.find(x=>x.callIds.includes(l.id));if(o)l.orders=`${o.label} (ticket ${o.ticket||"?"})`});
  step("calls","done",k.calls.length?`${k.calls.length} call${k.calls.length===1?"":"s"}`:"none");
  if(deps.slack){step("slack","run");try{k.slack=(await deps.slack(c,k))||[];step("slack","done",k.slack.length?`${k.slack.length} thread${k.slack.length===1?"":"s"}`:"none")}
    catch(e){if(deps.isStop&&deps.isStop(e))throw e;k.notFound.push("Slack (the search didn't run)");step("slack","error")}}
  if(!k.orders.length&&(k.refs.tickets.length||k.refs.amounts.length))k.notFound.push("an order in Tarro's data that clearly matches the chat");
  if(k.orders.length&&!k.calls.length)k.notFound.push("a call recording for the linked order");
  return k}
/* the route: facts, analysis, the money in code, then grade and coaching. cal excludes this chat's own calibration case */
async function gradeChat(k,deps){const step=deps.step||(()=>{}),policy=deps.policy||CHAT_POLICY_EMPTY,cal=(deps.cal||[]).filter(x=>String(x.sid)!==String(k.chat.sid));
  step("facts","run");const F=cleanChatFacts(await askPass(deps,chatFactsPrompt(k),"facts"),k.calls);if(!F)throw {code:"ai_shape",pass:"facts"};
  step("facts","done",`${F.timeline.length} facts · ${F.claims.length} claims`);
  step("analysis","run");const A=cleanChatAnalysis(await askPass(deps,chatAnalysisPrompt(k,F,policy,cal,deps.lessons),"analysis"),F,policy);if(!A)throw {code:"ai_shape",pass:"analysis"};
  step("analysis","done");
  const comp=compFor(A,k.orders,policy),offer=offerCheck(A.saOffer,comp,k.orders),check=compCheck(A,k,policy),lessons=deps.lessons||[];
  const gp=chatGradePrompt(k,F,A,comp,offer,cal,check,lessons);
  step("grade","run");const G1=cleanChatGrade(await askPass(deps,gp,"grade"));if(!G1)throw {code:"ai_shape",pass:"grade"};
  /* the same grade asked a second time, fresh, and the marks averaged: one read can swing 15-30 points */
  let G2=null;
  if((deps.gradeRuns==null?CHAT.gradeRuns:deps.gradeRuns)>1){step("grade","run","second read");
    try{G2=cleanChatGrade(await askPass(deps,gp,"grade",{fresh:true}))}
    catch(e){if(deps.isStop&&deps.isStop(e))throw e}}
  const G=finishGrade(G1,G2,A,check,k,F);
  const pct=chatScore(G.scores),verdict=chatVerdict(pct);step("grade","done",verdict?`${verdict.label} ${pct}%`+(G.spread>=15?` · reads ${G.runPcts.join(" / ")}`:""):"");
  return {F,A,comp,offer,check,G,pct,verdict}}
/* where chat data lives in the artifact db. Each week is its own small set of collections, so the page only ever reads one week */
const CHAT_PATHS = {chats:w=>`chatWeeks/${w}/chats`, audits:w=>`chatWeeks/${w}/audits`, tx:w=>`chatWeeks/${w}/tx`, reviews:w=>`chatWeeks/${w}/reviews`,
  calib:"chatCalib", lessons:"chatLessons", policy:"settings/chatPolicy", staff:"settings/staff"};
/* what goes in the db. chats/<sid>: the queue row (the chat itself, so grading needs no re-query) */
function chatQueueDoc(c,picked){return Object.assign({v:CHAT_V,week:chatWeek(c.at),picked:!!picked,gradable:chatGradable(c)},c,
  {msgs:(c.msgs||[]).map(m=>Object.assign({},m,{text:capText(m.text,4000)}))})}
/* chatAudits/<sid>: the context, the passes, the score. Transcripts go in chatTx/<sid> to keep this doc small */
function chatAuditDoc(k,R,meta){const c=k.chat;meta=meta||{};
  return {v:CHAT_V,sid:c.sid,wid:c.wid,url:c.url,week:chatWeek(c.at),at:c.at,sa:c.sa,restaurant:c.restaurant,code:c.code,initiator:c.initiator,title:c.title,frt:c.frt,timing:k.timing||c.timing||null,clientName:c.clientName,
    tasks:k.tasks.map(t=>({sid:t.sid,wid:t.wid,parent:t.parent===c.wid,at:t.at,project:t.project,intent:t.intent,title:t.title,desc:capText(t.desc,800),status:t.status,by:t.by,assigned:t.assigned,url:t.url,comments:t.comments.slice(0,12)})),
    orders:k.orders.map(o=>({label:o.label,id:o.id,ticket:o.ticket,at:o.at,source:o.source,type:o.type,coupon:o.coupon,items:o.items,tax:o.tax,tip:o.tip,other:o.other,total:o.total,callIds:o.callIds,status:o.status,voidWhy:o.voidWhy,pay:o.pay,refunded:o.refunded,refundType:o.refundType})),
    candidates:k.ranked.map(r=>({id:r.order.id,ticket:r.order.ticket,at:r.order.at,type:r.order.type,source:r.order.source,items:r.order.items,total:r.order.total,score:r.score,why:r.why})),
    /* every order the restaurant had on the chat day and the day before, newest first, for the reviewer's "Change order" */
    dayOrders:(k.allOrders||[]).slice().sort((a,b)=>String(b.at).localeCompare(String(a.at))).slice(0,150).map(o=>({id:o.id,ticket:o.ticket,at:o.at,type:o.type,source:o.source,items:o.items,total:o.total,status:o.status})),
    orderNote:k.orderNote,orderPick:Array.isArray(meta.orderIds)?"reviewer":"auto",refs:k.refs,
    calls:k.calls.map(l=>({id:l.id,at:l.at,sec:l.sec,agent:l.agent,dir:l.dir,phone4:String(l.phone||"").slice(-4),orders:l.orders||"",talk:l.talk||"talk",link:l.link||"",match:l.match||"",why:l.why||"",shared:!!l.shared,code:l.code||""})),
    slack:k.slack,notFound:k.notFound,
    facts:R.F,analysis:R.A,comp:R.comp,offer:R.offer,check:R.check||null,grade:R.G,pct:R.pct,verdict:R.verdict?R.verdict.id:null,
    priority:((R.G&&R.G.findings)||[]).map(f=>f.priority).sort()[0]||null,
    gradedAt:meta.at||new Date().toISOString(),by:meta.by||null}}
function chatTxDoc(k){return {v:CHAT_V,sid:k.chat.sid,calls:k.calls.map(l=>({id:l.id,text:capText(l.text,CHAT.txCap)}))}}
/* CHAT-CORE END */
if(typeof module!=="undefined"){const core=require("./core.js");Object.assign(globalThis,core);
  module.exports={CHAT,CHAT_V,CHAT_DIMS,STAFF_DEFAULT,ROLE_L,chatBaseConfig,isBaseChat,chatRow,chatMessages,chatTranscript,relatedTasksConfig,relTask,pickRelated,orderConfig,orderRow,orderState,
    textRefs,mergeRefs,rankOrders,linkedOrders,callsByIdsConfig,phoneCallsConfig,callRow,saOutboundConfig,SAOUT_DIMS,chatWindow,linkSaOutbound,saOutbound,CHAT_POLICY_EMPTY,compFor,offerCheck,chatEvidence,chatRefsPrompt,chatFactsPrompt,
    chatFactLines,calibLines,CASE_TYPES,chatAnalysisPrompt,CHAT_RUBRIC,VERDICTS,chatGradePrompt,cleanChatRefs,cleanChatFacts,cleanChatAnalysis,cleanChatGrade,chatScore,chatVerdict,money,r2,
    CHAT_STEPS,CHAT_PATHS,PRIO,findingPriority,quoteCheck,buildFindings,finishGrade,lessonLines,mergeGrades,leadRules,muUsd,COMP_ERR,compDiagnose,compCheck,chatWeek,pullChatWeek,chatGradable,chatPicks,repairJson,askPass,chatContext,gradeChat,chatQueueDoc,chatAuditDoc,chatTxDoc,
    chatStatesConfig,stateRow,stateOn,chatTiming,aeFirstReply,chatTimingLines,minBetween,rosterOf,editDist,parseFields,parseWids,fieldClues,POS_RE,BOT_RE,pairComments,personNames,refersToChat,datesIn,ordersByIdsConfig,MIN_AMT}}
