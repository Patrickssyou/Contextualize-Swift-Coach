/* CHAT-CORE START */
/* ---- The chat brain: audit a Super Agent's WIRA chat. See docs/brain-wira-chats.md.
   Route: facts -> analysis (fault, policy bucket, ideal resolution) -> solution quality -> grade + coaching.
   Code does the data work and all the money; Claude reads and judges. ---- */
const CHAT = {explore:"wira_project_tasks", perSA:5, relBeforeH:2, relAfterH:24, txCap:7000, budget:60000, calibMax:3};
const CHAT_V = "chat-1";
const CHAT_DIMS = ["wira_project_tasks_wira_id","wira_project_tasks_short_wira_id","wira_project_tasks_created_at_est","wira_project_tasks_closed_at_est",
  "wira_project_tasks_status","wira_project_tasks_sub_status","wira_project_tasks_task_title","wira_project_tasks_task_comments","wira_project_tasks_task_commentors",
  "wira_project_tasks_conversation_direction","wira_project_tasks_created_by","wira_project_tasks_created_by_title","wira_project_tasks_assigned_user",
  "wira_project_tasks_agent_alias","wira_project_tasks_client_alias","wira_project_tasks_first_response_time_minutes","wira_project_tasks_first_client_message_time_est",
  "wira_project_tasks_first_agent_reply_time_est","wira_project_tasks_shape_name","wira_project_tasks_rating","wira_project_tasks_wira_ticket_url",
  "restaurants_unique_code","restaurants_english_name"];
const REL_DIMS = ["wira_project_tasks_wira_id","wira_project_tasks_short_wira_id","wira_project_tasks_parent_wid","wira_project_tasks_created_at_est","wira_project_tasks_closed_at_est",
  "wira_project_tasks_project_name","wira_project_tasks_shape_name","wira_project_tasks_shape_fields","wira_project_tasks_task_title","wira_project_tasks_description",
  "wira_project_tasks_status","wira_project_tasks_assigned_user","wira_project_tasks_created_by","wira_project_tasks_task_comments","wira_project_tasks_task_commentors",
  "wira_project_tasks_wira_ticket_url"];
const OA = "greendot_orders_analytics_aggregate_";
const ORDER_DIMS = ["order_id","order_ticket_number","order_created_at_est","order_source","order_type","list_coupon_name","call_id","list_call_ids"].map(x=>OA+x);
const ORDER_METRICS = ["total_sub_total_sales","total_sales_amount","total_tax_amount","total_tip_amount"].map(x=>OA+x);
const CALL_DIMS = ["calls_conversation_id","calls_call_started_at_est","calls_call_duration_in_seconds","internal_users_full_name","internal_users_user_login_name",
  "calls_call_type","calls_call_phone_detail","asr_transcript_call_transcript"];
const SKIP_PROJECTS = ["real-time-audits-pizza","customer-feedback"];
/* who's who beyond the SA roster, keyed by the email prefix WIRA uses as the commentor */
const STAFF_DEFAULT = {"howard.ho":{name:"Howard Ho",role:"lead"},"patrick.evangelista":{name:"Patrick Evangelista",role:"lead"},"weijie.chiew":{name:"CJ Chiew",role:"ae"}};
const ROLE_L = {client:"Client",sa:"Support",sa_other:"Support (other SA)",ae:"AE/CSM",crt:"CRT",lead:"Lead",staff:"Staff"};

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

/* one normalized chat from a wira_project_tasks row */
function chatRow(x,ctx){const g=k=>x["wira_project_tasks_"+k];const s=v=>v==null?"":String(v);
  const c={wid:s(g("wira_id")),sid:s(g("short_wira_id")),url:s(g("wira_ticket_url")),at:s(g("created_at_est")).slice(0,19),closedAt:s(g("closed_at_est")).slice(0,19),
    status:s(g("status")),sub:s(g("sub_status")),title:s(g("task_title")),direction:s(g("conversation_direction")),createdBy:s(g("created_by")),createdByTitle:s(g("created_by_title")),
    sa:s(g("assigned_user")),saEmail:s(g("agent_alias")),clientId:s(g("client_alias")),frt:g("first_response_time_minutes")==null?null:Number(g("first_response_time_minutes")),
    firstClientAt:s(g("first_client_message_time_est")).slice(0,19),firstReplyAt:s(g("first_agent_reply_time_est")).slice(0,19),intent:s(g("shape_name")),rating:s(g("rating")),
    code:s(x.restaurants_unique_code).toUpperCase(),restaurant:cleanName(x.restaurants_english_name)};
  c.initiator=c.direction==="inbound"?"client":c.createdByTitle==="Account Executive"?"ae":c.direction||"";
  c.msgs=chatMessages(g("task_comments"),g("task_commentors"),Object.assign({saEmail:c.saEmail,sa:c.sa},ctx||{}));
  c.clientName=(c.msgs.find(m=>m.role==="client"&&m.name!=="Client")||{}).name||"";
  return c}

