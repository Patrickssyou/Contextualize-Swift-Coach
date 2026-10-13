/* ---------- CHATS: the WIRA chat audit area (Queue · Audit · Brain). The brain is src/chat.js; this is the page around it. ----------
   db (CHAT_PATHS): chatWeeks/<week>/chats/<sid> (the queue; the doc is the chat), …/audits/<sid> (Claude's pre-grade), …/tx/<sid> (transcripts),
       …/reviews/<sid> (the reviewer's marks, coaching and finding marks); chatCalib/<sid> (calibration cases), settings/chatPolicy, settings/staff;
       chatLessons/<sid>_<crit> (what the coach learned: contested marks, kind "contest", and findings marked "not a mistake", kind "not"; the newest 20 go into every grade).
   chatWeeks/<week> itself is a small index doc written on pull, so the game layer can find the weeks that have reviews.
   Live subscriptions: the selected week's chats, audits and reviews (resubscribed once per week change), plus calibration, corrections, policy and staff.
   Transcripts are read per chat when opened; other weeks' reviews are read once per load with .get() for XP and the streak. */
let chats=[], chatAud={}, chatRev={}, chatCal=[], chLessons=[], chatPolicyDoc=null, staffDoc=null, chatsReady=false;
let chatSel=null, chatRun=null, chatPullRun=null, chatNote=null, chatPickOpen=null, calForm=null, chatAuditSig="", chLastRun=null;
let polDirty=false, staffDirty=false, chTimelineOpen=false, chOrdQ="";
/* the open contest box (one at a time): {sid, crit, where: "row" | "find", to, reason} */
let chContest=null;
const chatDrafts=new Map(), chatTxCache=new Map(), chModelOpen=new Set();
const CH_LESSONS="chatLessons";
/* the loaded week and its unsubscribers; other weeks' reviews for the game layer (week -> {sid: review}) */
let chW={week:"",offs:[],live:false}, chHistRun=null;
const chRevHist=new Map();
const CH_ROOT=CHAT_PATHS.chats("w").split("/")[0], CH_FIRST_WEEK="2026-09-28";
const chPath=(kind,w,sid)=>CHAT_PATHS[kind](w)+"/"+sid;
const chWk=c=>(c&&c.week)||chW.week||week;

/* ---------- small helpers ---------- */
const CH_VB={great:"good",good:"good",okay:"ok",needs_work:"bad",miss:"bad"};
const chVLabel=id=>(VERDICTS.find(v=>v[0]===id)||[])[2]||"";
const chVB=pct=>{const v=chatVerdict(pct);return v?CH_VB[v.id]:"none"};
const CH_MARK={right:"✓",partly:"~",wrong:"✗"},CH_MARK_L={right:"Right",partly:"Partly",wrong:"Wrong"};
const CH_CHECK={supported:["✓","Supported"],contradicted:["✗","Contradicted"],cant_check:["?","Can't check"]};
const CH_FAULT={tarro:"Tarro",restaurant:"Restaurant",customer:"Customer",shared_tarro:"Shared (Tarro could have caught it)",shared_other:"Shared",unclear:"Unclear",none:"No fault"};
const CH_CASE={compensation:"Compensation",order_issue:"Order issue",customer_recovery:"Customer credit",contact_customer:"Contact customer",menu_setup:"Menu setup",
  hours_service:"Hours / service",device_printer:"Printer / device",billing_payment:"Billing",order_admin:"Order admin",how_to:"How-to",other:"Other"};
const chCaseL=t=>CH_CASE[t]||capFirst(String(t||"").replace(/_/g," ").trim());
const chFaultAns=f=>f&&f.who?(f.who==="none"?"No fault":"Fault: "+(CH_FAULT[f.who]||f.who)):"";
const CH_AE={over_head:"Client went over the SA to the AE",corrected_sa:"AE corrected the SA",ae_initiated:"AE started the chat",context:"AE added context",none:"None"};
const CH_PATH={yes:"Matches the ideal",partly:"Partly matches",no:"Doesn't match"};
const CH_ROLES=[["ae","AE/CSM"],["lead","Lead"],["crt","CRT"],["staff","Staff"]];
const chFirst=s=>String(s||"").trim().split(/\s+/)[0]||"";
const chLower=s=>s&&/^[A-Z][a-z]/.test(s)?s[0].toLowerCase()+s.slice(1):s;
function chFrt(m){if(m==null||isNaN(m))return "–";m=Number(m);return m<60?(Math.round(m*10)/10)+" min":Math.floor(m/60)+" h "+Math.round(m%60)+" min"}
const chMarkL=v=>v==="na"?"N/A":v==null?"–":Number(v)%1?`${Math.floor(v)}–${Math.ceil(v)}`:String(v);
function chMarkCls(v,max){if(v==="na"||v==null)return "na";const p=Number(v)/max;return p>=1?"s3":p>=.5?"s2":p>0?"s1":"s0"}
/* a doc's content fingerprint (cached per snapshot object): what the audit view and the review draft key on, so a re-grade always shows */
const chHashes=new WeakMap();
function chHash(o){if(!o||typeof o!=="object")return "";let h=chHashes.get(o);if(h==null){h=fnv(JSON.stringify(o)).toString(36);chHashes.set(o,h)}return h}
const chatBy=sid=>chats.find(c=>String(c.sid)===String(sid))||null;
const chatsOfWeek=()=>chW.week===week?chats.filter(c=>c.week===week):[];
/* gradable needs an SA reply; the queue doc says so at pull time */
const chCanGrade=c=>!!c&&c.gradable!==false&&chatGradable(c);
function chSaOrder(names){const order=roster.agents.map(a=>a.name);return [...new Set(names)].sort((a,b)=>{const i=order.indexOf(a),j=order.indexOf(b);return (i<0?99:i)-(j<0?99:j)||String(a).localeCompare(String(b))})}
function chSort(list){const sas=chSaOrder(list.map(c=>c.sa));return list.slice().sort((a,b)=>sas.indexOf(a.sa)-sas.indexOf(b.sa)||String(a.at).localeCompare(String(b.at)))}
function chFirstLine(c){const m=(c.msgs||[]).find(x=>x.role==="client")||(c.msgs||[])[0];const t=String((m&&m.text)||c.title||"").replace(/\s+/g," ").trim();return t.length>120?t.slice(0,118)+"…":t}
/* a chat link carries its week (#chat/<week>/<sid>), so a reload opens on the right week */
function chatHash(){if(!chatSel)return "chat";const c=chatBy(chatSel);return "chat/"+((c&&c.week)||week)+"/"+encodeURIComponent(chatSel)}
function openChat(sid,wk){wk=wk?chatWeek(wk):"";if(wk&&wk!==week){week=wk;chatsWeekListen()}
  chatSel=String(sid);chatPickOpen=null;calForm=null;setTab("chat");window.scrollTo({top:0})}

/* ---------- game layer hooks (read by gameStats in the page) ---------- */
/* every review: the loaded week's live ones plus the other weeks read once at load */
function myChatReviews(){const out=[];chRevHist.forEach((m,w)=>{if(w!==chW.week)out.push(...Object.values(m))});out.push(...Object.values(chatRev));
  return out.filter(r=>r&&(!myId||!r.by||r.by===myId))}
function chatXpFor(r){return 10+(chatCal.some(x=>String(x.sid)===String(r&&r.sid))?5:0)}
/* the week quest: picks reviewed, graded, and you vs Claude on this week's reviews */
function chatQuest(wk){const T=chatsOfWeek().filter(c=>c.week===wk&&(c.picked||chatRev[c.sid]));
  const done=T.filter(c=>chatRev[c.sid]).length,graded=T.filter(c=>chatAud[c.sid]).length,m={n:0,s:0};
  Object.values(chatRev).filter(r=>!myId||!r.by||r.by===myId).forEach(r=>{const a=chatAud[r.sid],g=a&&a.grade&&a.grade.scores;if(!g)return;
    CHAT_RUBRIC.forEach(x=>{const y=r.scores&&r.scores[x.id],z=g[x.id];if(y==null||z==null)return;m.n++;if(String(y)===String(z))m.s++})});
  const by=new Map();T.forEach(c=>{if(!by.has(c.sa))by.set(c.sa,[]);by.get(c.sa).push(c)});
  return {total:T.length,done,graded,match:m,sweep:[...by.values()].some(l=>l.length>=3&&l.every(c=>chatRev[c.sid]))}}

/* ---------- listeners ---------- */
function chatsListen(){if(!db)return;
  const re=()=>{renderChats();renderGame()};
  db.collection(CHAT_PATHS.calib).onSnapshot(s=>{chatCal=s.docs.map(x=>Object.assign({},x.data(),{id:x.id}));re()},()=>{});
  db.collection(CH_LESSONS).onSnapshot(s=>{chLessons=s.docs.map(x=>Object.assign({},x.data(),{id:x.id}));re()},()=>{});
  db.doc(CHAT_PATHS.policy).onSnapshot(s=>{chatPolicyDoc=s.exists?s.data():null;re()},()=>{});
  db.doc(CHAT_PATHS.staff).onSnapshot(s=>{staffDoc=s.exists?s.data():null;re()},()=>{});
  chatsWeekListen();chatHistory();
}
/* the selected week's three live collections. Called once per week change (the week buttons, a chat link), never from render */
function chatsWeekListen(){if(!db||chW.week===week)return;
  chW.offs.forEach(f=>{try{f()}catch(e){}});
  if(chW.week&&chW.live)chRevHist.set(chW.week,chatRev);
  const w=week,S={week:w,offs:[],live:false};chW=S;
  chats=[];chatAud={};chatRev=Object.assign({},chRevHist.get(w)||{});chatsReady=false;chatPickOpen=null;
  const cur=()=>chW===S,re=()=>{renderChats();renderGame()};
  S.offs.push(db.collection(CHAT_PATHS.chats(w)).onSnapshot(s=>{if(!cur())return;
    chats=s.docs.map(x=>{const d=x.data();return Object.assign({},d,{sid:String(d.sid||x.id),week:w})});chatsReady=true;re()},()=>{if(!cur())return;chatsReady=true;re()}));
  S.offs.push(db.collection(CHAT_PATHS.audits(w)).onSnapshot(s=>{if(!cur())return;chatAud=Object.fromEntries(s.docs.map(x=>[x.id,x.data()]));re()},()=>{}));
  S.offs.push(db.collection(CHAT_PATHS.reviews(w)).onSnapshot(s=>{if(!cur())return;chatRev=Object.fromEntries(s.docs.map(x=>[x.id,x.data()]));S.live=true;re()},()=>{}));
}
/* other weeks' reviews, once per load: the pulled weeks (index docs) and every week since chats started */
function chatHistory(){if(!db||chHistRun)return chHistRun;
  chHistRun=(async()=>{const weeks=new Set();
    try{(await db.collection(CH_ROOT).get()).docs.forEach(d=>{if(/^\d{4}-\d{2}-\d{2}$/.test(d.id))weeks.add(d.id)})}catch(e){}
    const last=iso(mondayOf(new Date()));for(let w=CH_FIRST_WEEK,i=0;w<=last&&i<520;w=addDays(w,7),i++)weeks.add(w);
    const list=[...weeks].sort().filter(w=>w!==chW.week&&!chRevHist.has(w));
    for(let i=0;i<list.length;i+=3)await Promise.all(list.slice(i,i+3).map(async w=>{
      try{const s=await db.collection(CHAT_PATHS.reviews(w)).get();if(w!==chW.week&&!chRevHist.has(w))chRevHist.set(w,Object.fromEntries(s.docs.map(x=>[x.id,x.data()])))}catch(e){}}));
    renderGame()})();
  return chHistRun}
function renderChats(){renderChatTabs();renderChatQueue();if(tab==="chat")renderChatAudit();if(tab==="brain")renderBrain()}
function renderChatTabs(){const tb=document.querySelector('[role=tab][data-tab="chat"]');if(!tb)return;
  const c=chatSel&&chatBy(chatSel),a=c&&chatAud[c.sid];tb.classList.toggle("done",!!c);
  const st=$("#st-chat");if(st){const d=a&&chatDraft(c.sid),p=d?chatScore(d.scores):null;st.textContent=p!=null?fmt(p)+"%":""}
  const n=chatsOfWeek().filter(x=>x.picked&&!chatRev[x.sid]).length;const cc=$("#chCount");if(cc)cc.textContent=n?String(n):""}

/* ---------- errors: Lightdash and Claude access errors stop a batch; anything else marks that chat and moves on ---------- */
const CH_AI_STOP=["not_granted","sampling_disabled","not_declared","capability_disabled","capability_removed","session_expired","rate_limited","queue_overflow"];
function chatIsAccess(e){const c=e&&e.code,s=e&&e.src;
  if(s==="ld")return LD_ACCESS.includes(c)||c==="server_unavailable"||(c==="upstream_error"&&!!e.retryable);
  if(s==="ai")return CH_AI_STOP.includes(c);
  return s==="db"}
function chatAiErr(e){return aiErr(e).replace("read calls","read chats").replace("these calls","this chat").replace("These calls are","This chat is")}
function chatErrMsg(e){const c=e&&e.code;
  if(c==="error")return "Something went wrong with this chat"+(e.message?": "+String(e.message).slice(0,80):".");
  if(e&&e.src==="ld")return pullErr(e,"Try again");
  if(e&&e.src==="db")return c==="invalid_argument"?"You can't save to this QA Desk.":c==="quota_exceeded"?"The QA Desk storage is full. Export, then delete old weeks.":"Couldn't save. Try again.";
  return chatAiErr(e)}
const chTag=(e,src)=>{const o=e&&typeof e==="object"?e:{message:String(e)};return Object.assign({},o,{code:o.code||"error",message:o.message||"",src:o.src||src,retryable:o.retryable})};

/* ---------- Slack: threads about the restaurant from the day before to the day after ---------- */
async function chatSlack(c,ctl){
  try{
    const day=String(c.at||"").slice(0,10);if(!day||!mcp)return [];
    const name=String(c.restaurant||"").replace(/"/g,"").trim(),keywords=name?['"'+name+'"']:c.code?[c.code]:[];if(!keywords.length)return [];
    const after=String(Math.floor(etToUtcMs(Date.parse(addDaysU(day,-1)+"T00:00:00Z"))/1000)),before=String(Math.floor(etToUtcMs(Date.parse(addDaysU(day,2)+"T00:00:00Z"))/1000)-1);
    if(ctl&&ctl.signal.aborted)throw {code:"cancelled"};
    const res=await mcp.callTool(SLACK,"slack_search_public",{keywords,after,before,include_context:false,response_format:"detailed",limit:20});
    const hits=new Map();parseSlackSearch(payloadText(res,"results")).forEach(r=>{if(/^proj-flag|alert/i.test(r.channel))return;const k=r.channelId+"/"+r.threadTs;if(!hits.has(k))hits.set(k,r)});
    const out=[];
    for(const r of [...hits.values()].sort((a,b)=>b.replies-a.replies).slice(0,5)){
      if(ctl&&ctl.signal.aborted)throw {code:"cancelled"};
      let th={text:capText(r.text,700),author:r.author,replies:[]};
      if(r.replies>0||r.threadTs!==r.ts){try{th=parseSlackThread(payloadText(await mcp.callTool(SLACK,"slack_read_thread",{channel_id:r.channelId,message_ts:r.threadTs,response_format:"concise"}),"messages"))}catch(e){}}
      out.push({channel:r.channel,author:th.author||r.author||"",text:slackClean(th.text),at:new Date(etWall(Number(r.threadTs)*1000)).toISOString().slice(0,19),ts:r.threadTs,url:safeUrl(r.url),
        replies:th.replies.slice(0,12).map(x=>({who:x.who,text:slackClean(x.text)}))})}
    return out.sort((a,b)=>String(a.at).localeCompare(String(b.at)));
  }catch(e){if(e&&e.code==="cancelled")throw e;throw {code:"slack_failed",message:String((e&&e.message)||"")}}
}

/* ---------- pull the week ---------- */
async function pullChats(){
  if(chatPullRun||chatRun||!db||!mcp||!chatsReady||chW.week!==week)return;
  const w=week;chatPullRun={step:"Pulling chats from Lightdash…"};chatNote=null;renderChats();
  try{
    const R=roster,staff=(staffDoc&&staffDoc.map)||{};
    const list=await pullChatWeek(w,R.agents.map(a=>a.name),(cfg,title)=>ldQuery(cfg,title),{roster:R.agents.map(a=>({name:a.name})),staff});
    /* re-pulling keeps the picks already made; new chats are picked up to N per SA */
    const existing=new Map(chats.filter(c=>c.week===w).map(c=>[String(c.sid),c])),picks=new Set(chatPicks(list,CHAT.perSA)),per=new Map();
    list.forEach(c=>{const e=existing.get(String(c.sid));if(e&&e.picked)per.set(c.sa,(per.get(c.sa)||0)+1)});
    const docs=list.map(c=>{const e=existing.get(String(c.sid));let p;
      if(e)p=!!e.picked;else{p=picks.has(c.sid)&&(per.get(c.sa)||0)<CHAT.perSA;if(p)per.set(c.sa,(per.get(c.sa)||0)+1)}
      return [String(c.sid),chatQueueDoc(c,p)]});
    chatPullRun.step=`Saving ${docs.length} chat${docs.length===1?"":"s"}…`;renderChats();
    for(let i=0;i<docs.length;i+=8)await Promise.all(docs.slice(i,i+8).map(([sid,d])=>db.doc(chPath("chats",w,sid)).set(d).catch(e=>{throw chTag(e,"db")})));
    const np=docs.filter(d=>d[1].picked).length;
    try{await db.doc(CH_ROOT+"/"+w).set({week:w,chats:docs.length,picked:np,at:new Date().toISOString(),by:myId||null})}catch(e){}
    toast(docs.length?`Pulled ${docs.length} chat${docs.length===1?"":"s"} for ${weekLabel(w)} · ${np} picked`:`No chats for ${weekLabel(w)}`);
  }catch(e){chatNote={text:e&&e.src==="db"?chatErrMsg(e):pullErr(e,"Pull again"),err:true}}
  finally{chatPullRun=null;renderChats()}
}
async function chTogglePick(sid){const c=chatBy(sid);if(!c||!db||!chCanGrade(c))return;const v=!c.picked;c.picked=v;renderChats();renderGame();
  try{await db.doc(chPath("chats",chWk(c),c.sid)).update({picked:v})}catch(e){c.picked=!v;renderChats();toast("Couldn't change the pick.")}}

/* ---------- grade: one chat at a time, each result written as soon as it's done ---------- */
function chGradeList(kind){return chSort(chatsOfWeek().filter(c=>chCanGrade(c)&&!chatAud[c.sid]&&(kind==="all"||c.picked)))}
/* fresh: ask Claude again instead of replaying a cached answer (re-grade, change order, a chat that failed). Claude calls are never retried from code */
async function gradeOneChat(c,ctl,orderIds,fresh){
  const sid=String(c.sid),w=chWk(c),guard=()=>{if(ctl.signal.aborted)throw {code:"cancelled",src:"run"}};
  const deps={
    query:async(cfg,title)=>{guard();try{return await ldQuery(cfg,title)}catch(e){throw chTag(e,"ld")}},
    ask:async(prompt,pass,po)=>{guard();const o={signal:ctl.signal,modelTier:"default"};if(fresh||(po&&po.fresh))o.cache=false;
      try{return await sampleFn.json(prompt,o)}catch(e){throw chTag(e,"ai")}},
    policy:chatPolicyDoc||CHAT_POLICY_EMPTY,
    cal:chatCal.slice().sort((a,b)=>String(b.at||"").localeCompare(String(a.at||""))),
    lessons:chLessonsSorted().slice(0,CHAT.lessonMax||20),
    slack:ch=>chatSlack(ch,ctl),
    isStop:e=>!!e&&(e.code==="cancelled"||chatIsAccess(e)),
    step:(id,st,note)=>{if(!chatRun||chatRun.sid!==sid)return;chatRun.steps[id]={st,note:note||""};if(st==="run")chatRun.step=id;paintRun()}};
  if(Array.isArray(orderIds))deps.orderIds=orderIds;
  const k=await chatContext(clone(c),deps);
  const R=await gradeChat(k,deps);guard();
  const meta={by:myId||null};if(Array.isArray(orderIds))meta.orderIds=orderIds;
  try{await db.doc(chPath("audits",w,sid)).set(chatAuditDoc(k,R,meta));await db.doc(chPath("tx",w,sid)).set(chatTxDoc(k));
    if(c.gradeError)await db.doc(chPath("chats",w,sid)).update({gradeError:null,gradeErrorAt:null})}
  catch(e){throw chTag(e,"db")}
  chatTxCache.delete(sid);
}
async function runChatGrades(list,opts){opts=opts||{};
  if(chatRun||chatPullRun||!db||!mcp||!sampleFn||!list.length)return;
  const ctl=new AbortController(),one=opts.mode==="one",fresh=new Set(list.filter(c=>opts.fresh||chatAud[c.sid]||c.gradeError).map(c=>String(c.sid)));
  chatRun={ctl,n:list.length,i:0,sid:null,sa:"",restaurant:"",step:"",steps:{},done:0,errs:0,one};chatNote=null;chLastRun=null;renderChats();
  let stop=null;
  try{
    for(let i=0;i<list.length;i++){
      if(ctl.signal.aborted)break;
      const c=list[i];Object.assign(chatRun,{i:i+1,sid:String(c.sid),sa:c.sa,restaurant:c.restaurant,step:"",steps:{}});renderChats();
      try{await gradeOneChat(c,ctl,opts.orderIds,fresh.has(String(c.sid)));chatRun.done++}
      catch(e){
        if(ctl.signal.aborted||(e&&e.code==="cancelled"))break;
        if(chatIsAccess(e)){stop=chatErrMsg(e);break}
        chatRun.errs++;const m=capText(chatErrMsg(e),160);if(one)stop=m;
        try{await db.doc(chPath("chats",chWk(c),c.sid)).update({gradeError:m,gradeErrorAt:new Date().toISOString()})}catch(e2){}}
    }
  }finally{
    const r=chatRun;chatRun=null;chLastRun={sid:r.sid,one:r.one};
    chatNote=stop?{text:stop,err:true}:r.ctl.signal.aborted?{text:`Stopped · ${r.done} graded`}:r.one?null:{text:`Graded ${r.done} chat${r.done===1?"":"s"}`+(r.errs?` · ${r.errs} couldn't be graded`:"")};
    renderChats();renderGame()}
}
function chProgress(){const r=chatRun;if(!r)return "";const lab=(CHAT_STEPS.find(s=>s[0]===r.step)||[])[1]||"Starting";
  return [`Grading ${r.i} of ${r.n}`,r.sa,r.restaurant,lab].filter(Boolean).join(" · ")}
function chStepsHtml(S){return `<ol class="csteps">${CHAT_STEPS.map(([id,l])=>{const s=S[id]||{},st=s.st||"wait";
  return `<li class="cst ${st}"><span class="csi">${st==="run"?'<span class="spin"></span>':st==="done"?"✓":st==="error"?"✗":"·"}</span><span class="csl">${esc(l)}</span>${s.note?`<span class="hint">${esc(s.note)}</span>`:""}</li>`}).join("")}</ol>`}
function paintRun(){if(!chatRun)return;const st=$("#chatStatus");if(st)st.innerHTML=`<span class="spin"></span>${esc(chProgress())}`;
  const el=$("#chatSteps");if(el&&String(chatRun.sid)===String(chatSel))el.innerHTML=chStepsHtml(chatRun.steps)}

/* ---------- the QA ticket's data: findings, marks, priority, the compensation check. The brain computes all of it; the page only reads ---------- */
/* a chat-2 audit carries its findings; an older one gets them rebuilt here from the grade's reasons and cited facts */
const chFindCache=new WeakMap();
function chFindings(c,a){const G=a&&a.grade;if(!G||typeof G!=="object")return [];if(Array.isArray(G.findings))return G.findings;
  let F=chFindCache.get(a);if(F)return F;
  try{const fx=a.facts&&Array.isArray(a.facts.timeline)?{timeline:a.facts.timeline,claims:a.facts.claims||[],promises:a.facts.promises||[]}:null;
    F=buildFindings(Object.assign({},G,{scores:G.scores||{},reasons:G.reasons||{}}),a.analysis||{},null,{chat:Object.assign({msgs:[]},c||{}),calls:[]},fx)}catch(e){F=[]}
  chFindCache.set(a,F);return F}
const chIsNot=(M,id)=>!!(M&&M[id]&&M[id].mark==="not");
/* the ticket's priority: the highest of the findings the reviewer hasn't marked "not a mistake" */
function chTopPrio(F,M,C,S){return (F||[]).filter(f=>!chDropped(f.id,M,C,S)).map(f=>f.priority).filter(p=>p in PRIO).sort()[0]||null}
const chPrio=p=>p?`<span class="prio ${esc(String(p).toLowerCase())}">${esc(p)}</span>`:"";
function chRowPrio(c,a){const rv=chatRev[c.sid];return chTopPrio(chFindings(c,a),rv&&rv.findings,rv&&rv.contests,rv&&rv.scores)}
/* compensation check status: label, tone */
const CH_COMP_ST={right:["Right","good"],wrong:["Wrong","bad"],minor:["Rounded","ok"],not_recorded:["Not recorded","bad"],missing:["Not offered","bad"],
  not_due:["Not due","bad"],none_due:["Nothing due","good"],held:["Held for approval","tp"],unknown:["Can't check","none"]};
const CH_COMP_BAD=["wrong","minor","not_recorded","missing","not_due"],CH_COMP_OUT=["held","unknown","none_due"];
const CH_WHERE={chat:"Chat",note:"Internal note",ticket:"WIRA ticket"};
const chLessonsSorted=()=>chLessons.slice().sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")));
/* contests: the reviewer disagrees with one of Claude's marks and says why. Kept in the draft as {crit: {to, reason}}, saved with the review, and each one a lesson */
const chRub=id=>CHAT_RUBRIC.find(x=>x.id===id)||null;
const chMk=(v,max)=>v==="na"?"N/A":v==null||v===""?"–":`${chMarkL(v)}/${max}`;
const chClaudeMark=(a,id)=>((a&&a.grade&&a.grade.scores)||{})[id];
/* a finding leaves the ticket's priority and the coaching note when it is marked not a mistake, or contested to full marks or N/A */
function chDropped(id,M,C,S){if(chIsNot(M,id))return true;const r=chRub(id),x=C&&C[id],v=S&&S[id];return !!(r&&x&&(v==="na"||Number(v)>=r.max))}

/* ---------- QUEUE ---------- */
/* a graded row: the ticket's priority and whether the compensation came out right */
function chFlags(c){const a=chatAud[c.sid];if(!a||(chatRun&&chatRun.sid===String(c.sid)))return "";
  const pr=chRowPrio(c,a),k=a.check,rv=chatRev[c.sid],nc=rv&&rv.contests?Object.keys(rv.contests).length:0;let comp="";
  if(k&&k.applies){const st=CH_COMP_ST[k.status]||CH_COMP_ST.unknown,bad=CH_COMP_BAD.includes(k.status),unk=k.status==="unknown";
    comp=`<span class="compchip ${bad?"bad":unk?"none":"good"}" title="Compensation: ${esc(st[0])}">Comp ${bad?"✗":unk?"?":"✓"}</span>`}
  const con=nc?`<span class="conchip" title="${nc} mark${nc===1?"":"s"} contested">Contested ${nc}</span>`:"";
  return pr||comp||con?`<span class="cflags">${pr?chPrio(pr):"<span></span>"}${comp||"<span></span>"}${con}</span>`:""}
/* checks that apply and can be judged: held, can't check and nothing due don't count */
function chCompTally(list){const k=list.map(c=>chatAud[c.sid]&&chatAud[c.sid].check).filter(x=>x&&x.applies&&!CH_COMP_OUT.includes(x.status));
  return {right:k.filter(x=>x.status==="right").length,n:k.length}}
function chStatusPill(c){const a=chatAud[c.sid],r=chatRev[c.sid];
  if(chatRun&&chatRun.sid===String(c.sid))return `<span class="pill pk"><span class="spin"></span>Grading</span>`;
  if(r){const v=chatVerdict(r.pct);return `<span class="pill solid ${chVB(r.pct)}">Reviewed ${esc(v?v.label:"")} ${fmt(r.pct)}%</span>`}
  if(a){const v=chatVerdict(a.pct);return `<span class="pill ${chVB(a.pct)}">Graded ${esc(v?v.label:"")} ${fmt(a.pct)}%</span>`}
  if(!chCanGrade(c))return `<span class="pill none">No SA reply</span>`;
  if(c.gradeError)return `<span class="pill bad">Error</span>`;
  if(c.picked)return `<span class="pill pk">Picked</span>`;
  return ""}
function chRowHtml(c){const n=(c.msgs||[]).length,g=chCanGrade(c);
  return `<div class="crow${c.picked?" picked":""}${String(chatSel)===String(c.sid)?" sel":""}" data-open="${esc(c.sid)}">
    <span class="ctime num">${esc(when(c.at))}</span>
    <div class="cmain"><button type="button" class="clink" data-open="${esc(c.sid)}">${esc(c.restaurant||c.code||"No restaurant")}</button><div class="cfirst">${esc(chFirstLine(c))}</div>${c.gradeError&&!chatAud[c.sid]?`<div class="cerr">${esc(c.gradeError)}</div>`:""}</div>
    <div class="cmeta"><span class="itag${c.initiator==="ae"?" ae":""}">${c.initiator==="ae"?"AE":"Client"}</span><span class="num">${n} msg${n===1?"":"s"}</span><span class="num">Reply ${esc(chFrt(c.frt))}</span></div>
    <span class="cfl">${chFlags(c)}</span>
    <span class="cstat">${chStatusPill(c)}</span>
    <button type="button" class="cpick" data-pick="${esc(c.sid)}" aria-pressed="${!!c.picked}" aria-label="Pick ${esc(c.restaurant||c.sid)}"${g?"":" disabled"}>✓</button></div>`}
function renderChatQueue(){const v=$("#view-chats");if(!v)return;
  if(!v.dataset.ready){v.dataset.ready="1";v.innerHTML=`<div class="panel quest" id="chatQuest"></div>
    <div class="panel pullbar chatbar"><div class="cbinfo"><div class="h2" style="margin:0">WIRA chats</div><div class="hint cstatus" id="chatStatus" role="status"></div></div><div class="cbtns" id="chatBtns"></div></div>
    <div class="sastrip" id="chatStrip"></div><div class="sagroups" id="chatGroups"></div>`}
  const wk=chatsOfWeek(),ready=chatsReady&&chW.week===week,can=!!(db&&mcp),canAi=can&&!!sampleFn,busy=!!(chatRun||chatPullRun),pk=chGradeList("picks").length,all=chGradeList("all").length;
  const graded=wk.filter(c=>chatAud[c.sid]).length,reviewed=wk.filter(c=>chatRev[c.sid]).length,picked=wk.filter(c=>c.picked).length;
  /* a week with no pull shows the Pull button only */
  $("#chatQuest").hidden=!wk.length;
  $("#chatBtns").innerHTML=`<button type="button" class="btn${wk.length?"":" primary"}" id="chatPull"${can&&!busy&&ready?"":" disabled"}>${chatPullRun?"Pulling…":wk.length?"Pull again":"Pull chats"}</button>`+
    (wk.length?`<button type="button" class="btn${pk?" primary":""}" id="chatGradePicks"${canAi&&!busy&&pk?"":" disabled"}>Grade picks<span class="bc num">${pk||""}</span></button>
    <button type="button" class="btn" id="chatGradeAll"${canAi&&!busy&&all?"":" disabled"}>Grade all<span class="bc num">${all||""}</span></button>`:"")+
    (chatRun?`<button type="button" class="btn danger" id="chatStop">Stop</button>`:"");
  const st=$("#chatStatus");st.classList.toggle("err",!!(chatNote&&chatNote.err)&&!chatRun&&!chatPullRun);
  st.innerHTML=chatPullRun?`<span class="spin"></span>${esc(chatPullRun.step)}`:chatRun?`<span class="spin"></span>${esc(chProgress())}`:
    chatNote?esc(chatNote.text):!db?"Sign in to claude.ai to pull chats.":!mcp?"Lightdash isn't available in this view.":
    !wk.length?(ready?"Not pulled yet":"Loading…"):esc(`${wk.length} chats · ${picked} picked · ${graded} graded · ${reviewed} reviewed`+(chatPolicyDoc?"":" · No compensation policy saved"));
  const sas=chSaOrder(wk.map(c=>c.sa));
  $("#chatStrip").innerHTML=sas.map((sa,i)=>{const l=wk.filter(c=>c.sa===sa),rv=l.filter(c=>chatRev[c.sid]),av=avg(rv.map(c=>chatRev[c.sid].pct)),ct=chCompTally(l);
    return `<button type="button" class="sacard" data-sajump="${i}"><span class="satop"><b>${esc(sa)}</b><span class="saavg num t-${chVB(av)}">${av==null?"–":fmt(av)+"%"}</span></span>
      <span class="sanums">${[["chats",l.length],["picked",l.filter(c=>c.picked).length],["graded",l.filter(c=>chatAud[c.sid]).length],["reviewed",rv.length]].map(([k,n])=>`<span><b class="num">${n}</b>${k}</span>`).join("")}</span>
      ${ct.n?`<span class="sacomp t-${ct.right===ct.n?"good":"bad"}">Comp right <b class="num">${ct.right} of ${ct.n}</b></span>`:""}</button>`}).join("");
  $("#chatGroups").innerHTML=sas.length?sas.map((sa,i)=>{const l=chSort(wk.filter(c=>c.sa===sa)),picks=l.filter(c=>c.picked),done=picks.filter(c=>chatRev[c.sid]).length;
    const pips=picks.length?`<span class="pips" aria-hidden="true">${picks.map((_,j)=>`<i class="${j<done?"on":""}"></i>`).join("")}</span>`:"";
    return `<div class="panel sagroup" id="sag-${i}"><h3><span>${esc(sa)}${pips}</span><span class="num hint">${done} of ${picks.length} picks reviewed</span></h3>${l.map(chRowHtml).join("")}</div>`}).join(""):"";
}
$("#view-chats").addEventListener("click",e=>{
  const pk=e.target.closest("[data-pick]");if(pk){e.stopPropagation();chTogglePick(pk.dataset.pick);return}
  const sj=e.target.closest("[data-sajump]");if(sj){const g=$("#sag-"+sj.dataset.sajump);if(g)g.scrollIntoView({behavior:"smooth",block:"start"});return}
  const b=e.target.closest("button");
  if(b&&b.id==="chatPull"){pullChats();return}
  if(b&&b.id==="chatGradePicks"){runChatGrades(chGradeList("picks"));return}
  if(b&&b.id==="chatGradeAll"){runChatGrades(chGradeList("all"));return}
  if(b&&b.id==="chatStop"){if(chatRun)chatRun.ctl.abort();return}
  const o=e.target.closest("[data-open]");if(o&&!e.target.closest("a"))openChat(o.dataset.open)});

/* ---------- AUDIT ---------- */
/* the reviewer's working copy: starts from the saved review, else Claude's marks; resets when a new grade or review lands */
function chatDraft(sid){const a=chatAud[sid],rv=chatRev[sid],base=chHash(a),rvAt=chHash(rv);let d=chatDrafts.get(sid);
  if(!d||d.base!==base||d.rvAt!==rvAt){d={base,rvAt,scores:clone((rv&&rv.scores)||(a&&a.grade&&a.grade.scores)||{}),coach:rv&&typeof rv.coaching==="string"?rv.coaching:null,
    reviewer:(rv&&rv.reviewer)||(d&&d.reviewer)||store.get("qa.reviewer")||"",findings:clone((rv&&rv.findings&&typeof rv.findings==="object")?rv.findings:{}),
    contests:Object.fromEntries(Object.entries((rv&&rv.contests)||{}).filter(([id])=>rv.scores&&rv.scores[id]!=null).map(([id,x])=>[id,{to:rv.scores[id],reason:String((x&&x.reason)||"")}]))};
    chatDrafts.set(sid,d);if(chContest&&chContest.sid===sid)chContest=null}
  return d}
/* the coaching note: the ticket's findings (P1 first, minus any marked not a mistake) when the grade has them, else the older "next time" list */
function coachText(c,a,scores,marks,contests){const pct=chatScore(scores),v=chatVerdict(pct),G=(a&&a.grade)||{},R=G.route||{};
  const L=[`Chat ${a.sid||c.sid} · ${a.restaurant||c.restaurant||""} · ${shortDate(String(a.at||c.at||"").slice(0,10))} — ${v?v.label:"–"} (${pct==null?"–":fmt(pct)}%)`,""];
  [["facts","Facts"],["analysis","Analysis"],["solution","Solution"]].forEach(([k,l])=>{const r=R[k]||{};L.push(`${l}: ${CH_MARK[r.mark]||"–"} ${r.why||""}`.trimEnd())});
  const es=scores&&scores.esc,er=R.escalation||{};L.push(`Escalation: ${es==="na"||es==null?"N/A":"Level "+chMarkL(es)}${er.why?" · "+er.why:""}`);
  if((G.wentWell||[]).length){L.push("","What you did well");G.wentWell.forEach(x=>L.push("- "+x))}
  if(Array.isArray(G.findings)){const F=G.findings.filter(f=>f&&!chDropped(f.id,marks,contests,scores)).sort((x,y)=>(PRIO[x.priority]??9)-(PRIO[y.priority]??9));
    if(F.length){L.push("","Next time");F.forEach((f,i)=>{L.push(`${i+1}. ${f.priority?f.priority+" · ":""}${f.label||f.id}${f.type?": "+f.type:""}`);
      if(f.what)L.push(`   What happened: ${f.what}`);if(f.why)L.push(`   Why it matters: ${f.why}`);if(f.should)L.push(`   Do: ${f.should}`);if(f.model)L.push(`   Model message: "${f.model}"`)})}}
  else if((G.nextTime||[]).length){L.push("","Next time");G.nextTime.forEach((n,i)=>{L.push(`${i+1}. What happened: ${n.what||""}`);if(n.why)L.push(`   Why it matters: ${n.why}`);if(n.do)L.push(`   Do: ${n.do}`);if(n.model)L.push(`   Model message: "${n.model}"`)})}
  return L.join("\n")}
/* WIRA task text: **bold** shown bold, ==== rule lines dropped; everything else escaped */
const chMd=t=>esc(String(t||"").split("\n").filter(l=>!/^\s*[=\-_*]{6,}\s*$/.test(l)).join("\n").trim()).replace(/\*\*([^*\n]+?)\*\*/g,"<b>$1</b>");
function chCite(id){return `<a href="#" class="cite" data-jump="cf-${esc(id)}">${esc(id)}</a>`}
const chCites=ids=>(ids||[]).length?`<span class="cites">${ids.map(chCite).join("")}</span>`:"";
function chSrc(s){const m=String(s||"").match(/^M(\d+)$/);return m?`<a href="#" class="cite" data-jump="cm-${m[1]}">${esc(s)}</a>`:esc(s)}
function chNextChat(sid){const c=chatBy(sid),wk=c?c.week:week,sa=c&&c.sa;
  const l=chSort(chats.filter(x=>x.week===wk&&String(x.sid)!==String(sid)&&chCanGrade(x)&&!chatRev[x.sid]));
  return l.find(x=>x.picked&&x.sa===sa)||l.find(x=>x.picked)||l.find(x=>chatAud[x.sid])||l[0]||null}
/* workflow bots are a small system line; a role the page doesn't know is a neutral bubble labelled with the role */
const CH_SIDES=["client","sa","sa_other","ae","crt","lead","staff"];
function chBubble(m){
  if(m.role==="bot")return `<li class="sysline" id="cm-${esc(m.n)}"><span class="syswho">${esc(ROLE_L.bot||"System")}</span><span class="systext">${esc(m.text)}</span><span class="num bn">M${esc(m.n)}</span></li>`;
  const cl=m.role==="client",odd=!CH_SIDES.includes(m.role),role=ROLE_L[m.role]||m.role||"Unknown";
  return `<li class="bub${cl?" cl":""}${m.role==="sa"?" me":""}${odd?" other":""}${m.internal?" internal":""}" id="cm-${esc(m.n)}"><div class="bwho"><b>${esc(m.name||role)}</b>${cl&&m.name==="Client"||m.name===role?"":`<span>${esc(role)}</span>`}<span class="num bn">M${esc(m.n)}</span>${m.internal?`<span class="ntag">internal${m.inferred?" · inferred":""}</span>`:""}</div><div class="btext">${esc(m.text)}</div></li>`}
function chCaseHtml(A){A=A||{};if(!A.caseType&&!A.request)return "";
  return `<div class="vcase" id="cvCase">${A.caseType?`<span class="ctype">${esc(chCaseL(A.caseType))}</span>`:""}${A.request?`<span class="vreq">${esc(A.request)}</span>`:""}</div>`}
function chBoard(c,a,rv,d){
  const run=!!(chatRun&&chatRun.sid===String(c.sid)),can=!!(db&&mcp&&sampleFn)&&!chatRun&&!chatPullRun,g=chCanGrade(c),nx=chNextChat(c.sid);
  const pct=a?chatScore(d.scores):null,v=chatVerdict(pct),R=(a&&a.grade&&a.grade.route)||{};
  const note=c.gradeError&&!run?c.gradeError:(chLastRun&&chLastRun.sid===String(c.sid)&&chatNote&&chatNote.err?chatNote.text:"");
  const init=chInit(c);
  const route=a?`<div class="vroute" id="cvRoute">${[["facts","Facts"],["analysis","Analysis"],["solution","Solution"]].map(([k,l])=>{const r=R[k]||{};
      return `<span class="rm ${esc(r.mark||"")}" title="${esc(r.why||"")}"><span>${l}</span><b>${CH_MARK[r.mark]||"–"} ${esc(CH_MARK_L[r.mark]||"")}</b></span>`}).join("")}
      <span class="rm esc" title="${esc((R.escalation||{}).why||"")}"><span>Escalation</span><b id="cvEsc">${d.scores.esc==="na"||d.scores.esc==null?"N/A":"Level "+esc(chMarkL(d.scores.esc))}</b></span></div>`:"";
  return `<div class="vhead"><span class="lbl-sm">Chat ${esc(c.sid)}</span>${rv?`<span class="pill solid ${chVB(rv.pct)}">Reviewed</span>`:a?`<span class="pill none">Graded</span>`:""}</div>
    ${a?`<div class="vword v-${esc(v?v.id:"")}" id="cvWord">${esc(v?v.label:"–")}</div><div class="vpct"><span class="num" id="cvPct">${pct==null?"–":fmt(pct)+"%"}</span><span class="hint num" id="cvClaude"${pct===a.pct?" hidden":""}>Claude ${fmt(a.pct)}%</span></div>${a.grade&&a.grade.spread>=15&&Array.isArray(a.grade.runPcts)?`<div class="hint num vreads">Two reads: ${a.grade.runPcts.map(x=>fmt(x)+"%").join(" · ")}</div>`:""}`
      :`<div class="vword v-none">${g?"Not graded":"No SA reply"}</div>`}
    ${a?chCaseHtml(a.analysis):""}
    ${route}
    ${a?"":`<dl class="vmeta"><dt>SA</dt><dd>${esc(c.sa||"–")}</dd><dt>Restaurant</dt><dd>${esc(c.restaurant||"–")}${c.code?` <span class="num hint">${esc(c.code)}</span>`:""}</dd>
      <dt>WIRA</dt><dd>${safeUrl(c.url)?`<a href="${esc(safeUrl(c.url))}" target="_blank" rel="noopener">${esc(c.sid)} ↗</a>`:esc(c.sid)}</dd><dt>Opened</dt><dd class="num">${esc(when(c.at))}</dd>
      <dt>First reply</dt><dd class="num">${esc(chFrt(c.frt))}</dd><dt>Started by</dt><dd>${esc(init)}</dd></dl>`}
    ${run?`<div id="chatSteps">${chStepsHtml(chatRun.steps)}</div>`:""}
    ${note?`<div class="cvnote">${esc(note)}</div>`:""}
    <div class="row">${run?`<button type="button" class="btn danger" id="cvStop">Stop</button>`:`<button type="button" class="btn${a?"":" primary"}" id="cvGrade"${can&&g?"":" disabled"}>${a?"Re-grade":"Grade"}</button>`}
      <button type="button" class="btn" id="cvNext"${nx?"":" disabled"}>Next chat →</button></div>`}
function chOrderCard(o){const src=titleCase(String(o.source||"").replace(/_/g," "));
  return `<div class="ordcard"${o.label?` id="cx-ord-${esc(o.label)}"`:""}><div class="ordhd"><b>Ticket ${esc(o.ticket||"?")}</b>${o.type?`<span>${esc(capFirst(o.type))}</span>`:""}${src?`<span>${esc(src)}</span>`:""}<span class="num">${esc(when(o.at))}</span>${o.coupon?`<span class="ttag">Coupon ${esc(o.coupon)}</span>`:""}${o.label?`<span class="num olab">${esc(o.label)}</span>`:""}</div>
    <dl class="ordmoney">${[["Items",o.items],["Tax",o.tax],["Tip",o.tip],["Other",o.other],["Total",o.total]].map(([k,x])=>`<div${k==="Total"?' class="tot"':""}><dt>${k}</dt><dd class="num">${money(x)}</dd></div>`).join("")}</dl></div>`}
/* Change order: Claude's ranked matches with their reasons, then every order of the chat day and the day before (newest first), then No order */
const chSrcL=s=>titleCase(String(s||"").replace(/_/g," "));
const chOrdKey=o=>[o.ticket||"",Number(o.total||0).toFixed(2),Number(o.items||0).toFixed(2)].join(" ");
function chPicker(a){const cur=new Set((a.orders||[]).map(o=>o.id)),cand=a.candidates||[],cids=new Set(cand.map(x=>x.id)),day=(a.dayOrders||[]).filter(o=>!cids.has(o.id));
  const meta=o=>[capFirst(o.type||""),chSrcL(o.source)].filter(Boolean).join(" · ");
  return `<div class="opick" id="ordPick">
    ${cand.length?`<div class="ophd"><span class="lbl-sm">Best matches</span></div>${cand.map(x=>`<button type="button" class="ocand${cur.has(x.id)?" on":""}" data-oid="${esc(x.id)}"><b>Ticket ${esc(x.ticket||"?")}</b><span class="num">${money(x.total)}</span><span class="num hint">${esc(when(x.at))}</span>${meta(x)?`<span class="hint">${esc(meta(x))}</span>`:""}<span class="owhy">${esc((x.why||[]).join(", "))}</span></button>`).join("")}`:""}
    ${day.length?`<div class="ophd"><span class="lbl-sm">${cand.length?"Other orders":"Orders"}</span><span class="hint num" id="ordN">${day.length}</span></div>
      <input type="search" id="ordQ" class="oq" placeholder="Ticket or amount" aria-label="Search orders by ticket or amount" autocomplete="off" value="${esc(chOrdQ)}">
      <div class="olist" id="ordList">${day.map(o=>`<button type="button" class="orow${cur.has(o.id)?" on":""}" data-oid="${esc(o.id)}" data-q="${esc(chOrdKey(o))}"><b class="num otk">${o.ticket?"#"+esc(o.ticket):"No ticket"}</b><span class="num otime">${esc(when(o.at))}</span><span class="otype">${esc(meta(o))}</span><span class="num otot">${money(o.total)}</span></button>`).join("")}<div class="hint onone" id="ordNone" hidden>No order matches.</div></div>`:""}
    ${!cand.length&&!day.length?`<div class="hint">No orders that day.</div>`:""}
    <div class="row"><button type="button" class="btn small" data-oid="">No order</button><button type="button" class="btn small" id="ordCancel">Cancel</button></div></div>`}
/* filter the day's orders in place, so typing never re-renders the audit */
function chOrdFilter(){const L=$("#ordList");if(!L)return;const q=chOrdQ.trim().toLowerCase().replace(/^(?:#|\$|c(?=\d))\s*/,"");let n=0,t=0;
  L.querySelectorAll(".orow").forEach(r=>{t++;const on=!q||String(r.dataset.q||"").split(" ").some(k=>k.includes(q));r.hidden=!on;if(on)n++});
  const nn=$("#ordN");if(nn)nn.textContent=q?`${n} of ${t}`:String(t);const z=$("#ordNone");if(z)z.hidden=n>0}
function txText(sid,id){const m=chatTxCache.get(String(sid));if(m==null||m==="loading")return `<span class="hint">Loading…</span>`;if(m==="error")return `<span class="hint">Couldn't load the transcript.</span>`;
  const t=m.get(String(id));return t&&t.trim()?esc(t):`<span class="hint">No transcript for this call.</span>`}
/* WIRA request fields on the chat (c.fields): an object, a list of {name|label|key, value}, or the JSON string WIRA stores */
function chFieldList(f){
  if(typeof f==="string"){const t=f.trim();if(!t)return [];try{f=JSON.parse(t)}catch(e){return [["",t]]}}
  const val=v=>v==null?"":typeof v==="object"?(Array.isArray(v)?v.map(x=>typeof x==="object"?JSON.stringify(x):String(x)).join(", "):JSON.stringify(v)):String(v);
  let L=[];
  if(Array.isArray(f))L=f.map(x=>x&&typeof x==="object"&&!Array.isArray(x)&&("value" in x)?[x.label||x.name||x.key||"",x.value]:["",x]);
  else if(f&&typeof f==="object")L=Object.entries(f);
  else if(f!=null&&f!=="")L=[["",f]];
  return L.map(([k,v])=>[chLabel(k),capText(val(v).trim(),300)]).filter(([,v])=>v)}
function chFieldsHtml(c){const L=chFieldList(c&&c.fields);if(!L.length)return "";
  return `<div class="cxsec" id="cxFields"><div class="cxhd"><span class="lbl-sm">Request fields</span></div><dl class="rfields">${L.map(([k,v])=>`<dt>${esc(k||"Field")}</dt><dd>${esc(v)}</dd>`).join("")}</dl></div>`}
function chContext(c,a){const fh=chFieldsHtml(c);
  if(!a)return fh+`<div class="${fh?"cxsec ":""}tnone"><span>Not linked yet</span></div>`;
  const B=(a.facts&&a.facts.calls)||{},canPick=!!(db&&mcp&&sampleFn)&&!chatRun,out=fh?[fh]:[];
  out.push(`<div class="cxsec"><div class="cxhd"><span class="lbl-sm">Order</span>${a.orderPick==="reviewer"?`<span class="ttag">Your pick</span>`:""}${chatPickOpen===String(c.sid)?"":`<button type="button" class="btn small" id="ordChange"${canPick?"":" disabled"}>Change order</button>`}</div>
    ${(a.orders||[]).length?a.orders.map(chOrderCard).join(""):`<div class="cxnone">No order linked</div>${a.orderNote?`<div class="hint">${esc(a.orderNote)}</div>`:""}`}
    ${chatPickOpen===String(c.sid)?chPicker(a):""}</div>`);
  const calls=a.calls||[];
  out.push(`<div class="cxsec"><div class="cxhd"><span class="lbl-sm">Calls</span><span class="hint num">${calls.length}</span></div>${calls.length?`<ol class="txlist">${calls.map((l,i)=>`<li class="txcall" id="cx-call-${i+1}"><div class="txhd"><span class="num idx">${i+1}</span><b>${esc(l.agent||"Unknown")}</b><span class="hint">${l.dir==="out"?"Outbound":"Inbound"}${l.phone4?" · …"+esc(l.phone4):""}</span><span class="num hint">${esc(when(l.at))} · ${dur(l.sec)}</span>${l.orders?`<span class="ttag">${esc(l.orders)}</span>`:""}${l.id?`<a href="${esc(recUrl(l.id))}" target="_blank" rel="noopener">Rec ↗</a>`:""}</div>
      ${(B[l.id]||[]).length?`<ul class="txsum">${B[l.id].map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}
      <details class="txd" data-ctx="${esc(l.id)}"><summary>Transcript</summary><div class="txtext">${txText(c.sid,l.id)}</div></details></li>`).join("")}</ol>`:`<div class="cxnone">No call recordings linked</div>`}</div>`);
  const tasks=a.tasks||[];
  if(tasks.length)out.push(`<div class="cxsec"><div class="cxhd"><span class="lbl-sm">Tasks</span><span class="hint num">${tasks.length}</span></div><div class="cxbox">${tasks.map(t=>{const u=safeUrl(t.url)||wiraUrl(t.sid),f=[];
    f.push(["Created",`${esc(t.by?prettyWho(t.by):"Not recorded")} · ${esc(when(t.at))}`]);if(t.assigned)f.push(["Assigned",esc(t.assigned)]);if(t.desc)f.push(["Description",chMd(t.desc)]);
    if((t.comments||[]).length)f.push(["Comments",`<ul class="cmts">${t.comments.map(x=>`<li><b>${esc(prettyWho(x.who)||"Someone")}</b> ${esc(x.text)}</li>`).join("")}</ul>`]);
    return `<div class="task" id="cx-task-${esc(t.sid)}"><div class="thead"><a class="tid" href="${esc(u)}" target="_blank" rel="noopener">${esc(t.sid)} ↗</a>${t.parent?`<span class="ttag">From this chat</span>`:""}${t.intent||t.project?`<span class="tcat">${esc(t.intent||t.project)}</span>`:""}${t.status?`<span>${esc(capFirst(t.status))}</span>`:""}</div>
      <div class="ttitle">${esc(t.title||"Untitled")}</div><dl class="tfields">${f.map(([x,y])=>`<dt>${x}</dt><dd>${y}</dd>`).join("")}</dl></div>`}).join("")}</div></div>`);
  const sl=a.slack||[];
  if(sl.length)out.push(`<div class="cxsec"><div class="cxhd"><span class="lbl-sm">Slack</span><span class="hint num">${sl.length}</span></div><div class="cxbox">${sl.map(t=>`<div class="task"><div class="thead">${safeUrl(t.url)?`<a class="tid" href="${esc(safeUrl(t.url))}" target="_blank" rel="noopener">#${esc(t.channel)} ↗</a>`:`<span class="tid">#${esc(t.channel)}</span>`}<span class="num">${esc(when(t.at))}</span>${(t.replies||[]).length?`<span>· ${t.replies.length} repl${t.replies.length===1?"y":"ies"}</span>`:""}</div>
      <div class="ttitle" style="font-weight:500"><b>${esc(t.author||"Someone")}</b> ${esc(t.text)}</div>${(t.replies||[]).length?`<ul class="cmts">${t.replies.map(r=>`<li><b>${esc(r.who)}</b> ${esc(r.text)}</li>`).join("")}</ul>`:""}</div>`).join("")}</div></div>`);
  if((a.notFound||[]).length)out.push(`<div class="cxsec"><div class="cxhd"><span class="lbl-sm">Not in the data</span></div><ul class="nf">${a.notFound.map(x=>`<li>${esc(x)}</li>`).join("")}</ul></div>`);
  return out.join("")}
function chFacts(a){const F=a.facts||{},tl=F.timeline||[],cl=F.claims||[],pr=F.promises||[];
  return `<details class="tlfold" id="cfTimeline"${chTimelineOpen?" open":""}><summary><span class="lbl-sm">Timeline</span><span class="hint num">${tl.length} facts${tl.some(t=>t.kind==="internal")?` · ${tl.filter(t=>t.kind==="internal").length} internal`:""}</span></summary>
    <ol class="flist cfacts">${tl.map(t=>`<li id="cf-${esc(t.id)}" class="fact ${esc(t.kind)}"><span class="fid num">${esc(t.id)}</span><span class="fwhen num">${esc(t.when)}</span><span class="fsrc">${chSrc(t.src)}</span><span class="fwhat"><b>${esc(t.who)}</b>${t.kind==="internal"?` <span class="ntag">internal</span>`:""} ${esc(t.what)}</span></li>`).join("")}</ol></details>
    <div class="fhd"><span class="lbl-sm">SA claims</span><span class="hint num">${cl.filter(x=>x.check==="supported").length} supported · ${cl.filter(x=>x.check==="contradicted").length} contradicted · ${cl.filter(x=>x.check==="cant_check").length} can't check</span></div>
    <ol class="claims">${cl.length?cl.map(x=>{const k=CH_CHECK[x.check]||CH_CHECK.cant_check;return `<li id="cf-${esc(x.id)}" class="claim ${esc(x.check)}"><span class="ck" title="${k[1]}" aria-label="${k[1]}">${k[0]}</span><span class="fid num">${esc(x.id)}</span><div class="cw"><div>${esc(x.claim)} <span class="hint">· ${chSrc(x.src)}</span></div>${x.evidence?`<div class="ev">${esc(x.evidence)}</div>`:""}</div></li>`}).join(""):`<li class="claim none">No factual claims.</li>`}</ol>
    <div class="fhd"><span class="lbl-sm">Promises</span><span class="hint num">${pr.length}</span></div>
    <ol class="flist">${pr.length?pr.map(p=>`<li id="cf-${esc(p.id)}" class="promise"><span class="fid num">${esc(p.id)}</span><span class="fwhat"><b>${esc(p.who)}</b> → ${esc(p.to)}: ${esc(p.what)}</span><span class="hint">${chSrc(p.src)}</span></li>`).join(""):`<li class="promise none">No promises.</li>`}</ol>`}
const chLabel=k=>{const t=String(k||"").replace(/([a-z0-9])([A-Z])/g,"$1 $2").replace(/[._-]+/g," ").trim().toLowerCase();return t?t[0].toUpperCase()+t.slice(1):""};
const CH_KNOWN=["caseType","request","summary","fault","bucket","affectedOrder","selfDelivery","deliveryFee","ideal","saOffer","saPath","aeInvolvement","firstResponse"];
function chAny(v){if(v==null||v==="")return "–";if(typeof v==="boolean")return v?"Yes":"No";if(typeof v!=="object")return esc(v);
  if(Array.isArray(v))return v.length?`<ul class="alist">${v.map(x=>`<li>${chAny(x)}</li>`).join("")}</ul>`:"–";
  return Object.entries(v).filter(([k])=>k!=="cites").map(([k,x])=>`<div><span class="lbl-sm">${esc(chLabel(k))}</span> ${chAny(x)}</div>`).join("")+(Array.isArray(v.cites)?chCites(v.cites):"")}
function chAnalysis(c,a){const A=a.analysis||{},comp=a.comp||{},off=a.offer||{},P=(chatPolicyDoc&&chatPolicyDoc.comp)||{},rows=[],sa=chFirst(a.sa||c.sa)||"The SA";
  const f=A.fault||{},b=A.bucket||{},id=A.ideal||{},es=id.escalation||{},sp=A.saPath||{},ae=A.aeInvolvement||{},fr=A.firstResponse||{};
  /* the case type and the request lead; only a compensation case (or an older audit with no type) shows the policy and the money */
  const nonComp=!!A.caseType&&A.caseType!=="compensation";
  if(A.caseType)rows.push(["Case type",`<b>${esc(chCaseL(A.caseType))}</b>`]);
  if(A.request)rows.push(["Request",esc(A.request)]);
  if(A.summary)rows.push(["Summary",esc(A.summary)]);
  if(A.fault)rows.push(["Fault",`<span class="pill ${f.who==="tarro"||f.who==="shared_tarro"?"bad":f.who==="unclear"||f.who==="none"?"none":"ok"}">${esc(CH_FAULT[f.who]||f.who||"–")}</span> ${esc(f.why||"")}${chCites(f.cites)}`]);
  if(nonComp)rows.push(["Compensation","Not a compensation case","line"]);
  if(!nonComp&&A.bucket)rows.push(["Policy",`<b>${esc(comp.label||((P.buckets||[]).find(x=>x.id===b.id)||{}).label||b.id||"No bucket")}</b> ${esc(b.why||"")}${chCites(b.cites)}`]);
  const ck=a.check&&a.check.applies?a.check:null;
  if(!nonComp&&ck){const due=ck.due||{},g=ck.given||{},gl=g.amount!=null?`${sa} gave ${money(g.amount)}${ck.computed?": "+ck.computed:""}`:g.given?`${sa} gave an amount recorded nowhere`:`${sa} gave nothing`;
    rows.push(["Compensation",`<div class="cline right">Due: ${esc(due.formula||"–")}</div><div class="cline ${ck.status==="right"?"right":g.amount==null&&!CH_COMP_BAD.includes(ck.status)?"none":"off"}">${esc(gl)}</div>${(A.saOffer||{}).text?`<div class="hint">${esc(A.saOffer.text)}${chCites(A.saOffer.cites)}</div>`:""}<a href="#" class="cite" data-jump="tkComp">Compensation check</a>`])}
  else if(!nonComp&&(a.comp||a.offer)){const offLine=off.amount==null?`${sa} offered no amount`:`${sa} offered ${money(off.amount)}${off.note?": "+chLower(off.note):""}`;
    const appr=comp.needsApproval?`<div class="cline appr">Needs ${esc(P.approver?chFirst(P.approver)+"'s":"a lead's")} approval</div>`:"";
    rows.push(["Compensation",`<div class="cline right">Right: ${esc(comp.formula||"–")}</div><div class="cline ${off.match==="right"?"right":off.amount==null?"none":"off"}">${esc(offLine)}</div>${appr}${(A.saOffer||{}).text?`<div class="hint">${esc(A.saOffer.text)}${chCites(A.saOffer.cites)}</div>`:""}`])}
  if(A.saPath)rows.push(["SA's path",`<span class="pill ${sp.match==="yes"?"good":sp.match==="no"?"bad":"ok"}">${esc(CH_PATH[sp.match]||sp.match||"–")}</span> ${esc(sp.why||"")}`]);
  if(A.aeInvolvement)rows.push(["AE/CSM",`<b>${esc(CH_AE[ae.kind]||ae.kind||"None")}</b>${ae.kind&&ae.kind!=="none"?` · ${ae.saCouldPrevent?"SA could have prevented it":"SA couldn't have prevented it"}`:""}${ae.why?`<div class="hint">${esc(ae.why)}</div>`:""}`]);
  if(A.firstResponse)rows.push(["First response",`<b>${fr.concludedBeforeEvidence?"Concluded before checking the evidence":"Checked before concluding"}</b>${fr.why?` ${esc(fr.why)}`:""}${chCites(fr.cites)}`]);
  if(A.ideal)rows.push(["Ideal resolution",`${esc(id.client||"–")}${id.customer?`<div><span class="lbl-sm">Customer</span> ${esc(id.customer)}</div>`:""}`]);
  if(A.ideal)rows.push(["Escalation",`<b>${es.needed?"Needed":"Not needed"}</b>${es.to?` · ${esc(es.to)}`:""}${es.why?` ${esc(es.why)}`:""}`]);
  Object.keys(A).filter(k=>!CH_KNOWN.includes(k)).forEach(k=>rows.push([chLabel(k),chAny(A[k])]));
  return `<dl class="adl">${rows.map(([k,v,line])=>line?`<dt class="sr-only">${esc(k)}</dt><dd class="aline">${esc(v)}</dd>`:`<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`}
function chScorecard(a,d){const G=a.grade||{},cl=G.scores||{},rs=G.reasons||{},runs=Array.isArray(G.runs)&&G.runs.length>1?G.runs:null,C=d.contests||{},B=chContest&&chContest.sid===String(chatSel)?chContest:null;
  return CHAT_RUBRIC.map(r=>{const cur=d.scores[r.id],orig=cl[r.id],half=typeof cur==="number"&&cur%1!==0,con=C[r.id],box=!!(B&&B.crit===r.id&&B.where==="row");
    const reads=runs&&String(runs[0][r.id])!==String(runs[1][r.id])?`<span class="reads num">Reads ${chMarkL(runs[0][r.id])} · ${chMarkL(runs[1][r.id])}</span>`:"";
    const opts=[...Array(r.max+1).keys()].map(v=>`<button type="button" class="cm ${chMarkCls(v,r.max)}${half&&(v===Math.floor(cur)||v===Math.ceil(cur))?" half":""}" data-cm="${r.id}" data-v="${v}" aria-pressed="${String(cur)===String(v)}">${v}</button>`).join("")+
      (r.na?`<button type="button" class="cm na" data-cm="${r.id}" data-v="na" aria-pressed="${cur==="na"}">N/A</button>`:"");
    const mark=con?`<span class="ccon">Contested</span><span class="cfrom num"><s>${esc(chMk(orig,r.max))}</s> <b class="${chMarkCls(cur,r.max)}">${esc(chMk(cur,r.max))}</b></span>`
      :`<span class="was" id="was-${r.id}"${String(cur)===String(orig)?" hidden":""}>Claude ${esc(chMarkL(orig))}</span>`;
    return `<div class="ccrit${con?" contested":""}" id="cc-${r.id}"><div class="cchead"><span class="ttl" title="${esc(r.d||"")}">${esc(r.label)}</span><span class="wt num">${r.w}%</span>${mark}${reads}</div>
      <div class="cmarks" role="group" aria-label="${esc(r.label)}">${opts}<button type="button" class="btn small cbtn" data-contest="${r.id}" data-where="row" aria-expanded="${box}">Contest</button></div>${rs[r.id]?`<div class="creason">${esc(rs[r.id])}</div>`:""}
      ${con&&!box?`<div class="cyour"><span class="lbl-sm">Why</span> ${esc(con.reason)}</div>`:""}${box?chContestBox(a,d,r):""}</div>`}).join("")}
/* the contest box: Claude's mark and reason, your mark, why (required) */
function chContestBox(a,d,r){const B=chContest,orig=chClaudeMark(a,r.id),why=((a.grade||{}).reasons||{})[r.id]||"",ex=(d.contests||{})[r.id];
  const opts=[...Array(r.max+1).keys()].map(v=>`<button type="button" class="cm ${chMarkCls(v,r.max)}" data-cv="${v}" aria-pressed="${String(B.to)===String(v)}">${v}</button>`).join("")+
    (r.na?`<button type="button" class="cm na" data-cv="na" aria-pressed="${B.to==="na"}">N/A</button>`:"");
  return `<div class="cbox" id="cbox" role="group" aria-label="Contest ${esc(r.label)}">
    <div class="cbl"><span class="lbl-sm">Claude</span><div class="cbv"><b class="num cbclaude ${chMarkCls(orig,r.max)}">${esc(chMk(orig,r.max))}</b>${why?`<p class="cbwhy">${esc(why)}</p>`:""}</div></div>
    <div class="cbl"><span class="lbl-sm">Your mark</span><div class="cbv cbmarks" role="group" aria-label="Your mark">${opts}</div></div>
    <div class="field cbfield"><label for="cbWhy">Why</label><textarea id="cbWhy" rows="3">${esc(B.reason||"")}</textarea></div>
    <div class="row"><button type="button" class="btn primary" id="cbSave"${chContestOk()?"":" disabled"}>Save contest</button><button type="button" class="btn" id="cbCancel">Cancel</button>${ex?`<button type="button" class="btn danger" id="cbWithdraw">Withdraw</button>`:""}</div></div>`}
function chContestOk(){const B=chContest;if(!B)return false;return B.to!=null&&String(B.to)!==String(chClaudeMark(chatAud[B.sid],B.crit))&&!!String(B.reason||"").trim()}
function chOpenContest(crit,where,to){const sid=String(chatSel||""),a=chatAud[sid],r=chRub(crit);if(!a||!r)return;
  const d=chatDraft(sid),ex=(d.contests||{})[crit];
  if(to===undefined&&chContest&&chContest.sid===sid&&chContest.crit===crit&&chContest.where===where){chContest=null;paintMarks();return}
  chContest={sid,crit,where,to:to!==undefined?to:ex?ex.to:null,reason:ex?ex.reason:(chContest&&chContest.sid===sid&&chContest.crit===crit?chContest.reason:"")};paintMarks();
  const el=$("#cbox");if(el){el.scrollIntoView({block:"nearest"});const f=chContest.to!=null?$("#cbWhy"):el.querySelector("[data-cv]");if(f)f.focus({preventScroll:true})}}
function chSaveContest(){if(!chContestOk())return;const B=chContest,d=chatDraft(B.sid);
  (d.contests||(d.contests={}))[B.crit]={to:B.to,reason:String(B.reason).trim()};d.scores[B.crit]=B.to;
  if(d.findings&&d.findings[B.crit])delete d.findings[B.crit];
  chContest=null;paintMarks();const b=$(`[data-contest="${B.crit}"][data-where="${B.where}"]`);if(b)b.focus({preventScroll:true})}
/* back to Claude's mark: the contest (and a Not a mistake on that criterion) goes */
function chWithdraw(crit){const sid=String(chatSel||""),a=chatAud[sid];if(!a)return;const d=chatDraft(sid);
  if(d.contests)delete d.contests[crit];if(chIsNot(d.findings,crit))delete d.findings[crit];
  const o=chClaudeMark(a,crit);if(o!==undefined)d.scores[crit]=o;if(chContest&&chContest.crit===crit)chContest=null;paintMarks()}
function chCoach(c,a,rv,d){const gen=coachText(c,a,d.scores,d.findings,d.contests),txt=d.coach!=null?d.coach:gen,calEx=chatCal.some(x=>String(x.sid)===String(c.sid));
  const xp=chatXpFor({sid:c.sid})-(rv?chatXpFor(rv):0);
  return `<div class="field"><label for="coachText" class="sr-only">Coaching note</label><textarea id="coachText" class="coach" rows="16">${esc(txt)}</textarea></div>
    <div class="row"><button type="button" class="btn small" id="coachCopy">Copy</button><button type="button" class="btn small" id="coachRebuild"${d.coach!=null&&d.coach!==gen?"":" hidden"}>Rebuild</button></div>
    <div class="savebar"><div class="field"><label for="chatReviewer">Reviewer</label><input id="chatReviewer" autocomplete="name" value="${esc(d.reviewer)}"></div>
      <div class="row"><button type="button" class="btn primary" id="chatSave"${db?"":" disabled"}>Save review</button><span class="hint num" id="chatXp">+${Math.max(0,xp)} XP</span>
      <button type="button" class="btn" id="calOpen"${db?"":" disabled"}>${calEx?"Edit calibration case":"Save as calibration case"}</button></div></div>
    ${calForm&&calForm.sid===String(c.sid)?`<div class="calform" id="calForm"><span class="lbl-sm">Your verdict</span><div class="chips" id="calVerdict">${VERDICTS.map(([id,,l])=>`<button type="button" class="chip" data-calv="${id}" aria-pressed="${calForm.verdict===id}">${esc(l)}</button>`).join("")}</div>
      <div class="field"><label for="calLessons">Lessons</label><textarea id="calLessons" rows="4" placeholder="One per line">${esc(calForm.lessons)}</textarea></div>
      <div class="row"><button type="button" class="btn primary" id="calSave"${calForm.verdict?"":" disabled"}>Save calibration case</button><button type="button" class="btn" id="calCancel">Cancel</button></div></div>`:""}`}
/* ---------- the QA ticket: top of the audit. Fields, what happened, the compensation check, then one card per finding (P1 first) ---------- */
const chInit=c=>c.initiator==="ae"?"AE"+(c.createdBy?" · "+c.createdBy:""):c.initiator==="client"?"Client":(c.createdBy||"–");
const chFaultCls=w=>w==="tarro"||w==="shared_tarro"?"bad":w==="unclear"||w==="none"?"none":"ok";
const chStatusL=c=>capFirst(String(c.status||"").replace(/_/g," "))+(c.sub?", "+String(c.sub).replace(/_/g," "):"");
const chGdOrder=(code,id)=>`${GD}/restaurant/${encodeURIComponent(code||"")}?orderId=${encodeURIComponent(id||"")}`;
const chNoEq=s=>String(s||"").replace(/\s*=\s*-?\$[\d,]+(?:\.\d+)?\s*$/,"");
/* the SA's formula with the wrong parts marked: a component that shouldn't be in the base is struck, a wrong % is marked */
function chStrike(s,codes){let h=esc(s);
  ["tax","tip","fees"].forEach(x=>{if(codes.includes(x))h=h.replace(new RegExp("\\+ "+x+" (\\$[\\d,]+\\.\\d{2})"),`<del>+ ${x} $1</del>`)});
  if(codes.includes("pct"))h=h.replace(/^(\d+(?:\.\d+)?%)/,"<mark>$1</mark>");
  return h}
function chTkFields(c,a){const A=a.analysis||{},f=A.fault||{},code=a.code||c.code||"",url=safeUrl(c.url||a.url)||wiraUrl(c.sid),recs=(a.calls||[]).filter(l=>l.id);
  const link=(u,t,title)=>`<a href="${esc(u)}" target="_blank" rel="noopener" class="tklink"${title?` title="${esc(title)}"`:""}>${t} ↗</a>`;
  const F=[["Restaurant",`${esc(c.restaurant||a.restaurant||"–")}${code?` <span class="num tkcode">${esc(code)}</span>`:""}`],
    ["SA",esc(a.sa||c.sa||"–")],
    ["Chat",link(url,"WIRA "+esc(c.sid))],
    ["Order",(a.orders||[]).length?a.orders.map(o=>`<span class="tkord">${link(chGdOrder(code,o.id),"Ticket "+esc(o.ticket||"?"))}<span class="num tkmut">${money(o.total)}</span></span>`).join(""):`<span class="tkmut">No order linked</span>`],
    ["Case type",A.caseType?`<span class="ctype">${esc(chCaseL(A.caseType))}</span>`:`<span class="tkmut">–</span>`],
    ["Fault",A.fault?`<span class="pill ${chFaultCls(f.who)}">${esc(CH_FAULT[f.who]||f.who||"–")}</span>`:`<span class="tkmut">–</span>`],
    ["Opened",`<span class="num">${esc(when(c.at)||"–")}</span>`],
    ["First reply",`<span class="num">${esc(chFrt(c.frt))}</span>`],
    ["Closed",c.closedAt?`<span class="num">${esc(when(c.closedAt))}</span>`:`<span class="tkmut">Not closed${c.status?" · "+esc(chStatusL(c)):""}</span>`],
    ["Started by",esc(chInit(c))],
    ["Recordings",recs.length?`<span class="tkrecs">${recs.map((l,i)=>link(recUrl(l.id),"Rec"+(recs.length>1?" "+(i+1):""),[l.agent,when(l.at)].filter(Boolean).join(" · "))).join("")}</span>`:`<span class="tkmut">None linked</span>`]];
  return `<dl class="tkgrid">${F.map(([k,v])=>`<div class="tkf"><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl>`}
function chCompHtml(c,a){const k=a.check;if(!k||!k.applies)return "";
  const due=k.due||{},g=k.given||{},st=CH_COMP_ST[k.status]||CH_COMP_ST.unknown,sa=chFirst(a.sa||c.sa)||"The SA",errs=k.errors||[],flags=k.flags||[],codes=errs.map(e=>e.code);
  const P=(chatPolicyDoc&&chatPolicyDoc.comp)||{},lim=due.limit!=null?due.limit:P.approvalLimit,ap=(a.analysis&&a.analysis.approval)||{},bad=CH_COMP_BAD.includes(k.status);
  const due1=`<div class="rl"><span class="rk">Due</span><span class="rv">${due.label?`<b>${esc(due.label)}</b>`:""}${due.formula?`<span class="rf num">${esc(due.amount!=null?chNoEq(due.formula):due.formula)}</span>`:""}</span><span class="ra num">${due.amount!=null?money(due.amount):"–"}</span></div>`;
  const appr=due.needsApproval?`<div class="rappr${ap.approved?" ok":""}">Above the ${money(lim)} limit · ${ap.approved?`approved${ap.by?" by "+esc(ap.by):""}`:`needs ${esc(P.approver||"the lead")}'s approval${ap.asked?" · asked":""}`}</div>`:"";
  const amt=g.amount!=null?money(g.amount):g.given?"Not recorded":"Nothing";
  const gave=`<div class="rl"><span class="rk">${esc(sa)} gave</span><span class="rv">${CH_WHERE[g.where]?`<span class="rwhere">${CH_WHERE[g.where]}</span>`:""}${k.computed?`<span class="rf num">${chStrike(chNoEq(k.computed),codes)}</span>`:""}</span><span class="ra num ${bad?"t-bad":k.status==="right"?"t-good":""}">${esc(amt)}</span></div>`;
  const diff=k.diff!=null&&Math.abs(k.diff)>=0.005?`<div class="rl rdiff"><span class="rk">${k.diff>0?"Over by":"Under by"}</span><span class="rv"></span><span class="ra num">${money(Math.abs(k.diff))}</span></div>`
    :k.status==="right"?`<div class="rl rdiff ok"><span class="rk">Exact to the cent</span><span class="rv"></span><span class="ra">✓</span></div>`:"";
  const sum=!errs.length&&!diff&&k.summary?`<p class="rsum">${esc(k.summary)}</p>`:"";
  return `<section class="tksec tkcomp c-${st[1]}" id="tkComp"><div class="tkch"><h3 class="tkh">Compensation check</h3><span class="tkst c-${st[1]}">${esc(st[0])}</span></div>
    <div class="rcpt">${due1}${appr}${gave}${diff}</div>${sum}
    ${errs.length?`<ul class="rerr">${errs.map(e=>`<li><b>${esc(e.label||COMP_ERR[e.code]||e.code)}</b> ${esc(e.detail||"")}</li>`).join("")}</ul>`:""}
    ${flags.length?`<ul class="rerr rflag">${flags.map(e=>`<li><b>${esc(e.label||COMP_ERR[e.code]||e.code)}</b> ${esc(e.detail||"")}</li>`).join("")}</ul>`:""}</section>`}
/* a source chip: M# scrolls to the message, Call # to the call card, O# to the order, Task to the task */
function chSrcChip(s){const t=String(s||"").trim();let m;
  if((m=/^M(\d+)$/i.exec(t)))return `<a href="#" class="srcchip" data-jump="cm-${m[1]}">M${m[1]}</a>`;
  if((m=/^Call\s*(\d+)$/i.exec(t)))return `<a href="#" class="srcchip" data-jump="cx-call-${m[1]}">Call ${m[1]}</a>`;
  if((m=/^O(\d+)$/i.exec(t)))return `<a href="#" class="srcchip" data-jump="cx-ord-O${m[1]}">O${m[1]}</a>`;
  if((m=/^Task\s*#?(\d+)$/i.exec(t)))return `<a href="#" class="srcchip" data-jump="cx-task-${m[1]}">Task ${m[1]}</a>`;
  return t?`<span class="srcchip">${esc(t)}</span>`:""}
function chEvHtml(e){const mark=e.swapped?`<span class="qflag">showing the message</span>`:e.ok===true?`<span class="qok" title="Found in the source" aria-label="Found in the source">✓</span>`:e.ok===false?`<span class="qflag bad">not found in source</span>`:"";
  return `<li class="tkq${e.fact?" fact":""}"><span class="tkqs">${chSrcChip(e.src)}${e.fact?chCite(e.fact):""}</span>${e.fact?`<span class="tkqt">${esc(e.quote)}</span>`:`<q class="tkqt">${esc(e.quote)}</q>`}${mark}</li>`}
function chFindHtml(c,a,d,f){const M=d.findings||{},st=M[f.id]||{},not=st.mark==="not",agree=st.mark==="agree",r=CHAT_RUBRIC.find(x=>x.id===f.id),first=chFirst(a.sa||c.sa)||"the SA";
  const sys=f.id==="amt"&&!!a.grade&&a.grade.amtBy==="system",fid=esc(f.id),mk=String(c.sid)+"/"+f.id,con=r&&(d.contests||{})[f.id],B=chContest&&chContest.sid===String(c.sid)?chContest:null,box=!!(r&&B&&B.crit===f.id&&B.where==="find");
  let sc="";if(r){const cur=d.scores[f.id],lab=v=>v==="na"?"N/A":`${chMarkL(v)}/${r.max}`;
    sc=(String(cur)!==String(f.score)?`<s class="num">${lab(f.score)}</s>`:"")+`<b class="num tkscore ${chMarkCls(cur,r.max)}">${lab(cur)}</b>`}
  const ev=(f.evidence||[]).filter(e=>e&&e.quote).map(chEvHtml);
  return `<article class="tkfind ${esc(String(f.priority||"").toLowerCase())}${not?" not":""}" id="tf-${fid}" data-fid="${fid}">
    <div class="tkfh">${chPrio(f.priority)}<h4 class="tkft"><b>${esc(f.label||f.id)}</b>${f.type?`<span class="tktype"> · ${esc(f.type)}</span>`:""}</h4>
      <span class="tkfs">${sc}${sys?`<span class="tksys">set by the comp check</span>`:""}${not?`<span class="tknot">Not a mistake</span>`:""}${con?`<span class="tkcon">Contested</span>`:""}</span></div>
    <div class="tkfb"><div class="tkcol">${f.what?`<div class="tkblk"><h5>What happened</h5><p>${esc(f.what)}</p></div>`:""}${ev.length?`<div class="tkblk"><h5>Evidence</h5><ul class="tkev">${ev.join("")}</ul></div>`:""}</div>
      <div class="tkcol">${f.why?`<div class="tkblk"><h5>Why it matters</h5><p>${esc(f.why)}</p></div>`:""}${f.should?`<div class="tkblk tkfix"><h5>What ${esc(first)} should have done</h5><p>${esc(f.should)}</p></div>`:""}
        ${f.model?`<details class="tkmodel" data-model="${esc(mk)}"${chModelOpen.has(mk)?" open":""}><summary>Model message</summary><div class="tkmsg">${esc(f.model)}</div><button type="button" class="btn small" data-mcopy="${fid}">Copy</button></details>`:""}</div></div>
    <div class="tkact" role="group" aria-label="${esc(f.label||f.id)}"><button type="button" class="chip tkb" data-fmark="agree" data-fid="${fid}" aria-pressed="${agree}">Agree</button><button type="button" class="chip tkb tkbnot" data-fmark="not" data-fid="${fid}" aria-pressed="${not}">Not a mistake</button>${r?`<button type="button" class="chip tkb tkbcon" data-contest="${fid}" data-where="find" aria-expanded="${box}">Contest</button>`:""}</div>
    ${con&&!box?`<div class="tkyour"><span class="lbl-sm">Why</span> ${esc(con.reason)}</div>`:""}${box?`<div class="tkcbox">${chContestBox(a,d,r)}</div>`:""}
    ${not?`<div class="field tknote"><label for="tkn-${fid}">Why it wasn't a mistake</label><textarea id="tkn-${fid}" data-fnote="${fid}" rows="2">${esc(st.note||"")}</textarea></div>`:""}</article>`}
function chTicketCls(c,a,d){const p=chTopPrio(chFindings(c,a),d.findings,d.contests,d.scores);return "panel qticket"+(p?" "+p.toLowerCase():"")}
function chTicket(c,a,d){const A=a.analysis||{},F=chFindings(c,a),pct=chatScore(d.scores),v=chatVerdict(pct),pr=chTopPrio(F,d.findings,d.contests,d.scores);
  return `<header class="tkhd"><div class="tkttl"><span class="tkkind">QA ticket</span><span class="tkid">Chat <span class="num">${esc(c.sid)}</span></span></div>
      <div class="tkverd"><span class="tkword v-${esc(v?v.id:"")}" id="tkWord">${esc(v?v.label:"–")}</span><span class="tkpct num" id="tkPct">${pct==null?"–":fmt(pct)+"%"}</span><span id="tkPrio" class="tkprio">${chPrio(pr)}</span></div></header>
    <div class="tkbody">${chTkFields(c,a)}
      ${A.summary?`<section class="tksec"><h3 class="tkh">What happened</h3><p class="tkp">${esc(A.summary)}</p></section>`:""}
      ${chCompHtml(c,a)}
      <section class="tksec" id="tkFinds"><div class="tkch"><h3 class="tkh">Findings</h3><span class="tkn num">${F.length}</span></div>${F.length?`<div class="tkfinds">${F.map(f=>chFindHtml(c,a,d,f)).join("")}</div>`:`<p class="tkp tkmut">No findings.</p>`}</section></div>
    <footer class="tkfoot"><p>Filed by Swift Coach. Disagree with a mark? Contest it. Every contest teaches the coach.</p><button type="button" class="btn small" id="tkCopy">Copy ticket</button></footer>`}
/* live: a finding mark or a scorecard mark repaints the ticket in place (focus and open model messages kept) */
/* a focused control's selector, so a repaint can put focus back */
function chFocusSel(root){const f=document.activeElement;if(!f||!root||!root.contains(f))return "";const D=f.dataset||{};
  if(D.fmark)return `[data-fmark="${D.fmark}"][data-fid="${D.fid}"]`;if(D.fnote)return `[data-fnote="${D.fnote}"]`;
  if(D.contest)return `[data-contest="${D.contest}"][data-where="${D.where}"]`;if(D.cm)return `[data-cm="${D.cm}"][data-v="${D.v}"]`;if(D.cv)return `[data-cv="${D.cv}"]`;
  return f.id?"#"+f.id:""}
function chRefocus(root,key){if(!key)return;const g=root.querySelector(key);if(g)g.focus({preventScroll:true})}
function paintTicket(){const el=$("#cTicket"),sid=String(chatSel||""),c=chatBy(sid),a=chatAud[sid];if(!el||!c||!a)return;
  const key=chFocusSel(el),d=chatDraft(sid);el.className=chTicketCls(c,a,d);el.innerHTML=chTicket(c,a,d);chRefocus(el,key)}
/* Agree just marks it. Not a mistake gives the criterion full marks (put back on un-marking) and takes the finding off the ticket's priority and the coaching */
function chMarkFinding(fid,mark){const sid=String(chatSel||""),c=chatBy(sid),a=chatAud[sid];if(!c||!a)return;
  const f=chFindings(c,a).find(x=>x.id===fid);if(!f)return;
  const d=chatDraft(sid),M=d.findings||(d.findings={}),st=M[fid]||{},r=CHAT_RUBRIC.find(x=>x.id===fid);
  const C=d.contests||(d.contests={});
  if(st.mark==="not"&&r){d.scores[fid]=st.prev!==undefined?st.prev:f.score;if(st.prevC)C[fid]=st.prevC}
  if(st.mark===mark)delete M[fid];
  else{const n={mark,note:mark==="not"?String(st.note||""):""};
    /* Not a mistake is a shortcut contest to full marks: it stands in for any contest on that criterion (put back on un-marking). Agree withdraws one */
    if(mark==="not"&&r){n.prev=d.scores[fid];if(C[fid]){n.prevC=C[fid];delete C[fid]}d.scores[fid]=r.max}
    if(mark==="agree"&&r&&C[fid]){delete C[fid];const o=chClaudeMark(a,fid);if(o!==undefined)d.scores[fid]=o}
    M[fid]=n}
  if(chContest&&chContest.crit===fid)chContest=null;
  paintMarks()}
function chTicketText(c,a,d){const A=a.analysis||{},F=chFindings(c,a),M=d.findings||{},pct=chatScore(d.scores),v=chatVerdict(pct),pr=chTopPrio(F,M),code=a.code||c.code||"",first=chFirst(a.sa||c.sa)||"The SA";
  const L=[`QA ticket · Chat ${c.sid} · ${v?v.label:"–"} ${pct==null?"–":fmt(pct)+"%"}${pr?" · "+pr:""}`,""];
  [["Restaurant",`${c.restaurant||a.restaurant||"–"}${code?` (${code})`:""}`],["SA",a.sa||c.sa||"–"],["Chat",safeUrl(c.url||a.url)||wiraUrl(c.sid)],
   ["Order",(a.orders||[]).map(o=>`Ticket ${o.ticket||"?"} (${money(o.total)}) ${chGdOrder(code,o.id)}`).join("; ")||"No order linked"],
   ["Case type",A.caseType?chCaseL(A.caseType):"–"],["Fault",A.fault?(CH_FAULT[A.fault.who]||A.fault.who||"–"):"–"],["Opened",when(c.at)||"–"],["First reply",chFrt(c.frt)],
   ["Closed",c.closedAt?when(c.closedAt):"Not closed"+(c.status?` (${chStatusL(c)})`:"")],["Started by",chInit(c)],["Recordings",(a.calls||[]).filter(l=>l.id).map(l=>recUrl(l.id)).join(" ")||"None linked"]].forEach(([k,x])=>L.push(`${k}: ${x}`));
  if(A.summary)L.push("","What happened",A.summary);
  const k=a.check;
  if(k&&k.applies){const due=k.due||{},g=k.given||{},st=CH_COMP_ST[k.status]||CH_COMP_ST.unknown;
    L.push("",`Compensation check: ${st[0]}`,`Due: ${[due.label,due.formula].filter(Boolean).join(": ")||"–"}`);
    if(due.needsApproval)L.push(`Above the ${money(due.limit)} limit: needs ${(chatPolicyDoc&&chatPolicyDoc.comp&&chatPolicyDoc.comp.approver)||"the lead"}'s approval`);
    L.push(`${first} gave: ${g.amount!=null?money(g.amount):g.given?"amount not recorded":"nothing"}${CH_WHERE[g.where]?` (${CH_WHERE[g.where].toLowerCase()})`:""}${k.computed?": "+k.computed:""}`);
    if(k.diff!=null&&Math.abs(k.diff)>=0.005)L.push(`${k.diff>0?"Over":"Under"} by ${money(Math.abs(k.diff))}`);
    (k.errors||[]).concat(k.flags||[]).forEach(e=>L.push(`- ${e.label||e.code}: ${e.detail||""}`));
    if(!(k.errors||[]).length&&k.summary&&k.status!=="right")L.push(k.summary)}
  L.push("","Findings");if(!F.length)L.push("None.");
  F.forEach((f,i)=>{const st=M[f.id]||{},r=CHAT_RUBRIC.find(x=>x.id===f.id),cur=r?d.scores[f.id]:null,con=r&&(d.contests||{})[f.id];
    L.push(`${i+1}. ${f.priority?f.priority+" · ":""}${f.label||f.id}${f.type?" · "+f.type:""}${r?` · ${chMk(cur,r.max)}`:""}${st.mark==="not"?" · Not a mistake":""}${con?` · Contested (coach ${chMk(chClaudeMark(a,f.id),r.max)})`:""}`);
    if(f.what)L.push(`   What happened: ${f.what}`);
    (f.evidence||[]).filter(e=>e&&e.quote).forEach(e=>L.push(`   Evidence: ${e.src||""}${e.fact?` (${e.fact}): ${e.quote}`:` "${e.quote}"`}`));
    if(f.why)L.push(`   Why it matters: ${f.why}`);if(f.should)L.push(`   What ${first} should have done: ${f.should}`);if(f.model)L.push(`   Model message: "${f.model}"`);
    if(st.mark==="not"&&st.note)L.push(`   Why it wasn't a mistake: ${st.note}`);if(con&&con.reason)L.push(`   Why contested: ${con.reason}`)});
  L.push("","Filed by Swift Coach.");return L.join("\n")}
/* copy to the clipboard, falling back to a hidden text box */
async function chClip(text,done){try{await navigator.clipboard.writeText(text);toast(done);return}catch(e){}
  try{const t=document.createElement("textarea");t.value=text;t.setAttribute("readonly","");t.style.cssText="position:fixed;top:0;left:0;opacity:0";document.body.append(t);t.select();
    const ok=document.execCommand("copy");t.remove();if(ok){toast(done);return}}catch(e){}
  toast("Couldn't copy. Try again.")}
const chSec=(id,n,title,ans,body,cls)=>`<div class="qsec ${cls||""}" id="${id}"><div class="qhd"><span class="qnum"><span>${n}</span></span><span class="qttl">${esc(title)}</span><span class="qans"${id==="cs-score"?' id="csScoreAns"':""}>${esc(ans||"")}</span></div><div class="qbody">${body}</div></div>`;
function renderChatAudit(force){const v=$("#view-chat");if(!v)return;
  const sid=chatSel?String(chatSel):"",c=sid?chatBy(sid):null,a=c?chatAud[sid]:null,rv=c?chatRev[sid]:null;
  const sig=JSON.stringify([sid,week,!!c,c&&c.picked,c&&c.gradeError,c&&chHash(c),chHash(a),chHash(rv),chatPickOpen===sid,!!(calForm&&calForm.sid===sid),chatCal.filter(x=>String(x.sid)===sid).map(x=>x.at),
    !!(chatRun&&chatRun.sid===sid),!!chatRun,!!(db&&mcp&&sampleFn),chatsReady,chatNote&&chatNote.text,chatPolicyDoc&&chatPolicyDoc.at]);
  if(!force&&sig===chatAuditSig){paintRun();return}
  chatAuditSig=sig;
  if(!sid){v.innerHTML=`<div class="panel empty">No chat open. <button type="button" class="btn small" data-go="chats">Open the queue</button></div>`;return}
  if(!c){v.innerHTML=`<div class="panel empty">${(chatsReady&&chW.week===week)||!db?`Chat ${esc(sid)} isn't in ${esc(weekLabel(week))}.`:"Loading…"} <button type="button" class="btn small" data-go="chats">Open the queue</button></div>`;return}
  const d=chatDraft(sid),msgs=c.msgs||[],nInt=msgs.filter(m=>m.internal).length,pct=a?chatScore(d.scores):null,vd=chatVerdict(pct);
  const F=(a&&a.facts)||{},cl=F.claims||[],o=a&&(a.orders||[])[0];
  const ctxAns=a?[o?`Ticket ${o.ticket||"?"}`:"No order",`${(a.calls||[]).length} call${(a.calls||[]).length===1?"":"s"}`,(a.tasks||[]).length?`${a.tasks.length} task${a.tasks.length===1?"":"s"}`:""].filter(Boolean).join(" · "):"";
  const secs=[chSec("cs-chat",1,"Chat",`${msgs.length} message${msgs.length===1?"":"s"}${nInt?` · ${nInt} internal`:""}`,`<ol class="bubbles">${msgs.map(chBubble).join("")||`<li class="hint">No messages.</li>`}</ol>`,"ref"),
    chSec("cs-ctx",2,"Context",ctxAns,chContext(c,a),"ref")];
  if(a){secs.push(chSec("cs-facts",3,"Case facts",`${(F.timeline||[]).length} facts · ${cl.length} claims${cl.some(x=>x.check==="contradicted")?` · ${cl.filter(x=>x.check==="contradicted").length} contradicted`:""}`,chFacts(a),"ref"),
    chSec("cs-an",4,"Analysis",[a.analysis&&a.analysis.caseType?chCaseL(a.analysis.caseType):"",chFaultAns(a.analysis&&a.analysis.fault)].filter(Boolean).join(" · "),chAnalysis(c,a),"ref"),
    chSec("cs-score",5,"Scorecard",vd?`${vd.label} · ${fmt(pct)}%`:"",`<div class="ccrits">${chScorecard(a,d)}</div>`,rv?"done":""),
    chSec("cs-coach",6,"Coaching",rv?"Saved "+stampOf(rv.at):"Not saved",chCoach(c,a,rv,d),rv?"done":""))}
  v.innerHTML=`<div class="cdesk${a?" has-tk":""}">${a?`<article class="${chTicketCls(c,a,d)}" id="cTicket" aria-label="QA ticket">${chTicket(c,a,d)}</article>`:""}<aside class="panel board cverdict" id="chatBoard" aria-live="polite">${chBoard(c,a,rv,d)}</aside><div class="ccol">${secs.join("")}</div></div>`;
  if(chatPickOpen===sid)chOrdFilter();
}
/* live: a changed mark recomputes the score, the verdict, the escalation level and the generated coaching note */
function paintMarks(){const sid=String(chatSel||""),c=chatBy(sid),a=chatAud[sid];if(!c||!a)return;
  const d=chatDraft(sid),pct=chatScore(d.scores),v=chatVerdict(pct);
  const sc=$("#cs-score .ccrits");if(sc){const key=chFocusSel(sc);sc.innerHTML=chScorecard(a,d);chRefocus(sc,key)}
  const wd=$("#cvWord");if(wd){wd.textContent=v?v.label:"–";wd.className="vword v-"+(v?v.id:"")}
  const p=$("#cvPct");if(p)p.textContent=pct==null?"–":fmt(pct)+"%";const cc=$("#cvClaude");if(cc)cc.hidden=pct===a.pct;
  const e=$("#cvEsc");if(e)e.textContent=d.scores.esc==="na"||d.scores.esc==null?"N/A":"Level "+chMarkL(d.scores.esc);
  const sa=$("#csScoreAns");if(sa)sa.textContent=v?`${v.label} · ${fmt(pct)}%`:"";
  const ta=$("#coachText"),gen=coachText(c,a,d.scores,d.findings,d.contests);if(ta&&d.coach==null)ta.value=gen;
  const rb=$("#coachRebuild");if(rb)rb.hidden=!(d.coach!=null&&d.coach!==gen);
  paintTicket();renderChatTabs()}
function chJump(id){const el=document.getElementById(id);if(!el)return;const fold=el.closest("details:not([open])");if(fold){fold.open=true;if(fold.id==="cfTimeline")chTimelineOpen=true}el.scrollIntoView({behavior:"smooth",block:"center"});el.classList.remove("flash");void el.offsetWidth;el.classList.add("flash")}
function chGradeOpen(orderIds){const c=chatBy(chatSel),a=c&&chatAud[c.sid];if(!c)return;
  if(orderIds===undefined&&a&&a.orderPick==="reviewer")orderIds=(a.orders||[]).map(o=>o.id);
  chatPickOpen=null;runChatGrades([c],{mode:"one",orderIds,fresh:!!a||Array.isArray(orderIds)})}
async function chCopy(){const ta=$("#coachText");if(!ta)return;
  try{await navigator.clipboard.writeText(ta.value);toast("Copied")}
  catch(e){try{ta.select();if(document.execCommand("copy")){toast("Copied");return}}catch(e2){}toast("Couldn't copy. Select the text and copy it.")}}
async function saveChatReview(){const sid=String(chatSel||""),c=chatBy(sid),a=chatAud[sid];if(!db||!c||!a)return;
  const d=chatDraft(sid),pct=chatScore(d.scores),v=chatVerdict(pct),prev=chatRev[sid],ta=$("#coachText"),F=chFindings(c,a);
  /* finding marks: {<finding id>: {mark: "agree" | "not", note}} for the findings on this ticket */
  const findings={};F.forEach(f=>{const m=(d.findings||{})[f.id];if(m&&(m.mark==="agree"||m.mark==="not"))findings[f.id]={mark:m.mark,note:m.mark==="not"?String(m.note||"").trim():""}});
  /* contests: {<crit>: {from, to, reason}}. A mark back on Claude's is no contest */
  const G=(a.grade&&a.grade.scores)||{},contests={};
  Object.entries(d.contests||{}).forEach(([id,x])=>{const r=chRub(id);if(!r||!x||String(d.scores[id])!==String(x.to)||String(x.to)===String(G[id]))return;
    contests[id]={from:chMk(G[id],r.max),to:chMk(x.to,r.max),reason:String(x.reason||"").trim()}});
  const rec={sid,week:chWk(c),sa:c.sa,scores:clone(d.scores),pct,verdict:v?v.id:null,coaching:ta?ta.value:coachText(c,a,d.scores,d.findings,d.contests),findings,contests,
    reviewer:String(d.reviewer||"").trim(),by:myId||null,at:new Date().toISOString()};
  const before=gameStats(),gained=chatXpFor(rec)-(prev?chatXpFor(prev):0),btn=$("#chatSave");if(btn)btn.disabled=true;
  try{await db.doc(chPath("reviews",rec.week,sid)).set(rec)}
  catch(e){if(btn)btn.disabled=false;toast(e&&e.code==="invalid_argument"?"You don't have edit access to this QA Desk.":e&&e.code==="quota_exceeded"?"The QA Desk storage is full.":"Couldn't save. Try again.");return}
  chatRev[sid]=rec;
  const L=await chSaveLessons(c,a,rec,prev);
  const q=chatQuest(rec.week),lv=Math.floor((before.xp+gained)/100),nx=chNextChat(sid);
  const msg=`Saved ${v?v.label:""} ${fmt(pct)}% · +${Math.max(0,gained)} XP`+(q.total?` · ${q.done} of ${q.total}`:"")+(L.n?` · ${L.n} lesson${L.n===1?"":"s"}`:"")+(L.err?" · Lessons not saved":"")+(lv>before.lv?` · Level up: ${levelName(lv)}`:"");
  toast(msg,nx?{label:"Next chat →",fn:()=>openChat(nx.sid)}:null);celebrate($("#chatSave"));renderChats();renderGame()}
/* every contest and every finding marked "not a mistake" is a lesson the brain learns from (chatLessons/<sid>_<crit>); withdrawing or un-marking deletes it.
   An unchanged lesson keeps its date, so re-saving a review doesn't push older lessons out of the newest 20 */
async function chSaveLessons(c,a,rec,prev){const sid=String(rec.sid),F=chFindings(c,a),M=rec.findings||{},C=rec.contests||{},now=rec.at,A=a.analysis||{},R=(a.grade&&a.grade.reasons)||{};
  const base={sid,week:rec.week,sa:rec.sa||"",caseType:A.caseType||"",by:myId||null},docs=new Map();
  F.filter(f=>chIsNot(M,f.id)).forEach(f=>{const r=chRub(f.id);
    docs.set(`${sid}_${f.id}`,Object.assign({kind:"not"},base,{crit:f.id,label:f.label||f.id,type:f.type||"",what:f.what||"",note:M[f.id].note||""},r?{from:chMk(f.score,r.max),to:chMk(r.max,r.max)}:{}))});
  Object.entries(C).forEach(([id,x])=>{const r=chRub(id),f=F.find(y=>y.id===id);if(!r)return;
    docs.set(`${sid}_${id}`,Object.assign({kind:"contest"},base,{crit:id,label:r.label,type:(f&&f.type)||"",from:x.from,to:x.to,reason:x.reason,what:R[id]||""}))});
  const stale=new Set(chLessons.filter(l=>String(l.sid)===sid&&!docs.has(l.id)).map(l=>l.id));
  Object.keys((prev&&prev.findings)||{}).forEach(id=>{if(chIsNot(prev.findings,id)&&!docs.has(`${sid}_${id}`))stale.add(`${sid}_${id}`)});
  Object.keys((prev&&prev.contests)||{}).forEach(id=>{if(!docs.has(`${sid}_${id}`))stale.add(`${sid}_${id}`)});
  let n=0,err=false;
  for(const [id,doc] of docs){const ex=chLessons.find(l=>l.id===id),same=ex&&["kind","from","to","reason","note"].every(k=>String(ex[k]??"")===String(doc[k]??""));
    doc.at=same&&ex.at?ex.at:now;
    try{await db.doc(CH_LESSONS+"/"+id).set(doc);n++}catch(e){err=true}}
  for(const id of stale){try{await db.doc(CH_LESSONS+"/"+id).delete()}catch(e){err=true}}
  return {n,err}}
async function saveCalib(){const sid=String(chatSel||""),c=chatBy(sid);if(!db||!c||!calForm||!calForm.verdict)return;
  const d=chatDraft(sid),rec={sid,wid:c.wid||"",agent:c.sa||"",restaurant:c.restaurant||"",code:c.code||"",date:String(c.at||"").slice(0,10),verdict:calForm.verdict,
    lessons:String(calForm.lessons||"").split("\n").map(s=>s.replace(/^\s*[-•*]\s*/,"").trim()).filter(Boolean),scores:clone(d.scores),by:myId||null,at:new Date().toISOString()};
  const b=$("#calSave");if(b)b.disabled=true;
  try{await db.doc(CHAT_PATHS.calib+"/"+sid).set(rec)}catch(e){if(b)b.disabled=false;toast("Couldn't save the calibration case.");return}
  const had=chatCal.some(x=>String(x.sid)===sid);calForm=null;
  toast("Calibration case saved"+(chatRev[sid]&&!had?" · +5 XP":""));renderChatAudit(true);renderGame()}
$("#view-chat").addEventListener("click",e=>{
  const j=e.target.closest("[data-jump]");if(j){e.preventDefault();chJump(j.dataset.jump);return}
  /* a mark away from Claude's opens the contest box; Claude's own mark withdraws a contest */
  const m=e.target.closest("[data-cm]");if(m){const id=m.dataset.cm,v=m.dataset.v==="na"?"na":Number(m.dataset.v);
    if(String(v)===String(chClaudeMark(chatAud[String(chatSel)],id)))chWithdraw(id);else chOpenContest(id,"row",v);return}
  const ct=e.target.closest("[data-contest]");if(ct){chOpenContest(ct.dataset.contest,ct.dataset.where);return}
  const cvb=e.target.closest("[data-cv]");if(cvb&&chContest){chContest.to=cvb.dataset.cv==="na"?"na":Number(cvb.dataset.cv);
    document.querySelectorAll("#cbox [data-cv]").forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.cv===String(chContest.to))));
    const sv=$("#cbSave");if(sv)sv.disabled=!chContestOk();const w=$("#cbWhy");if(w&&!w.value.trim())w.focus({preventScroll:true});return}
  const fm=e.target.closest("[data-fmark]");if(fm){chMarkFinding(fm.dataset.fid,fm.dataset.fmark);return}
  const mc=e.target.closest("[data-mcopy]");if(mc){const c=chatBy(chatSel),a=c&&chatAud[c.sid],f=a&&chFindings(c,a).find(x=>x.id===mc.dataset.mcopy);if(f&&f.model)chClip(f.model,"Model message copied");return}
  const oc=e.target.closest("[data-oid]");if(oc){const id=oc.dataset.oid;chGradeOpen(id?[id]:[]);return}
  const cv=e.target.closest("[data-calv]");if(cv&&calForm){calForm.verdict=cv.dataset.calv;document.querySelectorAll("#calVerdict [data-calv]").forEach(x=>x.setAttribute("aria-pressed",String(x.dataset.calv===calForm.verdict)));const s=$("#calSave");if(s)s.disabled=false;return}
  const b=e.target.closest("button");if(!b)return;
  switch(b.id){
    case "cbSave":chSaveContest();break;
    case "cbCancel":{const B=chContest;chContest=null;paintMarks();if(B){const x=$(`[data-contest="${B.crit}"][data-where="${B.where}"]`);if(x)x.focus({preventScroll:true})}break}
    case "cbWithdraw":if(chContest)chWithdraw(chContest.crit);break;
    case "cvGrade":chGradeOpen();break;
    case "cvStop":if(chatRun)chatRun.ctl.abort();break;
    case "cvNext":{const nx=chNextChat(chatSel);if(nx)openChat(nx.sid);break}
    case "ordChange":chatPickOpen=String(chatSel);chOrdQ="";renderChatAudit(true);break;
    case "ordCancel":chatPickOpen=null;renderChatAudit(true);break;
    case "coachCopy":chCopy();break;
    case "tkCopy":{const c=chatBy(chatSel),a=c&&chatAud[c.sid];if(a)chClip(chTicketText(c,a,chatDraft(String(c.sid))),"Ticket copied");break}
    case "coachRebuild":{const d=chatDraft(String(chatSel));d.coach=null;paintMarks();break}
    case "chatSave":saveChatReview();break;
    case "calOpen":{const sid=String(chatSel),ex=chatCal.find(x=>String(x.sid)===sid),d=chatDraft(sid),v=chatVerdict(chatScore(d.scores));
      calForm={sid,verdict:ex?ex.verdict:v?v.id:"",lessons:ex?(ex.lessons||[]).join("\n"):""};renderChatAudit(true);const t=$("#calLessons");if(t)t.focus();break}
    case "calSave":saveCalib();break;
    case "calCancel":calForm=null;renderChatAudit(true);break}});
$("#view-chat").addEventListener("input",e=>{const t=e.target,sid=String(chatSel||"");if(!sid)return;
  if(t.id==="coachText"){const d=chatDraft(sid);d.coach=t.value;const c=chatBy(sid),a=chatAud[sid],rb=$("#coachRebuild");if(rb&&c&&a)rb.hidden=t.value===coachText(c,a,d.scores,d.findings,d.contests);return}
  if(t.id==="cbWhy"&&chContest){chContest.reason=t.value;const sv=$("#cbSave");if(sv)sv.disabled=!chContestOk();return}
  if(t.dataset&&t.dataset.fnote){const M=chatDraft(sid).findings||{},st=M[t.dataset.fnote];if(st&&st.mark==="not")st.note=t.value;return}
  if(t.id==="chatReviewer"){chatDraft(sid).reviewer=t.value;store.set("qa.reviewer",t.value);return}
  if(t.id==="ordQ"){chOrdQ=t.value;chOrdFilter();return}
  if(t.id==="calLessons"&&calForm)calForm.lessons=t.value});
$("#view-chat").addEventListener("keydown",e=>{if(e.key==="Escape"&&chContest&&e.target.closest&&e.target.closest("#cbox")){e.preventDefault();$("#cbCancel").click()}});
$("#view-chat").addEventListener("toggle",async e=>{const d=e.target;if(d instanceof HTMLDetailsElement&&d.id==="cfTimeline"){chTimelineOpen=d.open;return}
  if(d instanceof HTMLDetailsElement&&d.dataset.model){if(d.open)chModelOpen.add(d.dataset.model);else chModelOpen.delete(d.dataset.model);return}
  if(!(d instanceof HTMLDetailsElement)||!d.dataset.ctx||!d.open)return;
  const sid=String(chatSel||"");if(!sid||!db||chatTxCache.has(sid))return;chatTxCache.set(sid,"loading");
  try{const s=await db.doc(chPath("tx",chWk(chatBy(sid)),sid)).get();chatTxCache.set(sid,new Map(((s.exists&&s.data().calls)||[]).map(x=>[String(x.id),String(x.text||"")])))}catch(err){chatTxCache.set(sid,"error")}
  if(String(chatSel)===sid)document.querySelectorAll("#view-chat details[data-ctx]").forEach(x=>{const t=x.querySelector(".txtext");if(t)t.innerHTML=txText(sid,x.dataset.ctx)})},true);

/* ---------- BRAIN: the policy, calibration cases and staff the brain reads, and the rubric ---------- */
function chRubricHtml(){return `<div class="bhd"><h2>Chat rubric</h2><span class="hint num">${CHAT_RUBRIC.reduce((t,r)=>t+r.w,0)}% total</span></div>
  <div class="rbt" role="table"><div class="rbr rbh" role="row"><span role="columnheader">Criterion</span><span role="columnheader" class="n">Weight</span><span role="columnheader" class="n">Scale</span><span role="columnheader">N/A</span></div>
  ${CHAT_RUBRIC.map(r=>`<div class="rbr" role="row"><span role="cell"><b>${esc(r.label)}</b><span class="rbd">${esc(r.d||"")}</span></span><span role="cell" class="n num">${r.w}%</span><span role="cell" class="n num">0–${r.max}</span><span role="cell">${r.na?"Allowed":"–"}</span></div>`).join("")}</div>
  <div class="hint">${VERDICTS.map(([,min,l])=>`${l} ≥ ${min}`).join(" · ")}</div>`}
function chPolicyHtml(){const P=chatPolicyDoc||{},comp=P.comp||{},B=comp.buckets||[];
  return `<div class="bhd"><h2>Compensation policy</h2>${safeUrl(P.source)?`<a href="${esc(safeUrl(P.source))}" target="_blank" rel="noopener">Source ↗</a>`:""}</div>
    ${chatPolicyDoc?"":`<div class="cvnote">No policy saved yet.</div>`}
    <div class="field"><label for="polVersion">Version</label><input id="polVersion" autocomplete="off" value="${esc(P.version||"")}"></div>
    <table class="btbl"><thead><tr><th>Bucket</th><th class="n">%</th><th>Delivery fee</th></tr></thead><tbody>${B.map((b,i)=>`<tr><td>${esc(b.label||b.id)}<div class="num hint">${esc(b.id)}</div></td>
      <td class="n"><input type="number" min="0" max="100" step="1" inputmode="numeric" data-bpct="${i}" value="${esc(b.pct??0)}" aria-label="${esc(b.label||b.id)} percent"></td>
      <td><input type="checkbox" data-bfee="${i}"${b.deliveryFee?" checked":""} aria-label="${esc(b.label||b.id)}: add the delivery fee"></td></tr>`).join("")||`<tr><td colspan="3" class="hint">No buckets</td></tr>`}</tbody></table>
    <div class="bgrid"><div class="field"><label for="polLimit">Approval limit ($)</label><input id="polLimit" type="number" min="0" step="1" inputmode="numeric" value="${esc(comp.approvalLimit??25)}"></div>
      <div class="field"><label for="polApprover">Approver</label><input id="polApprover" autocomplete="off" value="${esc(comp.approver||"")}"></div></div>
    <div class="field"><label for="polText">Policy</label><textarea id="polText" class="poltext" rows="14">${esc(P.text||"")}</textarea></div>
    <div class="row"><button type="button" class="btn primary" id="polSave" disabled>Save policy</button><button type="button" class="btn" id="polUndo" hidden>Discard</button><span class="hint" id="polNote">${P.at?"Saved "+esc(stampOf(P.at)):""}</span></div>`}
function chCalHtml(){const L=chatCal.slice().sort((a,b)=>String(b.at||"").localeCompare(String(a.at||"")));
  return `<div class="bhd"><h2>Calibration cases</h2><span class="hint num">${L.length}</span></div>`+(L.length?`<ul class="callist">${L.map((x,i)=>`<li class="calitem"><div class="calhd"><span class="pill solid ${CH_VB[x.verdict]||"none"}">${esc(chVLabel(x.verdict)||x.verdict||"–")}</span>
      <b>${esc(x.agent||"")}</b><span>${esc(x.restaurant||"")}</span><span class="num hint">${esc(x.date?shortDate(x.date):"")}</span>${i<CHAT.calibMax?`<span class="ttag">In use</span>`:""}
      <span class="calact">${chatBy(x.sid)||x.date?`<button type="button" class="btn small" data-open="${esc(x.sid)}" data-week="${esc(chatBy(x.sid)?chWk(chatBy(x.sid)):chatWeek(x.date))}">Open</button>`:""}<button type="button" class="btn small danger" data-caldel="${esc(x.id)}">Delete</button></span></div>
      ${(x.lessons||[]).length?`<ul class="lessons">${x.lessons.map(l=>`<li>${esc(l)}</li>`).join("")}</ul>`:""}</li>`).join("")}</ul>`:`<div class="hint">None yet.</div>`)}
/* what the coach learned: contested marks and findings marked "not a mistake". The newest CHAT.lessonMax go into every grade */
function chLessonsHtml(){const L=chLessonsSorted(),max=CHAT.lessonMax||20,day=at=>{const t=Date.parse(at);return isNaN(t)?"":new Date(t).toLocaleDateString("en-US",{month:"short",day:"numeric"})};
  return `<div class="bhd"><h2>What the coach learned</h2><span class="hint num">${L.length>max?`${max} of ${L.length} in use`:L.length}</span></div>`+(L.length?`<p class="hint lsuse">Every new grade reads the newest ${max}.</p><ul class="callist">${L.map(l=>{const wk=l.week||(chatBy(l.sid)?chWk(chatBy(l.sid)):""),con=l.kind==="contest",why=con?l.reason:l.note;
    const mk=con?`<span class="lsmk num"><s>${esc(l.from||"–")}</s><span aria-hidden="true"> → </span><span class="sr-only"> to </span><b>${esc(l.to||"–")}</b></span>`:`<span class="lsmk"><span class="tknot">Not a mistake</span></span>`;
    return `<li class="calitem lsitem ${con?"contest":"not"}"><div class="calhd"><b>${esc(l.label||l.crit||"Finding")}</b>${l.caseType?`<span class="lsct">${esc(chCaseL(l.caseType))}</span>`:""}${mk}
      <span class="calact"><button type="button" class="btn small danger" data-lsdel="${esc(l.id)}">Delete</button></span></div>
      ${why?`<div class="lsline lsnote"><span class="lbl-sm">Why</span> ${esc(why)}</div>`:""}${l.what?`<div class="lsline"><span class="lbl-sm">Coach said</span> ${l.type?`<span class="lstype0">${esc(l.type)}:</span> `:""}${esc(l.what)}</div>`:""}
      <div class="lsmeta hint">${esc(l.sa||"")}${l.sa?" · ":""}<span class="num">${esc(day(l.at))}</span> · <button type="button" class="lslink" data-open="${esc(l.sid)}" data-week="${esc(wk)}">Chat ${esc(l.sid)}</button></div></li>`}).join("")}</ul>`:`<div class="hint">None yet.</div>`)}
function chStaffRow(p,s,def){return `<div class="srow"${def?' data-def="1"':""}><input data-sp aria-label="Email prefix" autocomplete="off" value="${esc(p)}"><input data-sn aria-label="Name" autocomplete="off" value="${esc(s.name||"")}">
  <select data-sr aria-label="Role">${CH_ROLES.map(([v,l])=>`<option value="${v}"${s.role===v?" selected":""}>${l}</option>`).join("")}</select>${def?`<span></span>`:`<button type="button" class="btn small danger" data-srm aria-label="Remove">×</button>`}</div>`}
function chStaffHtml(){const saved=(staffDoc&&staffDoc.map)||{},map=Object.assign({},STAFF_DEFAULT,saved);
  return `<div class="bhd"><h2>Staff directory</h2><span class="hint num">${Object.keys(map).length}</span></div>
    <div class="srow srh"><span>Email prefix</span><span>Name</span><span>Role</span><span></span></div>
    <div id="staffRows">${Object.keys(map).sort((a,b)=>String(map[a].name).localeCompare(String(map[b].name))).map(p=>chStaffRow(p,map[p],p in STAFF_DEFAULT)).join("")}</div>
    <div class="row"><button type="button" class="btn small" id="staffAdd">Add person</button><button type="button" class="btn primary" id="staffSave" disabled>Save staff</button><span class="hint" id="staffNote"></span></div>`}
function renderBrain(){const v=$("#view-brain");if(!v)return;
  if(!v.dataset.ready){v.dataset.ready="1";v.innerHTML=`<div class="brain"><section class="panel bpanel" id="brPolicy"></section><section class="panel bpanel" id="brCal"></section><section class="panel bpanel" id="brLessons"></section><section class="panel bpanel" id="brStaff"></section><section class="panel bpanel" id="brRubric"></section></div>`;
    $("#brRubric").innerHTML=chRubricHtml()}
  if(!polDirty)$("#brPolicy").innerHTML=chPolicyHtml();
  $("#brCal").innerHTML=chCalHtml();
  $("#brLessons").innerHTML=chLessonsHtml();
  if(!staffDirty)$("#brStaff").innerHTML=chStaffHtml()}
function chPolDirty(on){polDirty=on;const s=$("#polSave"),u=$("#polUndo");if(s)s.disabled=!on||!db;if(u)u.hidden=!on}
function chStaffDirty(on){staffDirty=on;const s=$("#staffSave");if(s)s.disabled=!on||!db}
async function savePolicy(){if(!db)return;const P=clone(chatPolicyDoc||{}),comp=Object.assign({base:"items",approvalLimit:25,approver:"",buckets:[]},P.comp||{});
  comp.buckets=(comp.buckets||[]).map((b,i)=>{const p=document.querySelector(`[data-bpct="${i}"]`),f=document.querySelector(`[data-bfee="${i}"]`);
    return Object.assign({},b,{pct:p?Math.max(0,Math.min(100,Math.round(Number(p.value)||0))):b.pct,deliveryFee:f?f.checked:!!b.deliveryFee})});
  comp.approvalLimit=Math.max(0,Number($("#polLimit").value)||0);comp.approver=$("#polApprover").value.trim();
  const doc=Object.assign(P,{version:$("#polVersion").value.trim(),text:$("#polText").value,comp,at:new Date().toISOString(),by:myId||null});
  $("#polSave").disabled=true;
  try{await db.doc(CHAT_PATHS.policy).set(doc);chatPolicyDoc=doc;chPolDirty(false);renderBrain();toast("Policy saved")}
  catch(e){$("#polSave").disabled=false;$("#polNote").textContent=e&&e.code==="invalid_argument"?"You can't edit the policy.":"Couldn't save. Try again."}}
async function saveStaff(){if(!db)return;const map={};
  document.querySelectorAll("#staffRows .srow").forEach(r=>{const p=prefixOf(r.querySelector("[data-sp]").value),n=r.querySelector("[data-sn]").value.trim(),role=r.querySelector("[data-sr]").value;
    if(p&&n)map[p]={name:n,role}});
  $("#staffSave").disabled=true;
  try{await db.doc(CHAT_PATHS.staff).set({map,at:new Date().toISOString(),by:myId||null});staffDoc={map};chStaffDirty(false);renderBrain();toast("Staff saved")}
  catch(e){$("#staffSave").disabled=false;$("#staffNote").textContent="Couldn't save. Try again."}}
$("#view-brain").addEventListener("input",e=>{if(e.target.closest("#brPolicy"))chPolDirty(true);else if(e.target.closest("#brStaff"))chStaffDirty(true)});
$("#view-brain").addEventListener("change",e=>{if(e.target.closest("#brPolicy"))chPolDirty(true);else if(e.target.closest("#brStaff"))chStaffDirty(true)});
$("#view-brain").addEventListener("click",async e=>{const b=e.target.closest("button");if(!b)return;
  if(b.dataset.open){openChat(b.dataset.open,b.dataset.week);return}
  if(b.dataset.caldel){if(b.dataset.arm!=="1"){b.dataset.arm="1";b.textContent="Confirm";setTimeout(()=>{if(b.isConnected){b.dataset.arm="";b.textContent="Delete"}},3000);return}
    try{await db.doc(CHAT_PATHS.calib+"/"+b.dataset.caldel).delete();toast("Calibration case deleted")}catch(err){toast("Couldn't delete it.")}return}
  if(b.dataset.lsdel){if(b.dataset.arm!=="1"){b.dataset.arm="1";b.textContent="Confirm";setTimeout(()=>{if(b.isConnected){b.dataset.arm="";b.textContent="Delete"}},3000);return}
    try{await db.doc(CH_LESSONS+"/"+b.dataset.lsdel).delete();toast("Lesson deleted")}catch(err){toast("Couldn't delete it.")}return}
  if(b.hasAttribute("data-srm")){b.closest(".srow").remove();chStaffDirty(true);return}
  switch(b.id){
    case "polSave":savePolicy();break;
    case "polUndo":chPolDirty(false);renderBrain();break;
    case "staffAdd":{$("#staffRows").insertAdjacentHTML("beforeend",chStaffRow("",{name:"",role:"staff"},false));const i=$("#staffRows").lastElementChild.querySelector("[data-sp]");if(i)i.focus();chStaffDirty(true);break}
    case "staffSave":saveStaff();break}});