/* ---------- 1. Messages with owners ---------- */
const MENTION_RE = /\[@[^\]]+\]\(|(^|\s)@[A-Z][a-z]+/;
const THIRD_RE = /\b(client|cl|customer|cx|he|she|him|her|they)\b[^.?!]{0,40}\b(called|yelled|said|says|wants|asked|is asking|demanded|refused|agreed|insists)\b/i;
const GREET_RE = /^\s*(hi|hello|hey|good (morning|afternoon|evening)|thanks for)\b/i;
function chatMessages(comments,commentors,ctx){ctx=ctx||{};
  const text=String(comments||"").trim();if(!text)return [];
  const C=text.split(" ## "),W=String(commentors||"").split(" ## "),saP=prefixOf(ctx.saEmail),staff=Object.assign({},STAFF_DEFAULT,ctx.staff||{});
  const rosterNames=(ctx.roster||[]).map(r=>r.name.toLowerCase());
  const out=C.map((t,i)=>{const w=String(W[i]||"").trim(),p=prefixOf(w);let role="staff",name=titleCase(p)||"Unknown";
    if(/^client-/i.test(w)){role="client";name="Client"}
    else if(saP&&p===saP){role="sa";name=ctx.sa||titleCase(p)}
    else if(staff[p]){role=staff[p].role||"staff";name=staff[p].name||titleCase(p)}
    else if(rosterNames.includes(titleCase(p).toLowerCase())){role="sa_other";name=titleCase(p)}
    else if(!w){role="staff";name="Unknown"}
    return {n:i+1,author:w,role,name,text:String(t).trim(),internal:false,inferred:false}});
  /* the client's sign-off names them ("This is Sam") */
  const sign=out.filter(m=>m.role==="client").map(m=>(m.text.match(/\b(?:[Tt]his is|[Ii]t'?s|[Rr]egards,?|[Tt]hanks,?|[Ff]rom|-)\s+([A-Z][a-z]{1,20})\b/)||[])[1]).find(Boolean);
  if(sign)out.forEach(m=>{if(m.role==="client")m.name=sign});
  /* internal notes are inferred: WIRA has no flag */
  out.forEach(m=>{if(m.role==="client")return;
    const toClient=GREET_RE.test(m.text)||(sign&&new RegExp("\\b"+sign+"\\b").test(m.text));
    if(MENTION_RE.test(m.text))m.internal=true;
    else if(m.role!=="sa"&&!toClient)m.internal=true;
    else if(m.role!=="sa"&&THIRD_RE.test(m.text))m.internal=true;
    m.inferred=m.internal});
  return out}
function chatTranscript(c){return (c.msgs||[]).map(m=>`M${m.n} · ${ROLE_L[m.role]||m.role}${m.role==="client"?"":" — "+m.name}${m.role==="sa"?" (audited)":""}${m.internal?" [internal note, inferred]":""}: ${capText(m.text,1600)}`).join("\n")}

/* ---------- 2. Context: tasks, orders, recordings ---------- */
function relatedTasksConfig(code,from,to){return {exploreName:CHAT.explore,dimensions:REL_DIMS,metrics:[],sorts:[{fieldId:"wira_project_tasks_created_at_est",descending:false}],limit:PULL.cap,
  filters:{dimensions:`restaurants_unique_code equals=${ldVal(code)} AND wira_project_tasks_created_at_est_day inBetween=${from},${to}`}}}
function relTask(x){const g=k=>x["wira_project_tasks_"+k];const s=v=>v==null?"":String(v);
  return {wid:s(g("wira_id")),sid:s(g("short_wira_id")),parent:s(g("parent_wid")),at:s(g("created_at_est")).slice(0,19),closedAt:s(g("closed_at_est")).slice(0,19),
    project:s(g("project_name")),intent:s(g("shape_name")),fields:s(g("shape_fields")),title:capText(g("task_title"),300),desc:capText(g("description"),2000),status:s(g("status")),
    assigned:s(g("assigned_user")),by:s(g("created_by")),url:s(g("wira_ticket_url")),
    comments:String(g("task_comments")||"").split(" ## ").map((t,i)=>({who:String(g("task_commentors")||"").split(" ## ")[i]||"",text:capText(t,600)})).filter(c=>c.text)}}
/* the chat's own children, plus tasks the SA made or took at the same restaurant around the chat */
function pickRelated(c,rows){const t0=ldTs(c.at),lo=t0-CHAT.relBeforeH*36e5,hi=t0+CHAT.relAfterH*36e5;
  return (rows||[]).map(relTask).filter(t=>t.wid&&t.wid!==c.wid&&!SKIP_PROJECTS.includes(t.project)).filter(t=>{
    if(t.parent&&t.parent===c.wid)return true;if(t.project==="conversation")return false;
    const at=ldTs(t.at);if(isNaN(at)||at<lo||at>hi)return false;
    return !!c.sa&&(t.by===c.sa||t.assigned===c.sa)}).slice(0,8)}
function orderConfig(code,from,to){return {exploreName:"greendot_orders_analytics_aggregate",dimensions:ORDER_DIMS,metrics:ORDER_METRICS,
  sorts:[{fieldId:OA+"order_created_at_est",descending:false}],limit:PULL.cap,
  filters:{dimensions:`restaurants_unique_code equals=${ldVal(code)} AND ${OA}order_created_at_est_day inBetween=${from},${to}`}}}
const UUID_RE=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
function orderRow(x){const g=k=>x[OA+k];const ids=new Set([String(g("call_id")||"")].concat(String(g("list_call_ids")||"").match(UUID_RE)||[]).filter(Boolean));
  const items=r2(g("total_sub_total_sales")),tax=r2(g("total_tax_amount")),tip=r2(g("total_tip_amount")),total=g("total_sales_amount")==null?r2(items+tax+tip):r2(g("total_sales_amount"));
  return {id:String(g("order_id")||""),ticket:g("order_ticket_number")==null?"":String(g("order_ticket_number")),at:String(g("order_created_at_est")||"").slice(0,19),
    source:String(g("order_source")||""),type:String(g("order_type")||""),coupon:String(g("list_coupon_name")||""),callIds:[...ids],items,tax,tip,total,
    other:r2(total-items-tax-tip)}}
/* references the chat and its tasks make to an order: ticket numbers, dollar amounts, phone numbers */
function textRefs(texts){const all=texts.filter(Boolean).join("\n"),amounts=new Set(),tickets=new Set(),phones=new Set();
  (all.match(/\$\s?\d{1,4}(?:,\d{3})*(?:\.\d{1,2})?|\b\d{1,4}\.\d{2}\b/g)||[]).forEach(a=>{const v=Number(a.replace(/[$,\s]/g,""));if(v>0&&v<5000)amounts.add(r2(v))});
  (all.match(/\b(?:C|#|ticket\s*#?|order\s*#?|tkt\s*#?)\s?(\d{1,4})\b/gi)||[]).forEach(t=>tickets.add(String(Number(t.replace(/\D/g,"")))));
  (all.match(/\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b/g)||[]).forEach(p=>phones.add(p.replace(/\D/g,"")));
  return {amounts:[...amounts],tickets:[...tickets],phones:[...phones]}}
function mergeRefs(a,b){const u=(x,y)=>[...new Set([].concat(x||[],y||[]).map(String))];b=b||{};
  return {amounts:u(a.amounts,(b.amounts||[]).map(Number).filter(n=>n>0).map(r2)).map(Number),tickets:u(a.tickets,(b.tickets||[]).map(t=>String(t).replace(/\D/g,"")).filter(Boolean)),
    phones:u(a.phones,(b.phones||[]).map(p=>String(p).replace(/\D/g,"")).filter(p=>p.length>=7)),names:u([],b.customerNames),items:u([],b.items),orderType:b.orderType||""}}
/* rank the restaurant's orders against the references; a clear winner is linked, close calls are left for the reviewer */
function rankOrders(orders,refs,chatAt){const t0=ldTs(chatAt);
  return (orders||[]).map(o=>{let score=0;const why=[];
    if(o.ticket&&refs.tickets.includes(o.ticket)){score+=5;why.push(`ticket ${o.ticket} mentioned`)}
    refs.amounts.forEach(a=>{
      if(Math.abs(a-o.total)<=0.01){score+=4;why.push(`total ${money(o.total)} mentioned`)}
      else if(Math.abs(a-o.items)<=0.01&&o.items>0){score+=4;why.push(`item subtotal ${money(o.items)} mentioned`)}
      else if(o.total>0&&(Math.abs(a/0.3-o.total)<=0.05||Math.abs(a/0.3-o.items)<=0.05)){score+=3;why.push(`${money(a)} is 30% of this order`)}});
    if(refs.orderType&&o.type&&refs.orderType===o.type)score+=1;
    const at=ldTs(o.at);if(!isNaN(at)&&!isNaN(t0)){if(at<=t0&&t0-at<=12*36e5)score+=1;else if(at>t0)score-=2}
    return {order:o,score,why}}).filter(r=>r.score>0).sort((a,b)=>b.score-a.score||String(b.order.at).localeCompare(String(a.order.at))).slice(0,5)}
function linkedOrders(ranked){if(!ranked.length)return [];const top=ranked[0];
  if(top.score<4)return [];if(ranked[1]&&ranked[1].score>=top.score-1)return [];return [top.order]}
function callsByIdsConfig(ids,from,to){return {exploreName:PULL.explore,dimensions:CALL_DIMS,metrics:[],sorts:[{fieldId:"calls_call_started_at_est",descending:false}],limit:PULL.cap,
  filters:{dimensions:`calls_call_started_at_est_day inBetween=${from},${to} AND calls_conversation_id equals=${ids.map(ldVal).join(",")}`}}}
function phoneCallsConfig(phones,from,to){return {exploreName:PULL.explore,dimensions:CALL_DIMS,metrics:[],sorts:[{fieldId:"calls_call_started_at_est",descending:false}],limit:PULL.cap,
  filters:{dimensions:`calls_call_started_at_est_day inBetween=${from},${to} AND calls_call_phone_detail equals=${phones.map(ldVal).join(",")}`}}}
function callRow(x){return {id:String(x.calls_conversation_id||""),at:String(x.calls_call_started_at_est||"").slice(0,19),sec:Number(x.calls_call_duration_in_seconds)||0,
  agent:cleanAgent(x.internal_users_full_name||""),login:String(x.internal_users_user_login_name||""),dir:x.calls_call_type==="outbound_call"?"out":"in",
  phone:String(x.calls_call_phone_detail||""),text:String(x.asr_transcript_call_transcript||"")}}

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

/* ---------- 4. Prompts ---------- */
const CHAT_CTX = "Tarro answers the phones and runs the POS, online ordering and delivery for pizza restaurants. The restaurant is Tarro's client. Super Agents (SAs) support clients through WIRA chat and phone. AEs/CSMs manage client accounts; leads (e.g. Howard Ho) approve exceptions.";
const EVIDENCE_RULES = [
  `- Some facts live where Tarro can't see them: the client's own online ordering or website, what their kitchen made, payments taken in store. There the client's own account is acceptable evidence. Note that it is the client's word; do not mark the SA down for not verifying what Tarro has no access to.`];
const SCORE_ONCE = `- Score each flaw once, in the criterion it belongs to. A premature defense in the first reply is a First response problem; don't also take it off evidence, fault or reply quality if the SA later got those right.`;
const NO_PRONOUNS = `- Refer to people by name or role, never as he or she.`;
const SPEAKER_RULES = [
  `Who said it, in call transcripts (the hardest part; get it right):`,
  `- Transcripts are machine speech-to-text with NO speaker labels. "Darrow", "Tauro", "Taro", "Tiro" or "Tyro" usually means Tarro.`,
  `- The Tarro agent is the person named in the call header. Agents use an alias and often answer as the restaurant ("<restaurant name>, pickup or delivery?", "This is Sam, the manager"). That greeting is the agent. Always write the agent's header name.`,
  `- The other side is usually the customer ordering food, or restaurant staff. The agent's turns are mostly greetings, read-backs, totals, questions and the agent's own actions or offers. Reports of what happened almost always come from the caller.`,
  `- A question or read-back is not a claim. If a line can't be placed on one speaker with confidence, set "who" to "unclear". An "unclear" fact is fine; a fact on the wrong person is a serious error.`];
function chatEvidence(k){const c=k.chat,L=[];
  L.push(`CHAT ${c.sid} · ${c.restaurant}${c.code?` (${c.code})`:""} · opened ${c.at.replace("T"," ")} ET · ${c.initiator==="client"?"started by the client":c.initiator==="ae"?`created by AE ${c.createdBy}`:"started by "+(c.createdBy||"staff")}`);
  L.push(`Audited SA: ${c.sa}${c.frt!=null?` · first reply ${c.frt} min after the first client message`:""} · status ${c.status}${c.sub?" / "+c.sub:""}`);
  L.push(`Messages are in order; WIRA keeps no per-message times. Internal notes are inferred from the text (an @mention, or staff talking about the client); if one clearly reads as written to the client, treat it as client-visible.`);
  L.push("",chatTranscript(c));
  if((k.tasks||[]).length){L.push("","LINKED TASKS");k.tasks.forEach(t=>{L.push(`\nTASK ${t.sid}${t.parent===c.wid?" (child of this chat)":""} · created ${t.at.replace("T"," ")} ET by ${t.by||"unknown"} · assigned ${t.assigned||"nobody"} · ${t.intent||t.project} · status ${t.status}`);
    L.push(`Title: ${t.title}`);if(t.desc)L.push(`Description: ${t.desc}`);if(t.fields&&t.fields!=="{}")L.push(`Fields: ${capText(t.fields,300)}`);
    t.comments.forEach(cm=>L.push(`- ${cm.who||"someone"}: ${cm.text}`))})}
  if((k.orders||[]).length){L.push("","LINKED ORDERS (from Tarro's order data)");k.orders.forEach(o=>L.push(`${o.label} · ticket ${o.ticket||"?"} · created ${o.at.replace("T"," ")} ET · ${o.source}${o.type?" · "+o.type:""}${o.coupon?" · coupon "+o.coupon:""} · items ${money(o.items)} + tax ${money(o.tax)}${o.tip?" + tip "+money(o.tip):""}${o.other?` + other ${money(o.other)}`:""} = total ${money(o.total)}`))}
  else L.push("","LINKED ORDERS: none matched with confidence.");
  if(k.orderNote)L.push(k.orderNote);
  let budget=CHAT.budget;
  if((k.calls||[]).length){L.push("","LINKED CALL RECORDINGS");k.calls.forEach((l,i)=>{let tx=String(l.text||"").trim();if(tx.length>CHAT.txCap)tx=tx.slice(0,CHAT.txCap)+" …";if(tx.length>budget)tx=tx.slice(0,Math.max(0,budget))+" …";budget-=tx.length;
    L.push(`\nCALL ${i+1} · ${l.at.replace("T"," ")} ET · ${dur(l.sec)} · agent ${l.agent||"unknown"} · ${l.dir==="out"?"outbound to":"inbound from"} …${String(l.phone).slice(-4)}${l.orders?` · tied to ${l.orders}`:""}\n${tx||"[no transcript]"}`)})}
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
    NO_PRONOUNS,
    ...SPEAKER_RULES,
    ``,`Then CHECK THE SA'S CLAIMS. List every factual claim ${sa} made about what happened (to the client, in internal notes, or in tasks), e.g. "the customer chose pickup" or "the agent failed to confirm whether to keep the phone order". For each, check it against the recordings, order data and tasks:`,
    `- "supported": the evidence shows it. "contradicted": the evidence shows otherwise. "cant_check": the evidence doesn't cover it.`,
    `- Evidence is a short quote or fact from a call, order or task. Judge each claim on its own, including claims ${sa} later took back.`,
    ``,`Reply with only a JSON object:`,
    `{"calls": [{"n": 1, "bullets": ["3 to 5 bullets, each under 15 words: who called and why, what happened, how it ended"]}],`,
    ` "timeline": [{"src": "M3 | Call 2 | O1 | Task 1831693 | Slack", "when": "time if known, else empty", "who": "who said or did it, or unclear", "kind": "said | did | internal", "what": "the fact, under 25 words"}],`,
    ` "claims": [{"src": "M3", "claim": "what ${sa} claimed, under 20 words", "check": "supported | contradicted | cant_check", "evidence": "quote or fact, under 25 words"}],`,
    ` "promises": [{"src": "M8", "who": "", "to": "", "what": "under 12 words"}]}`,
    `"timeline" puts recordings and orders in time order first, then the chat in message order. "calls" has one entry per call recording, numbered as below.`,
    ``,chatEvidence(k)].join("\n")}
function chatFactLines(F){return F.timeline.map(t=>`${t.id} · ${[t.when,t.src].filter(Boolean).join(" · ")} · ${t.who||"someone"} [${t.kind}]: ${t.what}`).join("\n")+
  "\n\nSA CLAIMS CHECK\n"+(F.claims.length?F.claims.map(c=>`${c.id} · ${c.src} · ${c.check.toUpperCase()}: ${c.claim} — ${c.evidence}`).join("\n"):"No factual claims.")+
  "\n\nPROMISES\n"+(F.promises.length?F.promises.map(p=>`${p.id} · ${p.src} · ${p.who} to ${p.to}: ${p.what}`).join("\n"):"None.")}
function calibLines(cal){return (cal||[]).slice(0,CHAT.calibMax).map((c,i)=>`CASE ${i+1} · ${c.agent||"SA"} · ${c.restaurant||""} · ${c.date||""} · QA lead's verdict: ${String(c.verdict||"").toUpperCase()}\n`+(c.lessons||[]).map(l=>"- "+l).join("\n")).join("\n\n")}
function chatAnalysisPrompt(k,F,policy,cal){const sa=k.chat.sa||"the SA",P=(policy&&policy.comp)||CHAT_POLICY_EMPTY.comp;
  const buckets=(P.buckets||[]).map(b=>`${b.id} (${b.label}: ${b.pct}%${b.deliveryFee?", + delivery fee on self-delivery":""})`).join("; ")||"none loaded";
  return [`You are the analyst for a QA lead at Tarro. ${CHAT_CTX}`,
    `Below is the record of one support chat (facts F#, SA claims C#, promises P#) and the orders it was tied to (O#). Analyze it the way the QA lead does: FIRST the facts, THEN fault, THEN the right solution, THEN how the SA's solution compares. Use only the record and the policy; cite fact ids.`,
    ``,`Rules:`,
    `- Fault: "tarro" (a Tarro agent or system error, confirmed by the recording), "restaurant", "customer", "shared_tarro" (Tarro had a chance to catch it and didn't), "shared_other", or "unclear". A client's claim is not proof; the recording is.`,
    `- Pick the compensation bucket from the policy that fits the facts, and the affected order (O#). Do NOT calculate money; the system does it from the bucket and the order's item subtotal.`,
    `- Say what the ideal SA would have done for the client (and the customer, if relevant), whether escalation to a lead was needed, and why.`,
    `- Record what ${sa} offered (amount and what it was built on) and whether ${sa}'s path matches the ideal.`,
    `- AE/CSM involvement: "over_head" (the client went over the SA to the AE), "corrected_sa" (the AE had to correct the SA), "ae_initiated" (the AE created the chat), "context" (the AE added context), or "none". Say whether ${sa} could reasonably have prevented it.`,
    `- First response: did ${sa}'s first substantive reply defend, blame or conclude before checking the evidence? Cite it.`,
    `- Follow the QA lead's calibration cases below where they apply; they show how the lead grades.`,
    ...EVIDENCE_RULES,
    NO_PRONOUNS,
    ``,`Reply with only a JSON object:`,
    `{"summary": "what happened, 2-3 sentences",`,
    ` "fault": {"who": "tarro | restaurant | customer | shared_tarro | shared_other | unclear", "why": "one sentence", "cites": ["F2"]},`,
    ` "bucket": {"id": "one of: ${(P.buckets||[]).map(b=>b.id).join(" | ")||"none"}", "why": "one sentence", "cites": []},`,
    ` "affectedOrder": "O1 or empty", "selfDelivery": false, "deliveryFee": null,`,
    ` "ideal": {"client": "what the ideal SA tells and gives the client, under 40 words", "customer": "under 25 words, or empty", "escalation": {"needed": true, "why": "under 25 words", "to": "who"}},`,
    ` "saOffer": {"amount": 17.73, "text": "what ${sa} offered, under 20 words", "cites": ["F8"]},`,
    ` "saPath": {"match": "yes | partly | no", "why": "under 30 words"},`,
    ` "aeInvolvement": {"kind": "over_head | corrected_sa | ae_initiated | context | none", "saCouldPrevent": false, "why": "under 30 words"},`,
    ` "firstResponse": {"concludedBeforeEvidence": false, "why": "under 30 words", "cites": []}}`,
    `(The numbers in the example are placeholders.)`,
    ``,`COMPENSATION POLICY (${policy&&policy.version||"none loaded"})`,(policy&&policy.text)||"No policy loaded: say so in every answer that depends on it.",
    `Buckets: ${buckets}. Approval limit: ${money(P.approvalLimit)} (above it, ${P.approver||"the lead"} approves first).`,
    ``,`QA LEAD'S CALIBRATION CASES`,calibLines(cal)||"None yet.",
    ``,`CHAT ${k.chat.sid} · ${k.chat.restaurant} · audited SA ${sa}`,
    `ORDERS`,(k.orders||[]).map(o=>`${o.label} · ticket ${o.ticket||"?"} · ${o.type||o.source} · items ${money(o.items)}, tax ${money(o.tax)}${o.tip?`, tip ${money(o.tip)}`:""}, total ${money(o.total)}`).join("\n")||"None linked.",
    ``,`RECORD`,chatFactLines(F)].join("\n")}
const CHAT_RUBRIC = [
  {id:"fr",label:"First response",w:10,max:3,d:"Acknowledges the issue, says what they're checking, asks only for what's needed. Does not defend, blame or conclude before checking the evidence."},
  {id:"ev",label:"Gathered the evidence",w:15,max:3,d:"Reviewed the recording and the order before concluding; every factual claim is supported."},
  {id:"rs",label:"Restated the case correctly",w:10,max:3,d:"Told the client what happened, accurately and plainly."},
  {id:"fa",label:"Fault attribution",w:15,max:3,d:"Correct fault; owned clearly when it's Tarro's; pushed back when it isn't."},
  {id:"path",label:"Resolution path",w:15,max:3,d:"Chose the right policy path for the case."},
  {id:"amt",label:"Resolution accuracy",w:10,max:3,d:"The amount and terms are exactly right: right base (items only), right %, fees handled."},
  {id:"expl",label:"Solution explained",w:5,max:3,d:"The client understands what they get, why and when; explains the math when challenged."},
  {id:"esc",label:"Escalation",w:15,max:4,d:"0 needed but not done · 1 tagged the lead · 2 + a summary the lead will read (chat or ticket) · 3 + a recommended solution, asking the lead's opinion · 4 + the recommendation is correct, with clear logic. N/A when no escalation was needed."},
  {id:"tone",label:"Reply quality",w:5,max:3,d:"Clear, warm, professional; owns mistakes; no over-promising."}];
const VERDICTS = [["great",90,"Great"],["good",80,"Good"],["okay",65,"Okay"],["needs_work",50,"Needs work"],["miss",0,"Miss"]];
function chatGradePrompt(k,F,A,comp,offer,cal){const sa=k.chat.sa||"the SA";
  return [`You are Swift Coach, the QA lead's coaching assistant at Tarro. ${CHAT_CTX}`,
    `Grade how ${sa} handled this chat and coach ${sa.split(" ")[0]}. You have the record, the analysis and the system's compensation math. Do not re-decide the facts or the money; grade against them.`,
    ``,`The QA lead's route: (1) establish the case facts, (2) analyze them and attribute fault, (3) give the right solution, (4) reply well. Judge each step.`,
    ``,`SCORECARD (0-3 unless noted; "na" only where it says so):`,
    ...CHAT_RUBRIC.map(r=>`- ${r.id} · ${r.label}${r.max!==3?` (0-${r.max})`:""}: ${r.d}`),
    `- "na" is allowed for fr (no first response to judge), expl (nothing to explain) and esc (no escalation needed).`,
    ``,`Rules:`,
    `- Every reason cites facts (F#, C#, M#) and says exactly what was right or wrong, in one sentence.`,
    `- Use the calibration cases: they are how the QA lead grades.`,
    SCORE_ONCE,
    ...EVIDENCE_RULES,
    NO_PRONOUNS,
    `- Coaching is for ${sa.split(" ")[0]}. Plain, direct, specific. Each "next time" item: what happened (quote it), why it matters, what to do, and a model message ${sa.split(" ")[0]} could have sent. For an escalation, the model message is a Level 4 escalation: summary + recommendation + logic.`,
    ``,`Reply with only a JSON object:`,
    `{"scores": {${CHAT_RUBRIC.map(r=>`"${r.id}": 0`).join(", ")}},`,
    ` "reasons": {${CHAT_RUBRIC.map(r=>`"${r.id}": "one sentence"`).join(", ")}},`,
    ` "route": {"facts": {"mark": "right | partly | wrong", "why": ""}, "analysis": {"mark": "", "why": ""}, "solution": {"mark": "", "why": ""}, "escalation": {"mark": "", "why": ""}},`,
    ` "wentWell": ["2-3 items, each under 20 words"],`,
    ` "nextTime": [{"what": "what happened, quoting the chat", "why": "why it matters", "do": "what to do next time", "model": "a message ${sa.split(" ")[0]} could have sent"}],`,
    ` "verdictWhy": "two sentences on the overall grade"}`,
    ``,`QA LEAD'S CALIBRATION CASES`,calibLines(cal)||"None yet.",
    ``,`ANALYSIS`,JSON.stringify({summary:A.summary,fault:A.fault,bucket:A.bucket,ideal:A.ideal,saOffer:A.saOffer,saPath:A.saPath,aeInvolvement:A.aeInvolvement,firstResponse:A.firstResponse}),
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
  const timeline=arr(x.timeline).filter(t=>t&&t.what).slice(0,80).map((t,i)=>({id:"F"+(i+1),src:chS(t.src,40),when:chS(t.when,20),who:chS(t.who,60),kind:KINDS.includes(String(t.kind).toLowerCase())?String(t.kind).toLowerCase():"said",what:chS(t.what,260)}));
  const claims=arr(x.claims).filter(c=>c&&c.claim).slice(0,30).map((c,i)=>{const k=String(c.check||"").toLowerCase().replace(/[\s-]+/g,"_");return {id:"C"+(i+1),src:chS(c.src,20),claim:chS(c.claim,220),check:CHECKS.includes(k)?k:"cant_check",evidence:chS(c.evidence,260)}});
  const promises=arr(x.promises).filter(p=>p&&p.what).slice(0,15).map((p,i)=>({id:"P"+(i+1),src:chS(p.src,20),who:chS(p.who,60),to:chS(p.to,60),what:chS(p.what,160)}));
  if(!timeline.length)return null;return {calls:callsOut,timeline,claims,promises}}
const FAULTS=["tarro","restaurant","customer","shared_tarro","shared_other","unclear"],AE_KINDS=["over_head","corrected_sa","ae_initiated","context","none"],MATCH=["yes","partly","no"];
function cleanChatAnalysis(x,F,policy){if(!x||typeof x!=="object"||Array.isArray(x))return null;const ids=new Set(F.timeline.map(t=>t.id).concat(F.claims.map(c=>c.id),F.promises.map(p=>p.id)));
  const cites=a=>arr(a).map(v=>String(v).trim().toUpperCase()).filter(v=>ids.has(v)).slice(0,8),o=v=>v&&typeof v==="object"?v:{},low=v=>String(v||"").trim().toLowerCase().replace(/[\s-]+/g,"_");
  const bucketIds=((policy&&policy.comp&&policy.comp.buckets)||[]).map(b=>b.id),f=o(x.fault),b=o(x.bucket),id=o(x.ideal),es=o(id.escalation),so=o(x.saOffer),sp=o(x.saPath),ae=o(x.aeInvolvement),fr=o(x.firstResponse);
  const amt=so.amount==null||so.amount===""?null:Number(String(so.amount).replace(/[$,]/g,""));
  return {summary:chS(x.summary,700),fault:{who:FAULTS.includes(low(f.who))?low(f.who):"unclear",why:chS(f.why,300),cites:cites(f.cites)},
    bucket:{id:bucketIds.includes(low(b.id))?low(b.id):"",why:chS(b.why,300),cites:cites(b.cites)},
    affectedOrder:/^O\d+$/i.test(String(x.affectedOrder||"").trim())?String(x.affectedOrder).trim().toUpperCase():"",
    selfDelivery:x.selfDelivery===true,deliveryFee:Number(x.deliveryFee)>0?r2(x.deliveryFee):null,
    ideal:{client:chS(id.client,400),customer:chS(id.customer,250),escalation:{needed:es.needed===true,why:chS(es.why,250),to:chS(es.to,60)}},
    saOffer:{amount:isNaN(amt)?null:amt,text:chS(so.text,200),cites:cites(so.cites)},
    saPath:{match:MATCH.includes(low(sp.match))?low(sp.match):"partly",why:chS(sp.why,300)},
    aeInvolvement:{kind:AE_KINDS.includes(low(ae.kind))?low(ae.kind):"none",saCouldPrevent:ae.saCouldPrevent===true,why:chS(ae.why,300)},
    firstResponse:{concludedBeforeEvidence:fr.concludedBeforeEvidence===true,why:chS(fr.why,300),cites:cites(fr.cites)}}}
const MARKS=["right","partly","wrong"];
function cleanChatGrade(x){if(!x||typeof x!=="object"||Array.isArray(x))return null;const sc=x.scores&&typeof x.scores==="object"?x.scores:{},rs=x.reasons&&typeof x.reasons==="object"?x.reasons:{};
  const scores={},reasons={};CHAT_RUBRIC.forEach(r=>{const v=sc[r.id];const na=String(v).toLowerCase()==="na"||v==null;
    scores[r.id]=na&&["fr","expl","esc"].includes(r.id)?"na":Math.max(0,Math.min(r.max,Math.round(Number(v)||0)));reasons[r.id]=chS(rs[r.id],300)});
  const rt=x.route&&typeof x.route==="object"?x.route:{},route={};["facts","analysis","solution","escalation"].forEach(k=>{const v=rt[k]&&typeof rt[k]==="object"?rt[k]:{};
    route[k]={mark:MARKS.includes(String(v.mark).toLowerCase())?String(v.mark).toLowerCase():"partly",why:chS(v.why,300)}});
  return {scores,reasons,route,wentWell:arr(x.wentWell).map(t=>chS(t,200)).filter(Boolean).slice(0,4),
    nextTime:arr(x.nextTime).filter(n=>n&&(n.what||n.do)).slice(0,5).map(n=>({what:chS(n.what,300),why:chS(n.why,300),do:chS(n.do,300),model:chS(n.model,900)})),
    verdictWhy:chS(x.verdictWhy,500)}}
/* score and verdict are computed, so the same marks always give the same grade */
function chatScore(scores){let got=0,den=0;CHAT_RUBRIC.forEach(r=>{const v=scores&&scores[r.id];if(v==="na"||v==null||v==="")return;den+=r.w;got+=r.w*Math.min(r.max,Number(v))/r.max});
  return den?Math.round(got/den*1000)/10:null}
function chatVerdict(pct){if(pct==null)return null;const v=VERDICTS.find(([,min])=>pct>=min)||VERDICTS[VERDICTS.length-1];return {id:v[0],label:v[2]}}
/* CHAT-CORE END */
if(typeof module!=="undefined"){const core=require("./core.js");Object.assign(globalThis,core);
  module.exports={CHAT,CHAT_V,CHAT_DIMS,STAFF_DEFAULT,ROLE_L,chatBaseConfig,isBaseChat,chatRow,chatMessages,chatTranscript,relatedTasksConfig,relTask,pickRelated,orderConfig,orderRow,
    textRefs,mergeRefs,rankOrders,linkedOrders,callsByIdsConfig,phoneCallsConfig,callRow,CHAT_POLICY_EMPTY,compFor,offerCheck,chatEvidence,chatRefsPrompt,chatFactsPrompt,
    chatFactLines,calibLines,chatAnalysisPrompt,CHAT_RUBRIC,VERDICTS,chatGradePrompt,cleanChatRefs,cleanChatFacts,cleanChatAnalysis,cleanChatGrade,chatScore,chatVerdict,money,r2}}
