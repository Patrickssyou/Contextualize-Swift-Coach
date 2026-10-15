/* ---------- CALIBRATION: three graders (and Claude) mark the same items blind, reveal, settle each row, lock the agreed score.
   db: calibMarks/<uid> {joinedAt, lastSeen} (who grades; each viewer writes their own), calibMarks/<uid>/items/<itemKey> {kind, key, marks, notes, submittedAt, updatedAt} (submitted, shared),
       data/users/<uid>/calib_<itemKey> {marks, notes, updatedAt} (the private draft), calibItems/<itemKey> {kind, key, round, locked:{by, at, pct, verdict, marks} | null},
       calibItems/<itemKey>/rows/<crit> {mark, note, by, at} (one doc per agreed row, so two people settling different rows never collide), calibRounds/<id> {kind:"call", week, items:[{key, sa}], drawnAt, by}.
   itemKey: chat_<sid> | call_<queueId>; "key" in the docs is the bare sid or queue id. Chat rounds are the Learning rounds (learning/state); call rounds are calibRounds.
   People are stored only as ids; names come from user.profiles at render. Subscriptions: calibMarks, each grader's items, calibItems, calibRounds, and the rows of the one item on screen. ---------- */
let cbGraders=new Map(),cbGradersReady=false,cbItems={},cbItemsReady=false,cbRounds=[];
const cbMarks=new Map(),cbMarkOffs=new Map();
let cbRowsSub={ik:"",off:null,rows:{}};
const cbDrafts=new Map(),cbW=new Map(),cbNames=new Map();let cbNameRun=null;
/* local view state: who I revealed (per item), Compare all, open rows, my open note, editing my submitted marks, the settle box */
const cbPeek=new Set(),cbCompare=new Set(),cbOpen=new Set(),cbEdit=new Set();let cbNoteOpen="",cbSettle=null;
let cbFilt="all",cbMineOnly=false,cbRedraw=false,cbTkTab="ticket",cbEvMore=false,cbBusy=false,cbNote="",cbPeers=[],cbPresSig="",cbSeenAt=0,cbPanel=null,cbPanelEl=null,cbLockRun=false;
/* short names for the call rubric rows (the live rubric, CUR); MGR / DE and cases change a few */
const CB_CALL_SHORT={"1a":"Opening spiel","1b":"Tone and dead air","1c":"Empathy and composure","1d":"Clear communication","2a":"Listened and gathered info","2b":"Root cause and fault",
  "2c":"Immediate resolution","2d":"Long-term solution","2e":"Ticket documented","3a":"Ownership","3b":"Self-serve coaching","3c":"Next steps"};
const CB_MGR_SHORT=Object.assign({},CB_CALL_SHORT,{"3b":"Edge case judgment","3c":"Proactive outreach"});
const CB_CASE_SHORT={"1a":"Root cause and fault","1b":"Facts gathered once","2a":"Owner and handoffs","2b":"Coordination","2c":"One voice","3a":"Fix and promises","3b":"Ticket tells the case","3c":"No loops"};
/* a round is one week: 3 chats and 3 calls per SA, in calibRounds/<week> */
const CB_PER=3;
/* who should grade: settings/calibGraders {expected:[names]} (owner edits); missing doc → these three */
const CB_EXPECT=["Pat","Howard","Li Qi"];
let cbExpectDoc=null,cbGrEdit=false,cbGrDraft="",cbRailOpen=false;
/* Claude on calls: callGrades/<queueId> {v, at, by, items, scores, reasons, cites, wentWell, fixes, summary, F, A} (up to ~20KB each).
   The open call's doc is watched; the round's call docs are read once per draw. queueId → doc, null when there is none; no key = not read yet */
const CG_ROOT="callGrades",CL_ROOT="callLessons",cbCG=new Map(),cbGRErr=new Map();
let cbCGSub={qid:"",off:null},cbCGRound="",cbGR=null,cbGRNote=null;

/* ---------- listeners (once, after db is ready) ---------- */
function calibListen(){if(!db)return;
  db.collection("calibMarks").onSnapshot(s=>{const m=new Map();s.docs.forEach(d=>m.set(d.id,d.data()||{}));cbGraders=m;cbGradersReady=true;
    const ids=[...m.keys()];if(myId&&!ids.includes(myId))ids.push(myId);ids.forEach(cbListenMarks);cbRender()},()=>{cbGradersReady=true;cbRender()});
  db.collection("calibItems").onSnapshot(s=>{cbItems=Object.fromEntries(s.docs.map(d=>[d.id,d.data()||{}]));cbItemsReady=true;cbRender(true)},()=>{cbItemsReady=true});
  db.doc("settings/calibGraders").onSnapshot(s=>{cbExpectDoc=s&&s.exists?(s.data()||null):null;cbRender()},()=>{});
  db.collection("calibRounds").onSnapshot(s=>{cbRounds=s.docs.map(d=>Object.assign({},d.data(),{id:d.id}));cbRender()},()=>{});
  if(myId)cbListenMarks(myId);
  if(roomCap&&roomCap.onPeers){try{roomCap.onPeers(ch=>{cbPeers=(ch&&ch.peers)||[];cbPaintHere()})}catch(e){}}
}
/* one subscription per grader, opened from the graders snapshot (never from render); capped */
function cbListenMarks(uid){if(!db||!uid||cbMarkOffs.has(uid)||cbMarkOffs.size>=48)return;
  cbMarkOffs.set(uid,db.collection("calibMarks/"+uid+"/items").onSnapshot(s=>{cbMarks.set(uid,new Map(s.docs.map(d=>[d.id,d.data()||{}])));cbRender()},()=>{}))}
/* the rows of the item on screen: switched only when that item changes */
function cbWatchRows(ik){if(!db||cbRowsSub.ik===ik)return;if(cbRowsSub.off)try{cbRowsSub.off()}catch(e){}
  const S={ik,off:null,rows:{}};cbRowsSub=S;if(!ik)return;
  S.off=db.collection("calibItems/"+ik+"/rows").onSnapshot(s=>{if(cbRowsSub!==S)return;S.rows=Object.fromEntries(s.docs.map(d=>[d.id,d.data()||{}]));cbRender()},()=>{})}
const cbRowsOf=ik=>cbRowsSub.ik===ik?cbRowsSub.rows:{};
/* a snapshot repaints the open view; a lock change re-renders the chat audit (score, ticket, coaching) */
function cbRender(lockChange){if(tab==="calib")renderCalib();
  if(tab==="chat"){if(lockChange)renderChats();else renderChatAudit();cbPaint();cbRailPaint()}renderCalibTab()}

/* ---------- people ---------- */
function cbGraderIds(){const L=[...cbGraders.entries()].sort((a,b)=>String(a[1].joinedAt||"").localeCompare(String(b[1].joinedAt||""))||a[0].localeCompare(b[0])).map(x=>x[0]);
  if(myId&&!L.includes(myId))L.push(myId);return L}
/* expected graders: joined graders match by the first word of their name; the owner with no name is Pat; unloaded or unnamed graders take the
   remaining names in order (so nobody shows twice); every name left over is a pending column "~<name>" */
const cbPend=u=>typeof u==="string"&&u[0]==="~";
const cbFw=n=>String(n||"").trim().split(/\s+/)[0].toLowerCase();
function cbExpected(){const L=cbExpectDoc&&Array.isArray(cbExpectDoc.expected)?cbExpectDoc.expected:null;
  return (L||CB_EXPECT).map(x=>String(x||"").trim()).filter(Boolean)}
function cbMatch(){const G=cbGraderIds(),left=cbExpected(),own=amOwner&&myId?myId:G[0],slot=new Map(),take=(u,i)=>{slot.set(u,left[i]);left.splice(i,1)};
  const fw=new Map(G.map(u=>[u,cbNames.has(u)?cbFw(cbNames.get(u)):null]));
  /* exact first word, then a short form ("Pat" for "Patrick", at least 3 letters) */
  G.forEach(u=>{const f=fw.get(u);if(!f)return;const i=left.findIndex(x=>cbFw(x)===f);if(i>=0)take(u,i)});
  G.forEach(u=>{const f=fw.get(u);if(!f||slot.has(u))return;const i=left.findIndex(x=>{const e=cbFw(x);return e.length>=3&&(f.startsWith(e)||e.startsWith(f)&&f.length>=3)});if(i>=0)take(u,i)});
  if(own&&fw.get(own)===""&&!slot.has(own)){const i=left.findIndex(x=>cbFw(x)==="pat");if(i>=0)take(own,i)}
  G.forEach(u=>{if(!fw.get(u)&&!slot.has(u)&&left.length)take(u,0)});
  return {G,slot,pend:left}}
/* the columns: joined graders (by join order), then the pending names */
function cbCols(){const M=cbMatch();return M.G.concat(M.pend.map(n=>"~"+n))}
const cbColor=u=>u==="claude"?"cl":cbPend(u)?"pend":"g"+((Math.max(0,cbGraderIds().indexOf(u))%4)+1);
function cbNeedNames(ids){if(!userCap||typeof userCap.profiles!=="function")return;const miss=[...new Set(ids)].filter(u=>u&&u!=="claude"&&!cbPend(u)&&!cbNames.has(u));if(!miss.length||cbNameRun)return;
  cbNameRun=Promise.resolve().then(()=>userCap.profiles(miss)).then(ps=>{miss.forEach(u=>cbNames.set(u,String((ps&&ps[u]&&ps[u].name)||"")))})
    .catch(()=>{miss.forEach(u=>cbNames.set(u,""))}).finally(()=>{cbNameRun=null;cbRender()})}
const cbName=u=>u==="claude"?"Claude":cbPend(u)?u.slice(1):cbNames.get(u)||cbMatch().slot.get(u)||"Someone";
function cbIni(u){if(u==="claude")return "C";const n=cbPend(u)?u.slice(1):cbNames.get(u)||cbMatch().slot.get(u);if(!n)return "?";const w=n.trim().split(/\s+/).filter(Boolean);return ((w[0]||"")[0]+(w.length>1?w[1][0]:"")).toUpperCase()}
const cbAv=u=>`<span class="cbav ${cbColor(u)}" title="${esc(cbName(u))}" aria-hidden="true">${esc(cbIni(u))}</span>`;
function cbList(names){return names.length<2?names.join(""):names.slice(0,-1).join(", ")+" and "+names[names.length-1]}
/* "You and Howard are here": the people on the same tab (or the same item) right now */
function cbHereHtml(ik){const me=myId,on=new Map();
  (cbPeers||[]).forEach(p=>{const u=p&&p.by,pr=(p&&p.presence)||{};if(!u||p.isMe||u===me)return;if(ik?pr.item===ik:pr.tab==="calib")on.set(u,1)});
  const ids=[...on.keys()];if(!ids.length)return "";cbNeedNames(ids.concat(me?[me]:[]));
  return `<span class="cbhere"><span class="cblive" aria-hidden="true"></span><span class="cbavs">${(me?[me]:[]).concat(ids).map(cbAv).join("")}</span><span>You and ${esc(cbList(ids.map(cbName)))} ${ids.length?"are":"is"} here</span></span>`}
function cbPaintHere(){document.querySelectorAll("[data-cbhere]").forEach(el=>{el.innerHTML=cbHereHtml(el.dataset.cbhere||"")})}
/* presence: the tab and the item on screen; sent only when they change */
function cbPresence(){if(!roomCap||typeof roomCap.presence!=="function")return;const ik=cbItemOnScreen(),sig=tab+"|"+(ik||"");if(sig===cbPresSig)return;cbPresSig=sig;
  Promise.resolve().then(()=>roomCap.presence({tab,item:ik||null})).catch(()=>{})}
/* calibMarks/<me>: joining makes you a grader (a column on every item); lastSeen at most every 10 minutes */
function cbSeen(force){if(!db||!myId||!cbGradersReady)return Promise.resolve();const now=Date.now();if(!force&&cbGraders.has(myId)&&now-cbSeenAt<6e5)return Promise.resolve();cbSeenAt=now;
  const at=new Date(now).toISOString(),ex=cbGraders.get(myId);
  const p=ex?db.doc("calibMarks/"+myId).update({lastSeen:at}):db.doc("calibMarks/"+myId).set({joinedAt:at,lastSeen:at});
  if(!ex)cbGraders.set(myId,{joinedAt:at,lastSeen:at});
  return p.catch(()=>{})}

/* ---------- items ---------- */
const cbCallType=it=>{const t=((it&&it.q)||{}).type;return t==="mgr"||t==="case"?t:"call"};
function cbRubric(kind,it){if(kind==="chat")return CHAT_RUBRIC.map(r=>({id:r.id,label:r.label,title:r.d||"",min:0,max:r.max,na:!!r.na}));
  const t=cbCallType(it),S=t==="mgr"?CB_MGR_SHORT:t==="case"?CB_CASE_SHORT:CB_CALL_SHORT;
  return itemsOf(CUR,t).map(x=>({id:x.id,label:S[x.id]||x.label,title:x.label,min:0,max:3,na:true,lv:x.lv||[],naText:x.na||""}))}
/* the score the item's own scorecard computes: the chat score, or the live call rubric's calc */
function cbPct(kind,m,it){if(kind==="chat")return chatScore(m);const c=calc(CUR,cbCallType(it),m||{});return c.total==null?null:Math.round(c.total*10)/10}
const cbWeekRound=w=>cbRounds.find(r=>r.id===(w||week)&&Array.isArray(r.items)&&r.week)||null;
/* Claude's marks at draw (the Learning sample) for a chat, when its audit isn't loaded */
function cbSampleOf(sid){const R=lrnRounds();for(let i=R.length-1;i>=0;i--){const x=lrnInSample(R[i],sid);if(x)return x}return null}
function cbRoundItems(w){const r=cbWeekRound(w);if(!r)return [];const n=r.items.length;
  return r.items.map((x,i)=>{const key=String(x.key),base={key,week:r.week,round:r.week,i,n,sa:x.sa||"",at:x.at||""};
    if(x.kind!=="call")return Object.assign(base,{kind:"chat",ik:"chat_"+key,title:x.restaurant||"Chat "+key,aiPct:x.aiPct??null,s:cbSampleOf(key)});
    const q=(queueAll||[]).find(d=>String(d.id)===key)||null;
    return Object.assign(base,{kind:"call",ik:"call_"+key,sa:base.sa||(q&&q.agent)||"",title:x.restaurant||(q&&q.restaurantName)||"Call "+key,q})})}
const cbChatItems=()=>cbRoundItems().filter(x=>x.kind==="chat");
const cbCallItems=()=>cbRoundItems().filter(x=>x.kind==="call");
/* a chat is under calibration when it is in the week's round or has a calibration item */
function cbItemFor(c){if(!c)return null;const sid=String(c.sid),hit=cbChatItems().find(x=>x.key===sid&&x.week===chWk(c));if(hit)return hit;
  const d=cbItems["chat_"+sid];return d?{kind:"chat",key:sid,ik:"chat_"+sid,week:chWk(c),round:d.round??null,sa:c.sa||"",title:c.restaurant||"Chat "+sid}:null}
const cbChatOn=c=>!!cbItemFor(c);
/* a call: the round item, else a bare item from the queue (opened from a link) */
function cbCallItem(id){id=String(id||"");const hit=cbCallItems().find(x=>x.key===id);if(hit)return hit;const q=(queueAll||[]).find(d=>String(d.id)===id);
  return q?{kind:"call",key:id,ik:"call_"+id,week:q.week||week,round:(cbItems["call_"+id]||{}).round??null,sa:q.agent||"",title:q.restaurantName||"Call "+id,q,at:""}:null}
function cbItemOnScreen(){if(tab!=="chat")return null;if(callSel)return "call_"+callSel;const c=chatSel&&chatBy(chatSel),it=cbItemFor(c);return it?it.ik:null}
/* Claude's marks and reasons: a call's callGrades doc; the chat's audit when it is loaded, else the marks at draw */
function cbClaude(it){if(it.kind==="call"){const g=cbCG.get(String(it.key));return g&&g.scores&&typeof g.scores==="object"?{marks:g.scores,why:g.reasons||{},cites:g.cites||{},g}:null}
  if(it.kind!=="chat")return null;const a=chatAud[it.key],G=(a&&a.grade)||{};
  if(G.scores)return {marks:G.scores,why:G.reasons||{}};return it.s&&it.s.aiScores?{marks:it.s.aiScores,why:{}}:null}
const cbSub=(u,ik)=>{const m=cbMarks.get(u),d=m&&m.get(ik);return d&&d.submittedAt?d:null};
/* my private draft: read once per item, written on change (debounced, one write at a time) */
function cbDraftOf(ik){let d=cbDrafts.get(ik);if(d)return d;d={marks:{},notes:{},loaded:!db||!myId};cbDrafts.set(ik,d);
  if(db&&myId)db.doc(`data/users/${myId}/calib_${ik}`).get().then(s=>{const x=s.exists?s.data():null;if(x){d.marks=Object.assign({},x.marks||{},d.marks);d.notes=Object.assign({},x.notes||{},d.notes)}})
    .catch(()=>{}).finally(()=>{d.loaded=true;cbRender()});
  return d}
function cbMine(ik){const s=cbSub(myId,ik);if(s)return {marks:s.marks||{},notes:s.notes||{},sub:true,doc:s};const d=cbDraftOf(ik);return {marks:d.marks,notes:d.notes,sub:false,loaded:d.loaded}}
function cbWrite(path,get,mode){let w=cbW.get(path);if(!w){w={t:null,busy:false,again:false};cbW.set(path,w)}w.get=get;w.mode=mode;clearTimeout(w.t);w.t=setTimeout(()=>cbFlush(path),600)}
async function cbFlush(path){const w=cbW.get(path);if(!w||!db)return;clearTimeout(w.t);w.t=null;if(w.busy){w.again=true;return}w.busy=true;w.again=false;
  try{const d=w.get();if(w.mode==="update")await db.doc(path).update(d);else await db.doc(path).set(d)}catch(e){toast("Couldn't save your marks. Try again.")}
  finally{w.busy=false;if(w.again)cbFlush(path)}}
function cbSaveMine(ik){const s=cbSub(myId,ik),at=new Date().toISOString();
  if(s){s.updatedAt=at;cbWrite(`calibMarks/${myId}/items/${ik}`,()=>({marks:clone(s.marks||{}),notes:clone(s.notes||{}),updatedAt:s.updatedAt}),"update");return}
  const d=cbDraftOf(ik);d.updatedAt=at;cbWrite(`data/users/${myId}/calib_${ik}`,()=>({marks:clone(d.marks),notes:clone(d.notes),updatedAt:d.updatedAt}),"set")}
const cbDone=(R,m)=>R.filter(r=>m[r.id]!=null&&m[r.id]!=="").length;
/* the agreed mark of one row: its row doc, else the locked snapshot, else the mark every submitted grader gave */
function cbAgreed(ik,crit,subd){const rw=cbRowsOf(ik)[crit];if(rw&&rw.mark!=null)return {mark:rw.mark,note:String(rw.note||""),doc:true,by:rw.by};
  const lk=(cbItems[ik]||{}).locked;if(lk&&lk.marks&&lk.marks[crit]!==undefined)return {mark:lk.marks[crit],note:"",doc:false};
  const v=(subd||[]).map(u=>((cbSub(u,ik)||{}).marks||{})[crit]).filter(x=>x!=null&&x!=="");
  return v.length&&v.length===(subd||[]).length&&v.every(x=>String(x)===String(v[0]))?{mark:v[0],note:"All matched",auto:true}:null}
/* the chat audit reads this: the agreed marks of a locked chat */
function cbLockedChat(sid){const d=cbItems["chat_"+sid],lk=d&&d.locked;return lk&&lk.marks?{marks:lk.marks,pct:lk.pct,verdict:lk.verdict,sig:String(lk.at||"")}:null}
function cbStage(it){const d=cbItems[it.ik];if(d&&d.locked)return "agreed";const G=cbCols(),n=G.filter(u=>cbSub(u,it.ik)).length;return n&&n===G.length?"settle":"scoring"}
function cbSpread(vals){const v=vals.filter(x=>x!=null&&x!=="");if(v.length<2)return null;if(v.every(x=>String(x)===String(v[0])))return 0;
  if(v.some(x=>x==="na"))return "na";return Math.max(...v.map(Number))-Math.min(...v.map(Number))}
const cbSpreadHtml=s=>s==null?"":s===0?`<span class="pill good">Match</span>`:s==="na"?`<span class="pill ok">N/A split</span>`:`<span class="pill ${s>=2?"bad":"ok"}">${s} apart</span>`;
const cbMk=(v,r)=>v==null||v===""?`<span class="cbmk na">–</span>`:`<span class="cbmk ${chMarkCls(v,r.max)}">${esc(v==="na"?"N/A":chMarkL(v))}</span>`;
const cbOpts=r=>{const o=[];for(let v=r.min;v<=r.max;v++)o.push(v);if(r.na)o.push("na");return o};

/* ---------- the shared scorecard grid (chats in the Audit tab, calls in the Calibration tab) ---------- */
function cbGridHtml(it){
  const R=cbRubric(it.kind,it),ik=it.ik,G=cbCols(),me=myId,mine=cbMine(ik),iSub=mine.sub,doc=cbItems[ik]||{},lk=doc.locked||null,edit=iSub&&cbEdit.has(ik)&&!lk;
  const subd=G.filter(u=>cbSub(u,ik)),cmp=!!lk||(iSub&&cbCompare.has(ik)),C=cbClaude(it);cbWatchRows(ik);cbNeedNames(G);cbSeen();setTimeout(cbPresence,0);
  const vis=u=>u===me?true:cmp?!!cbSub(u,ik):!!(iSub&&cbSub(u,ik)&&cbPeek.has(ik+"|"+u));
  const active=!lk&&(!iSub||edit),cols=G.length+(cmp?4:2);
  const rv=u=>!cmp&&iSub&&u!==me&&cbSub(u,ik)?`<button type="button" class="btn small cbpeek" data-cb="peek" data-u="${esc(u)}" aria-pressed="${cbPeek.has(ik+"|"+u)}">${cbPeek.has(ik+"|"+u)?"Hide":"Reveal"}</button>`:"";
  const head=`<tr><th scope="col">Criterion</th><th scope="col"><span class="cbcolh">${cbAv("claude")}Claude</span></th>${G.map(u=>`<th scope="col" class="${u===me?"me":cbPend(u)?"pend":""}" data-col="${esc(u)}"><span class="cbcolh">${cbAv(u)}${u===me?"You":esc(cbName(u))}${rv(u)}</span></th>`).join("")}${cmp?`<th scope="col">Spread</th><th scope="col">Agreed</th>`:""}</tr>`;
  let toSettle=0,allAgreed=true;const ag={};
  const rows=R.map(r=>{const k=ik+"|"+r.id,cv=C?C.marks[r.id]:null;
    const crit=it.kind==="chat"?`<button type="button" class="cbcrit" data-psrc="${r.id}" title="${esc(r.title)}" aria-expanded="${!!(typeof chPanel!=="undefined"&&chPanel&&chPanel.crit===r.id)}">${esc(r.label)}</button>`
      :`<button type="button" class="cbcrit" data-cb="panel" data-crit="${r.id}" title="${esc(r.title)}" aria-expanded="${!!(cbPanel&&cbPanel.crit===r.id)}">${esc(r.label)}</button>`;
    const cells=G.map(u=>{
      if(u===me&&active){const v=mine.marks[r.id],hn=!!String(mine.notes[r.id]||"").trim();
        return `<td class="me"><span class="cbpicks" role="group" aria-label="${esc(r.label)}">${cbOpts(r).map(x=>`<button type="button" class="cm ${chMarkCls(x,r.max)}" data-cb="pick" data-crit="${r.id}" data-v="${x}" aria-pressed="${String(v)===String(x)}">${x==="na"?"N/A":x}</button>`).join("")}</span><button type="button" class="cbnotebtn${hn?" has":""}" data-cb="note" data-crit="${r.id}" aria-expanded="${cbNoteOpen===k}">${hn?"Note ✓":"+ Note"}</button></td>`}
      const d=u===me?{marks:mine.marks,notes:mine.notes}:cbSub(u,ik);
      if(vis(u)&&d){const n=String((d.notes||{})[r.id]||"").trim();return `<td class="${u===me?"me":""}">${cbMk((d.marks||{})[r.id],r)}${n?`<span class="cbhasnote" title="${esc(n)}" aria-label="Has a note">✎</span>`:""}</td>`}
      if(cbPend(u))return `<td class="pend"><span class="cbhid">Hasn't opened it</span></td>`;
      return `<td><span class="cbhid">${cbSub(u,ik)?"✓ Scored":"Not yet"}</span></td>`});
    let extra="";
    if(cmp){const sp=cbSpread(subd.map(u=>((cbSub(u,ik)||{}).marks||{})[r.id])),a=cbAgreed(ik,r.id,subd);ag[r.id]=a;if(!a){allAgreed=false;toSettle++}
      const off=lk&&a&&C&&String(cv)!==String(a.mark);
      extra=`<td class="cbsp">${cbSpreadHtml(sp)}</td><td class="cbag">${a?cbMk(a.mark,r)+(off?`<span class="cboff">Claude off</span>`:""):lk?"–":`<button type="button" class="btn small" data-cb="row" data-crit="${r.id}">Settle</button>`}</td>`}
    const open=cmp&&cbOpen.has(k);let det="";
    if(open){const a=ag[r.id],S=cbSettle&&cbSettle.ik===ik&&cbSettle.crit===r.id?cbSettle:null;
      const cards=(C?[`<div class="cbnt"><header>${cbAv("claude")}Claude · ${cbMk(cv,r)}</header><p>${esc((C.why||{})[r.id]||"No reason given.")}</p>${cbCites(C,r.id).length?`<p class="cbcites num">${esc(cbCites(C,r.id).join(", "))}</p>`:""}</div>`]:[])
        .concat(subd.map(u=>{const d=cbSub(u,ik),n=String((d.notes||{})[r.id]||"").trim();return `<div class="cbnt${n?"":" empty"}"><header>${cbAv(u)}${u===me?"You":esc(cbName(u))} · ${cbMk((d.marks||{})[r.id],r)}</header><p>${esc(n||"No note.")}</p></div>`}));
      const pickV=S?S.mark:a?a.mark:null,noteV=S?S.note:a&&!a.auto?a.note:"";
      det=`<tr class="cbdet"><td colspan="${cols}"><div class="cbnotes">${cards.join("")}</div>${lk?(a&&a.note?`<p class="cbagwhy"><span class="lbl-sm">Agreed</span> ${esc(a.note)}</p>`:""):
        `<div class="cbagree"><span class="lbl-sm">Agreed</span><span class="cbpicks" role="group" aria-label="Agreed mark for ${esc(r.label)}">${cbOpts(r).map(x=>`<button type="button" class="cm ${chMarkCls(x,r.max)}" data-cb="apick" data-crit="${r.id}" data-v="${x}" aria-pressed="${pickV!=null&&String(pickV)===String(x)}">${x==="na"?"N/A":x}</button>`).join("")}</span>
          <textarea rows="1" data-cbag="${r.id}" aria-label="Why we agreed on ${esc(r.label)}">${esc(noteV)}</textarea><button type="button" class="btn primary" data-cb="asave" data-crit="${r.id}"${pickV==null?" disabled":""}>Save</button></div>`}</td></tr>`}
    if(active&&cbNoteOpen===k)det=`<tr class="cbdet"><td colspan="${cols}"><div class="cbmynote">${me?cbAv(me):""}<textarea rows="2" data-cbnote="${r.id}" aria-label="Your note on ${esc(r.label)}" placeholder="Why this mark">${esc(mine.notes[r.id]||"")}</textarea><button type="button" class="btn" data-cb="note" data-crit="${r.id}">Done</button></div></td></tr>`;
    return `<tr class="${cmp?"cbrow":""}${open?" open":""}" data-cb="${cmp?"row":"x"}" data-crit="${r.id}" id="cbr-${r.id}"><th scope="row" class="cbcritc">${crit}</th><td>${C?cbMk(cv,r):`<span class="cbmk na">–</span>`}</td>${cells.join("")}${extra}</tr>`+det}).join("");
  const agM=Object.fromEntries(R.map(r=>[r.id,ag[r.id]?ag[r.id].mark:null]));
  const pct=m=>{const p=cbPct(it.kind,m,it);return p==null?"–":fmt(p)+"%"};
  const tot=cmp?`<tfoot><tr><th scope="row">Score</th><td class="num">${C?pct(C.marks):"–"}</td>${G.map(u=>{const d=u===me?(iSub?mine:null):cbSub(u,ik);return `<td class="num${u===me?" me":""}">${d?pct(d.marks||{}):"–"}</td>`}).join("")}<td></td><td class="num" id="cbAgPct">${lk?fmt(lk.pct)+"%":allAgreed?pct(agM):"–"}</td></tr></tfoot>`:"";
  const dots=`<span class="cbdots">${G.map(u=>`<span class="cbdot ${cbColor(u)}${cbSub(u,ik)?" done":""}" title="${esc(cbName(u))}${cbSub(u,ik)?" · submitted":cbPend(u)?" · hasn't opened it":""}">${esc(cbIni(u))}</span>`).join("")}</span>`;
  const need=R.length,filled=cbDone(R,mine.marks);
  let status;
  if(lk)status=`<span><b>Agreed</b> ${esc(lrnDay(lk.at))} · locked by ${lk.by===me?"you":esc(cbName(lk.by))}. This is the score.</span><span class="r"><button type="button" class="btn" data-cb="reopen">Reopen</button></span>`;
  else if(!iSub)status=`<span><b class="num">${subd.length} of ${G.length}</b> submitted. Submit yours to reveal the others.</span>${dots}<span class="r"><span class="hint num" id="cbFilled">${filled}/${need}</span><button type="button" class="btn primary" data-cb="submit"${filled<need||!db?" disabled":""}>Submit my marks</button></span>`;
  else if(!cmp)status=`<span><b class="num">${subd.length} of ${G.length}</b> submitted.</span>${dots}<span class="r">${edit?`<button type="button" class="btn" data-cb="editdone">Done</button>`:`<button type="button" class="btn" data-cb="edit">Edit my marks</button>`}<button type="button" class="btn primary" data-cb="compare">Compare all</button></span>`;
  else status=`<span><b>Compare.</b> <span class="num" id="cbToSettle">${toSettle}</span> of ${need} rows to settle.</span>${dots}<span class="r"><button type="button" class="btn" data-cb="compare">Hide compare</button>${edit?`<button type="button" class="btn" data-cb="editdone">Done</button>`:`<button type="button" class="btn" data-cb="edit">Edit my marks</button>`}<button type="button" class="btn primary" data-cb="lock"${allAgreed&&!cbLockRun&&db?"":" disabled"}>Lock agreed score</button></span>`;
  const meta=`<div class="cbmeta"><span class="hint num">${it.n?`Week ${esc(weekLabel(it.week))} · ${it.i+1} of ${it.n}`:"Calibration"}</span><span data-cbhere="${esc(ik)}">${cbHereHtml(ik)}</span></div>`;
  return `<div class="cbgrid" id="cbGrid" data-ik="${esc(ik)}" data-stage="${lk?"agreed":cmp?"compare":iSub?"submitted":"scoring"}">${meta}<div class="cbstatus${lk?" agreed":""}" role="status">${status}</div>
    <div class="cbscroll"><table class="cbsc"><thead>${head}</thead><tbody>${rows}</tbody>${tot}</table></div>${lk?cbOutcome(it,R,C,lk,subd):""}</div>`}
function cbOutcome(it,R,C,lk,subd){const M=lk.marks||{},off=C?R.filter(r=>String(C.marks[r.id])!==String(M[r.id])):[];
  const per=subd.map(u=>{const d=cbSub(u,it.ik);return [u,R.filter(r=>String((d.marks||{})[r.id])===String(M[r.id])).length]});
  return `<div class="cbout">${C?`<div class="cboutc" id="cbSent"><h3>Sent to the coach</h3><ul>${off.length?off.map(r=>`<li>${esc(r.label)}: Claude ${esc(chMarkL(C.marks[r.id]))}, agreed ${esc(chMarkL(M[r.id]))}</li>`).join(""):"<li>Claude matched every agreed mark.</li>"}</ul></div>`:""}
    <div class="cboutc" id="cbWho"><h3>Who matched the agreed mark</h3><ul>${per.map(([u,n])=>`<li>${u===myId?"You":esc(cbName(u))}: ${n} of ${R.length}</li>`).join("")}${C?`<li>Claude: ${R.length-off.length} of ${R.length}</li>`:""}</ul></div></div>`}
/* repaint the grid in place, keeping focus and the caret */
function cbFocusKey(root){const f=document.activeElement;if(!f||!root||!root.contains(f))return null;const D=f.dataset||{};
  const sel=D.cbnote?`[data-cbnote="${D.cbnote}"]`:D.cbag?`[data-cbag="${D.cbag}"]`:D.cb?`[data-cb="${D.cb}"]${D.crit?`[data-crit="${D.crit}"]`:""}${D.v?`[data-v="${D.v}"]`:""}${D.u?`[data-u="${D.u}"]`:""}`:f.id?"#"+f.id:"";
  return sel?{sel,s:f.selectionStart,e:f.selectionEnd}:null}
function cbRefocus(root,k){if(!k)return;const g=root.querySelector(k.sel);if(!g)return;g.focus({preventScroll:true});if(k.s!=null&&g.setSelectionRange)try{g.setSelectionRange(k.s,k.e)}catch(e){}}
function cbPaint(){const el=$("#cbGrid");if(!el)return;const it=cbItemByIk(el.dataset.ik);if(!it)return;const box=el.parentNode,k=cbFocusKey(el);
  el.outerHTML=cbGridHtml(it);const n=$("#cbGrid");cbRefocus(n,k);if(box)cbPaintHere();cbPresence()}
function cbItemByIk(ik){ik=String(ik||"");const hit=cbRoundItems().find(x=>x.ik===ik);if(hit)return hit;
  if(ik.startsWith("chat_")){const c=chatBy(ik.slice(5));return cbItemFor(c)}if(ik.startsWith("call_"))return cbCallItem(ik.slice(5));return null}

/* ---------- actions ---------- */
function cbPick(it,crit,v){const ik=it.ik,s=cbSub(myId,ik);if((cbItems[ik]||{}).locked)return;
  const val=v==="na"?"na":Number(v);if(s){if(!cbEdit.has(ik))return;s.marks=Object.assign({},s.marks,{[crit]:val})}else{const d=cbDraftOf(ik);d.marks[crit]=val}
  cbSaveMine(ik);cbSeen();cbPaint()}
async function cbSubmit(it){const ik=it.ik,R=cbRubric(it.kind,it),d=cbDraftOf(ik);if(!db||!myId||cbDone(R,d.marks)<R.length)return;
  const at=new Date().toISOString(),doc={kind:it.kind,key:it.key,marks:clone(d.marks),notes:clone(d.notes),submittedAt:at,updatedAt:at};
  await cbSeen(true);
  try{await db.doc(`calibMarks/${myId}/items/${ik}`).set(doc);const m=cbMarks.get(myId)||new Map();m.set(ik,doc);cbMarks.set(myId,m);cbNoteOpen="";toast("Submitted. Reveal anyone who has submitted.")}
  catch(e){toast(e&&e.code==="invalid_argument"?"You can't save to this QA Desk.":"Couldn't submit. Try again.")}
  cbPaint();renderCalibTab()}
async function cbSaveRow(it,crit){const S=cbSettle;if(!db||!S||S.ik!==it.ik||S.crit!==crit||S.mark==null)return;
  const doc={mark:S.mark,note:String(S.note||"").trim(),by:myId||null,at:new Date().toISOString()};
  try{await db.doc(`calibItems/${it.ik}/rows/${crit}`).set(doc);cbRowsOf(it.ik)[crit]=doc;cbSettle=null;cbOpen.delete(it.ik+"|"+crit);toast("Saved")}catch(e){toast("Couldn't save. Try again.")}
  cbPaint()}
/* the reason a lesson carries: the agreed note; for an all-matched row, the graders' own notes */
function cbReason(ik,crit,a,subd){const n=String((a&&a.note)||"").trim();if(n&&n!=="All matched")return n;
  const ns=subd.map(u=>String((((cbSub(u,ik)||{}).notes)||{})[crit]||"").trim()).filter(Boolean);return ns.length?[...new Set(ns)].join(" · "):n}
async function cbLock(it){const ik=it.ik,R=cbRubric(it.kind,it),subd=cbGraderIds().filter(u=>cbSub(u,ik));if(!db||cbLockRun)return;
  const A={};for(const r of R){const a=cbAgreed(ik,r.id,subd);if(!a)return;A[r.id]=a}
  cbLockRun=true;cbPaint();
  try{const at=new Date().toISOString(),marks=Object.fromEntries(R.map(r=>[r.id,A[r.id].mark]));
    for(const r of R){const a=A[r.id];if(a.auto)await db.doc(`calibItems/${ik}/rows/${r.id}`).set({mark:a.mark,note:"All matched",by:myId||null,at})}
    const pct=cbPct(it.kind,marks,it),v=chatVerdict(pct),locked={by:myId||null,at,pct,verdict:v?v.id:null,marks};
    const doc=Object.assign({},cbItems[ik]||{},{kind:it.kind,key:it.key,round:it.round??null,locked});
    await db.doc("calibItems/"+ik).set(doc);cbItems[ik]=doc;
    let msg=`Locked ${v?v.label+" ":""}${fmt(pct)}%`;
    if(it.kind==="chat"){const x=await cbChatLocked(it,R,marks,A,subd,pct,v,at);msg+=x}
    else if(it.kind==="call")msg+=await cbCallLocked(it,R,marks,A,subd,at);
    toast(msg)}
  catch(e){toast(e&&e.code==="invalid_argument"?"You can't save to this QA Desk.":"Couldn't lock. Try again.")}
  finally{cbLockRun=false;cbRender(true)}}
/* a locked chat: every criterion where the panel moved Claude's mark is a contest lesson, a kept mark with a real reason a reinforce lesson;
   the review is the panel's, and the Learning round records the agreed score */
async function cbChatLocked(it,R,marks,A,subd,pct,v,at){const sid=it.key,c=chatBy(sid),a=chatAud[sid];if(!c||!a)return "";
  let n=0;
  for(const r of R){const cl=chClaudeMark(a,r.id),ag=marks[r.id],why=cbReason(it.ik,r.id,A[r.id],subd),id=`${sid}_${r.id}`;let doc=null;
    if(String(cl)!==String(ag))doc=Object.assign(chContestLesson(c,a,r.id,{from:chMk(cl,r.max),to:chMk(ag,r.max),reason:why||"All matched"}),{by:"panel",at});
    else{const an=String(A[r.id].note||"").trim();if(an&&an!=="All matched")doc=Object.assign(chReinforceLesson(c,a,r.id,an),{by:"panel",at})}
    if(doc){try{await db.doc(CH_LESSONS+"/"+id).set(doc);n++}catch(e){}}}
  const rec={sid,week:chWk(c),sa:c.sa||"",scores:clone(marks),pct,verdict:v?v.id:null,coaching:coachText(c,a,marks,{},{}),findings:{},contests:{},reinforce:{},reviewer:"Panel",panel:true,by:myId||null,at};
  try{await db.doc(chPath("reviews",rec.week,sid)).set(rec);chatRev[sid]=rec}catch(e){}
  let RD=null;try{RD=await lrnRecord(rec)}catch(e){}
  return (RD?` · Round ${RD.round}: ${(RD.results||[]).length} of ${(RD.sample||[]).length}`:"")+(n?` · ${n} lesson${n===1?"":"s"}`:"")}
async function cbReopen(it){const ik=it.ik;if(!db)return;
  try{const doc=Object.assign({},cbItems[ik]||{},{kind:it.kind,key:it.key,round:it.round??null,locked:null});await db.doc("calibItems/"+ik).set(doc);cbItems[ik]=doc;
    if(it.kind==="chat"){const sid=it.key,c=chatBy(sid);
      for(const l of chLessons.filter(x=>String(x.sid)===sid&&x.by==="panel")){try{await db.doc(CH_LESSONS+"/"+l.id).delete()}catch(e){}}
      const rv=chatRev[sid];if(rv&&rv.panel&&c){try{await db.doc(chPath("reviews",chWk(c),sid)).delete();delete chatRev[sid]}catch(e){}}}
    else if(it.kind==="call")await cbCallUnlock(it);
    toast("Reopened")}
  catch(e){toast("Couldn't reopen. Try again.")}
  cbRender(true)}
/* ---------- the draw: one round per week, 3 chats and 3 calls per SA (graded chats first; items not drawn before first) ---------- */
function cbShuffle(x){x=x.slice();for(let i=x.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[x[i],x[j]]=[x[j],x[i]]}return x}
/* every item drawn before: earlier rounds (any week, old call rounds too), Learning samples and marked chats */
function cbDrawnBefore(){const S=new Set();cbRounds.forEach(r=>(r.items||[]).forEach(x=>S.add((x.kind||r.kind||"call")+"|"+x.key)));
  lrnRounds().forEach(r=>(r.sample||[]).forEach(x=>S.add("chat|"+x.sid)));((lrnState&&lrnState.marked)||[]).forEach(x=>S.add("chat|"+x));return S}
/* the SAs: everyone with a gradable chat or a call this week, in roster order */
function cbDrawPool(w){const chatsW=chW.week===w?chatsOfWeek().filter(c=>chCanGrade(c)&&c.sa):[],callsW=(queueAll||[]).filter(q=>!q.removed&&q.week===w&&q.agent);
  return {chatsW,callsW,sas:chSaOrder(chatsW.map(c=>c.sa).concat(callsW.map(q=>q.agent)))}}
function cbPickN(L,key,prev,n){const sh=cbShuffle(L);return sh.filter(x=>!prev.has(key(x))).concat(sh.filter(x=>prev.has(key(x)))).slice(0,n)}
function cbDrawItems(w){const {chatsW,callsW,sas}=cbDrawPool(w),prev=cbDrawnBefore(),items=[];
  sas.forEach(sa=>{const mine=chatsW.filter(c=>c.sa===sa),g=mine.filter(c=>chatAud[c.sid]&&chatAud[c.sid].pct!=null),u=mine.filter(c=>!g.includes(c));
    let ch=cbPickN(g,c=>"chat|"+c.sid,prev,CB_PER);if(ch.length<CB_PER)ch=ch.concat(cbPickN(u,c=>"chat|"+c.sid,prev,CB_PER-ch.length));
    ch.sort((a,b)=>String(a.at||"").localeCompare(String(b.at||""))).forEach(c=>{const a=chatAud[c.sid];
      items.push({kind:"chat",key:String(c.sid),sa,restaurant:c.restaurant||"",at:c.at||"",aiPct:a&&a.pct!=null?a.pct:null})});
    cbPickN(callsW.filter(q=>q.agent===sa),q=>"call|"+q.id,prev,CB_PER).sort((a,b)=>String(a.callDate+a.callTime).localeCompare(String(b.callDate+b.callTime)))
      .forEach(q=>items.push({kind:"call",key:String(q.id),sa,restaurant:q.restaurantName||"",at:(q.callDate||"")+(q.callTime?"T"+q.callTime:"")}))});
  return {items,sas}}
const cbRoundStarted=items=>cbGraderIds().some(u=>items.some(it=>cbSub(u,it.ik)));
async function cbDraw(redo){if(!db||!amOwner||cbBusy)return;const w=week,cur=cbWeekRound(w);
  if(cur&&(!redo||cbRoundStarted(cbRoundItems(w))))return;
  if(chW.week!==w||!chatsReady||!queueReady){cbNote="Still loading this week. Try again in a moment.";renderCalib();return}
  const {items,sas}=cbDrawItems(w);cbNote="";
  if(!items.length){cbNote=`No chats or calls in ${weekLabel(w)} to draw.`;renderCalib();return}
  cbBusy=true;renderCalib();
  try{const at=new Date().toISOString(),doc={week:w,drawnAt:at,by:myId||null,items,sas};
    await db.doc("calibRounds/"+w).set(doc);
    const i=cbRounds.findIndex(r=>r.id===w);const d=Object.assign({},doc,{id:w});if(i>=0)cbRounds[i]=d;else cbRounds.push(d);
    await cbSyncLearning(w,items,at);cbRedraw=false}
  catch(e){cbNote=e&&e.code==="invalid_argument"?"You can't save to this QA Desk.":"Couldn't draw. Try again."}
  finally{cbBusy=false;renderCalib();renderChats()}}
/* the round's chats are the Learning round: an open round is marked "replaced" (kept), the new one lists the graded chats with Claude's marks at draw.
   Locking a chat records the panel's agreed score in it (cbChatLocked → lrnRecord) */
async function cbSyncLearning(w,items,at){const st=lrnState?clone(lrnState):{};
  const rounds=(st.rounds||[]).map(r=>r.status==="open"?Object.assign({},r,{status:"replaced",replacedAt:at}):r);
  const sample=items.filter(x=>x.kind==="chat").map(x=>{const a=chatAud[x.key];if(!a||a.pct==null||!a.grade||!a.grade.scores)return null;
    return {sid:x.key,sa:x.sa,restaurant:x.restaurant,aiPct:a.pct,aiVerdict:a.verdict||((chatVerdict(a.pct)||{}).id)||null,aiScores:clone(a.grade.scores),checkpoint:a.checkpoint||null}}).filter(Boolean);
  const cps=new Map();sample.forEach(x=>{if(x.checkpoint)cps.set(x.checkpoint,(cps.get(x.checkpoint)||0)+1)});sample.forEach(x=>delete x.checkpoint);
  const cp=[...cps.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0]||(brLatest()||{}).id||null;
  rounds.push({round:rounds.length+1,week:w,checkpoint:cp,drawnAt:at,status:"open",sample,results:[],verdictMatch:null,meanAbsDiff:null,pass:null});
  const doc=Object.assign({},st,{week:w,currentCheckpoint:cp||st.currentCheckpoint||null,target:st.target||lrnTarget(),marked:(st.marked||[]).map(String),rounds});
  await db.doc(LRN_DOC).set(doc);lrnState=doc}

/* ---------- expected graders (owner edits) ---------- */
function cbGrEditHtml(){if(!amOwner||!cbGrEdit)return "";
  return `<div class="cbgred" id="cbGrEd"><label class="lbl-sm" for="cbGrIn">Graders</label><input id="cbGrIn" type="text" autocomplete="off" spellcheck="false" value="${esc(cbGrDraft)}"><button type="button" class="btn primary" data-cb="grsave">Save</button><button type="button" class="btn" data-cb="graders">Cancel</button></div>`}
async function cbGrSave(){if(!db||!amOwner)return;const seen=new Set(),L=[];
  cbGrDraft.split(",").map(x=>x.trim().replace(/\s+/g," ")).filter(Boolean).forEach(x=>{const k=x.toLowerCase();if(!seen.has(k)&&L.length<12){seen.add(k);L.push(x.slice(0,40))}});
  const doc={expected:L,by:myId||null,at:new Date().toISOString()};
  try{await db.doc("settings/calibGraders").set(doc);cbExpectDoc=doc;cbGrEdit=false;toast("Saved")}catch(e){toast(e&&e.code==="invalid_argument"?"You can't save to this QA Desk.":"Couldn't save. Try again.")}
  cbRender()}

/* ---------- icons and labels ---------- */
const CB_IC={chat:`<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.5 3.5a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v6A1.5 1.5 0 0 1 12 11H7.2L4.5 13.6V11H4a1.5 1.5 0 0 1-1.5-1.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`,
  call:`<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M4.6 2.2h1.9l1 3-1.4 1a7.6 7.6 0 0 0 3.7 3.7l1-1.4 3 1v1.9a1.4 1.4 0 0 1-1.5 1.4A10.6 10.6 0 0 1 3.2 3.7a1.4 1.4 0 0 1 1.4-1.5z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`};
const cbKic=k=>`<span class="cbkic ${k}" role="img" aria-label="${k==="call"?"Call":"Chat"}">${CB_IC[k]}</span>`;
const cbKindL=q=>{q=q||{};return q.kind?String(q.kind):q.type==="mgr"?"MGR / DE":"CL"};
const cbDay=at=>{const d=String(at||"").slice(0,10);return /^\d{4}-\d\d-\d\d$/.test(d)?shortDate(d):""};
function cbLegs(q){q=q||{};const lc=liveChain(q.chain);if(lc&&lc.legs.length)return lc.legs;return q.callId?[{id:q.callId,at:(q.callDate||"")+"T"+(q.callTime||"00:00"),sec:q.durationSec,who:q.agent,own:true,graded:true}]:[]}
const cbTalk=q=>{const c=(q||{}).chain;return c&&c.talkSec!=null?c.talkSec:cbLegs(q).reduce((t,l)=>t+(Number(l.sec)||0),0)||(q||{}).durationSec||0};
/* the other people on a case: the legs taken by someone else from a team (SA, CRT, CSR) */
function cbTeam(q){return [...new Set(cbLegs(q).filter(l=>!isGraded(l)&&l.group&&GROUP_TAG[l.group]).map(l=>shortWho(l.who||"")).filter(Boolean))]}
/* what an item row says beside its title: Claude's score for a chat, the call type and length for a call */
function cbItemMeta(it){if(it.kind==="chat"){const a=chatAud[it.key],p=a&&a.pct!=null?a.pct:it.aiPct;return p==null?`<span class="tkmut">Claude –</span>`:`<span>Claude <b class="num">${esc(fmt(p))}%</b></span>`}
  const q=it.q||{},p=cbCGPct(it);
  return `<span>${esc(cbKindL(q))} · <span class="num">${esc(dur(cbTalk(q)))}</span> · ${p==null?`<span class="tkmut">Claude –</span>`:`Claude <b class="num">${esc(fmt(p))}%</b>`}</span>`}

/* ---------- the round checklist: the week's items by SA, my status on each, click to open (a navigation, so it goes on the Back stack) ---------- */
const CB_RST={agreed:"Agreed",done:"All in",wait:"Waiting on others",mine:"Yours to do"};
function cbRailState(it){if((cbItems[it.ik]||{}).locked)return "agreed";const C=cbCols();if(C.length&&C.every(u=>cbSub(u,it.ik)))return "done";return cbSub(myId,it.ik)?"wait":"mine"}
/* the round item for a chat (this week's round only) */
function cbRoundItem(c){if(!c)return null;const sid=String(c.sid),w=chWk(c);return cbChatItems().find(x=>x.key===sid&&x.week===w)||null}
const cbInRound=ik=>cbRoundItems().some(x=>x.ik===ik);
function cbBySa(L){const m=new Map();L.forEach(it=>{const k=it.sa||"–";if(!m.has(k))m.set(k,[]);m.get(k).push(it)});return [...m.entries()]}
const cbStatusHtml=(st,lk)=>`<span class="cbrst ${st}">${st==="agreed"?`Agreed <span class="num">${esc(fmt(lk.pct))}%</span>`:esc(CB_RST[st])}</span>`;
function cbRailHtml(cur){const L=cbRoundItems();if(!L.length)return "";
  const mine=L.filter(it=>cbSub(myId,it.ik)||(cbItems[it.ik]||{}).locked).length,sum=`<span class="num">${mine} of ${L.length}</span> done (you)`;
  const groups=cbBySa(L).map(([sa,l])=>`<li class="cbrgrp"><span class="cbrsa">${esc(sa)}</span><ol>${l.map(it=>{const st=cbRailState(it),lk=(cbItems[it.ik]||{}).locked,on=it.ik===cur;
    return `<li><button type="button" class="cbrrow${on?" cur":""}" data-cb="go" data-ik="${esc(it.ik)}" data-st="${st}" data-kind="${it.kind}"${on?' aria-current="true"':""}><span class="cbrmk ${st}" aria-hidden="true">${st==="agreed"?"✓":""}</span><span class="cbrt"><b>${cbKic(it.kind)}${esc(it.title)}</b><span>${esc(it.kind==="call"?cbKindL(it.q)+" call":"Chat")}${cbDay(it.at)?" · "+esc(cbDay(it.at)):""}</span></span>${cbStatusHtml(st,lk)}</button></li>`}).join("")}</ol></li>`).join("");
  return `<section class="cbrail" id="cbRail" data-open="${cbRailOpen?1:0}" aria-label="Round checklist"><button type="button" class="cbrtog" data-cb="railtog" aria-expanded="${cbRailOpen}" aria-controls="cbRailBody"><b>Round checklist</b><span class="cbrsum">${sum}</span><span class="cbrchev" aria-hidden="true">▾</span></button>
    <div class="cbrbody" id="cbRailBody"><header class="cbrhd"><b>Week ${esc(weekLabel(L[0].week))}</b><span id="cbRailDone">${sum}</span></header><ol class="cbrlist">${groups}</ol></div></section>`}
const cbRailBox=ik=>`<div class="cbrailbox" id="cbRailBox" data-ik="${esc(ik)}">${cbRailHtml(ik)}</div>`;
/* repaint in place when marks change (keeps focus on a row) */
function cbRailPaint(){const el=$("#view-"+tab+" #cbRailBox");if(!el)return;const h=cbRailHtml(el.dataset.ik);if(el._h===h)return;
  const f=document.activeElement,k=f&&el.contains(f)?(f.dataset.ik?`[data-ik="${f.dataset.ik}"]`:f.dataset.cb?`[data-cb="${f.dataset.cb}"]`:""):"";
  el.innerHTML=h;el._h=h;if(k){const g=el.querySelector(k);if(g)g.focus({preventScroll:true})}}
/* open a round item in the Audit tab */
function cbOpenItem(ik){const it=cbItemByIk(ik);if(!it)return;if(it.kind==="call")openCall(it.key,it.week);else openChat(it.key,it.week)}
const cbNextItem=L=>(L||cbRoundItems()).find(it=>!cbSub(myId,it.ik)&&!(cbItems[it.ik]||{}).locked)||null;

/* ---------- the Round tab ---------- */
function cbStats(items){const G=cbCols(),locked=items.filter(x=>(cbItems[x.ik]||{}).locked);
  let same=0,crit=0,cm=0,cn=0;const per=new Map(),dis=new Map();
  locked.forEach(it=>{const R=cbRubric(it.kind,it),M=cbItems[it.ik].locked.marks||{},subd=G.filter(u=>cbSub(u,it.ik)),C=cbClaude(it);
    R.forEach(r=>{const vals=subd.map(u=>((cbSub(u,it.ik)||{}).marks||{})[r.id]);if(vals.length){crit++;if(cbSpread(vals)===0||vals.length===1)same++}
      if(C&&C.marks[r.id]!==undefined){cn++;if(String(C.marks[r.id])===String(M[r.id]))cm++}
      subd.forEach(u=>{const p=per.get(u)||{n:0,m:0};p.n++;if(String(((cbSub(u,it.ik)||{}).marks||{})[r.id])===String(M[r.id]))p.m++;per.set(u,p)})})});
  items.forEach(it=>{const subd=G.filter(u=>cbSub(u,it.ik));if(subd.length<2)return;cbRubric(it.kind,it).forEach(r=>{const s=cbSpread(subd.map(u=>((cbSub(u,it.ik)||{}).marks||{})[r.id]));if(s==null)return;
    const k=it.kind+"|"+r.id,d=dis.get(k)||{label:r.label,n:0,d:0};d.n++;if(s!==0)d.d++;dis.set(k,d)})});
  const turn=items.filter(it=>!cbSub(myId,it.ik)&&!(cbItems[it.ik]||{}).locked).length,toSettle=items.filter(it=>cbStage(it)==="settle").length;
  return {G,n:items.length,locked:locked.length,toSettle,same:crit?same/crit*100:null,claude:cn?cm/cn*100:null,turn,per,split:dis.size>0,
    dis:[...dis.values()].filter(x=>x.d>0).map(x=>({label:x.label,n:x.n,p:x.d/x.n*100})).sort((a,b)=>b.p-a.p||a.label.localeCompare(b.label)).slice(0,6)}}
const cbBar=(lab,p,cls,id)=>`<div class="cbbar"${id?` data-g="${esc(id)}"`:""}>${lab}<span class="cbtrack"><span class="cbfill ${cls}" style="width:${p==null?0:Math.max(0,Math.min(100,p))}%"></span></span><span class="num">${p==null?"–":Math.round(p)+"%"}</span></div>`;
const cbP=p=>p==null?"–":Math.round(p)+"%";
const cbStageHtml=s=>s==="agreed"?`<span class="pill good">Agreed</span>`:s==="settle"?`<span class="pill ok">To settle</span>`:`<span class="pill none">Scoring</span>`;
function cbIRow(it,G){const st=cbStage(it);
  return `<li class="cbirow" data-ik="${esc(it.ik)}" data-kind="${it.kind}">${cbKic(it.kind)}<button type="button" class="cblink" data-cb="open" data-ik="${esc(it.ik)}">${esc(it.title)}</button>
    <span class="cbidate num">${esc(cbDay(it.at)||"–")}</span><span class="cbimeta">${cbItemMeta(it)}</span>
    <span class="cbdots">${G.map(u=>`<span class="cbdot ${cbColor(u)}${cbSub(u,it.ik)?" done":""}" title="${esc(cbName(u))}${cbSub(u,it.ik)?" · submitted":cbPend(u)?" · hasn't opened it":""}">${esc(cbIni(u))}</span>`).join("")}</span>${cbStageHtml(st)}</li>`}
function cbTabHtml(){const r=cbWeekRound(),items=cbRoundItems(),G=cbCols(),started=cbRoundStarted(items);cbCGLoadRound();
  const mine=items.filter(it=>cbSub(myId,it.ik)||(cbItems[it.ik]||{}).locked).length,nx=cbNextItem(items);
  const ctl=[];
  if(amOwner)ctl.push(`<button type="button" class="btn" data-cb="graders" id="cbGrBtn" aria-expanded="${cbGrEdit}">Graders</button>`);
  if(amOwner&&db){if(!r)ctl.push(`<button type="button" class="btn primary" data-cb="draw" id="cbDraw"${cbBusy?" disabled":""}>${cbBusy?"Drawing…":"Draw"}</button>`);
    else if(!started)ctl.push(`<button type="button" class="btn" data-cb="redraw" id="cbRedraw" aria-expanded="${cbRedraw}"${cbBusy?" disabled":""}>${cbBusy?"Drawing…":"Redraw"}</button>`)}
  if(amOwner&&r&&cbCanGrade()&&!cbGR){const ug=cbUngraded().length;if(ug)ctl.push(`<button type="button" class="btn" data-cb="gradeall" id="cbGradeAll"${typeof chatRun!=="undefined"&&chatRun?" disabled":""}>Grade the round's calls <span class="num">(${ug})</span></button>`)}
  if(nx)ctl.push(`<button type="button" class="btn primary" data-cb="continue" id="cbGo">${mine?"Continue":"Start"} →</button>`);
  const head=`<div class="cbhd"><div class="cbttl"><h2>Week ${esc(weekLabel(week))}</h2>${r?`<span class="num" id="cbSum">${items.length} items · you: ${mine} of ${items.length} done</span>`:""}</div><span class="cbhdr"><span data-cbhere="">${cbHereHtml("")}</span>${ctl.join("")}</span></div>${cbGrEditHtml()}`;
  const conf=cbRedraw&&r&&!started&&amOwner?`<div class="cbconfirm" id="cbRdConfirm" role="group" aria-label="Redraw"><span>Replace this week's ${items.length} items with a new draw?</span><button type="button" class="btn danger" data-cb="redrawgo" id="cbRdGo">Redraw</button><button type="button" class="btn" data-cb="redraw">Cancel</button></div>`:"";
  const note=cbNote?`<div class="cvnote" id="cbNote">${esc(cbNote)}</div>`:"";
  if(!r)return `<section class="panel cbsec" id="cbRound">${head}<div class="cbbd">${note}<p class="hint" id="cbNone">${!db?"Sign in to claude.ai to calibrate.":"No round for this week yet."}</p></div></section>`;
  cbNeedNames(G);
  /* who came up short: fewer than 3 chats or calls this week */
  const sas=(r.sas&&r.sas.length?r.sas:[...new Set(items.map(x=>x.sa))]);
  const short=sas.map(sa=>{const c=items.filter(x=>x.sa===sa&&x.kind==="chat").length,k=items.filter(x=>x.sa===sa&&x.kind==="call").length,p=[];
    if(c<CB_PER)p.push(`${c} of ${CB_PER} chats`);if(k<CB_PER)p.push(`${k} of ${CB_PER} calls`);return p.length?`<span data-sa="${esc(sa)}"><b>${esc(chFirst(sa))}</b> ${p.join(", ")}</span>`:""}).filter(Boolean);
  const filt=`<div class="cbfilt"><div class="cbseg" role="group" aria-label="Show">${[["all","All"],["chat","Chats"],["call","Calls"]].map(([v,l])=>`<button type="button" data-cb="filt" data-v="${v}" aria-pressed="${cbFilt===v}">${l}</button>`).join("")}</div>
    <button type="button" class="btn small cbmine" data-cb="mine" aria-pressed="${cbMineOnly}">Mine to do</button></div>`;
  const vis=it=>(cbFilt==="all"||it.kind===cbFilt)&&(!cbMineOnly||(!cbSub(myId,it.ik)&&!(cbItems[it.ik]||{}).locked));
  const groups=cbBySa(items).map(([sa,l])=>{const v=l.filter(vis);if(!v.length)return "";const d=l.filter(it=>cbSub(myId,it.ik)||(cbItems[it.ik]||{}).locked).length;
    return `<section class="cbsa" data-sa="${esc(sa)}"><h3><span>${esc(sa)}</span><span class="hint num">${d} of ${l.length} done (you)</span></h3><ol class="cbilist">${v.map(it=>cbIRow(it,G)).join("")}</ol></section>`}).join("");
  const S=cbStats(items),SC=cbStats(items.filter(x=>x.kind==="chat")),SK=cbStats(items.filter(x=>x.kind==="call"));
  const kpi=(id,k,v,sub)=>`<div class="cbkpi" id="${id}"><span class="lbl-sm">${k}</span><b class="num">${v}</b>${sub?`<span class="hint">${sub}</span>`:""}</div>`;
  const kpis=`<div class="cbkpis">${kpi("cbkAgreed","Agreed",`${S.locked} / ${S.n}`,`${chPl(SC.locked,"chat")} · ${chPl(SK.locked,"call")}${S.toSettle?` · ${S.toSettle} to settle`:""}`)}${kpi("cbkSame","Same mark, all graders",cbP(S.same),`chats ${cbP(SC.same)} · calls ${cbP(SK.same)}`)}
    ${kpi("cbkClaude","Claude vs agreed",cbP(S.claude),`chats ${cbP(SC.claude)} · calls ${cbP(SK.claude)}`)}${kpi("cbkTurn","Your turn",String(S.turn),"not submitted")}</div>`;
  const disL=(id,X)=>X.dis.length?`<div class="cbbars" id="${id}">${X.dis.map(x=>cbBar(`<span>${esc(x.label)}</span>`,x.p,x.p>=50?"hi":x.p<15?"lo":"")).join("")}</div>`:`<p class="hint" id="${id}">${X.split?"No splits yet.":"Needs two graders' marks."}</p>`;
  const dis=`<div><h3 class="evh">Where we disagree most</h3><h4 class="cbsub">Chats</h4>${disL("cbDisChat",SC)}<h4 class="cbsub">Calls</h4>${disL("cbDisCall",SK)}</div>`;
  const any=S.G.some(u=>S.per.get(u))||S.claude!=null;
  const gl=any?S.G.filter(u=>S.per.get(u)||cbPend(u)).map(u=>{const p=S.per.get(u);return cbBar(`<span class="cbcolh">${cbAv(u)}${u===myId?"You":esc(cbName(u))}</span>`,p?p.m/p.n*100:null,"lo",u)}):[];
  if(S.claude!=null)gl.push(cbBar(`<span class="cbcolh">${cbAv("claude")}Claude</span>`,S.claude,"lo","claude"));
  const each=`<div><h3 class="evh">Each grader vs the agreed mark</h3>${gl.length?`<div class="cbbars" id="cbEach">${gl.join("")}</div>`:`<p class="hint">Nothing agreed yet.</p>`}</div>`;
  return `<section class="panel cbsec" id="cbRound">${head}<div class="cbbd">${conf}${note}${cbRoundRunHtml()}${short.length?`<p class="cbshort" id="cbShort"><span class="lbl-sm">Short this week</span>${short.join("")}</p>`:""}${filt}
    <div class="cbgroups" id="cbItems">${groups||`<p class="hint">Nothing to do here.</p>`}</div>${kpis}<div class="cbtwo">${dis}${each}</div></div></section>`}

/* ---------- a call in the Audit tab: Ticket → Evidence → Scorecard → Coaching, like a chat ---------- */
let cbAuditSig="";
function cbTxBody(l){if(!l.id)return `<span class="hint">No recording id.</span>`;const t=txCache.get(String(l.id));
  if(t==null)return mcp?`<span class="hint">Loading…</span>`:`<span class="hint">Transcripts need Lightdash.</span>`;return t.trim()?esc(t):`<span class="hint">No transcript for this call.</span>`}
function cbTxHtml(q){const legs=cbLegs(q);if(!legs.length)return `<p class="tkmut">No recording.</p>`;
  return legs.map((l,i)=>`<section class="cbtxleg"><h4><span class="num idx">${i+1}</span><b>${esc(shortWho(l.who||"Unknown"))}</b><span class="num tkmut">${esc([l.at?clock12(String(l.at).slice(11,16)):"",l.sec?dur(l.sec):""].filter(Boolean).join(" · "))}</span>${l.id?`<a class="tklink tkrec" href="${esc(recUrl(l.id))}" target="_blank" rel="noopener">▶ Recording</a>`:""}</h4><div class="txtext" data-txid="${esc(l.id||"")}">${cbTxBody(l)}</div></section>`).join("")}
async function cbLoadTx(it){const legs=cbLegs(it.q).filter(l=>l.id).map(l=>({id:String(l.id),at:l.at}));if(!mcp||!legs.some(l=>!txCache.has(l.id)))return;
  try{await fetchTx(legs)}catch(e){legs.forEach(l=>{if(!txCache.has(l.id))txCache.set(l.id,"")})}
  document.querySelectorAll("#view-chat [data-txid]").forEach(el=>{const l=legs.find(x=>x.id===el.dataset.txid);if(l)el.innerHTML=cbTxBody(l)})}
function cbTicketHtml(it){const q=it.q||{},lk=(cbItems[it.ik]||{}).locked,v=lk?chatVerdict(lk.pct):null,legs=cbLegs(q),lc=liveChain(q.chain),team=cbTeam(q),T=validTasks(q.tasks)||[];
  const tab=(id,l,x)=>{const on=cbTkTab===id;return `<button type="button" role="tab" class="tktab" id="cbTkTab-${id}" data-cb="tk" data-v="${id}" aria-selected="${on}" aria-controls="cbTkPan-${id}" tabindex="${on?0:-1}">${l}${x||""}</button>`};
  const F=[["SA",esc(q.agent||it.sa||"–")],["Restaurant",`${esc(q.restaurantName||it.title||"–")}${q.restaurantId?` <span class="num tkcode">${esc(q.restaurantId)}</span>`:""}`],
    ["Called",`<span class="num">${esc([shortDate(q.callDate),clock12(q.callTime)].filter(Boolean).join(" · ")||"–")}</span>`],["Call type",`<span class="pill tp">${esc(cbKindL(q))}</span>`],
    ["Talk time",`<span class="num">${esc(dur(cbTalk(q)))}</span>`],["Linked calls",legs.length>1?`<span class="num">${legs.length} calls</span>${lc&&lc.hidden?` <span class="tkmut">+ ${lc.hidden} voicemail / no answer</span>`:""}`:`<span class="tkmut">Single call</span>`],
    ["Team",team.length?`Case with ${esc(team.join(", "))}`:`<span class="tkmut">Solo</span>`],["WIRA tasks",T.length?`<span class="num">${T.length}</span> linked`:`<span class="tkmut">None linked</span>`],
    ["Recordings",legs.filter(l=>l.id).length?`<span class="tkrecs">${legs.filter(l=>l.id).map((l,i)=>`<a href="${esc(recUrl(l.id))}" target="_blank" rel="noopener" class="tklink tkrec">▶ Call ${i+1}${l.sec?` <span class="num tkmut">(${esc(dur(l.sec))})</span>`:""}</a>`).join("")}</span>`:`<span class="tkmut">None linked</span>`]];
  const band=cbInRound(it.ik)?`<div class="lrband" id="tkRound"><b>Week ${esc(weekLabel(it.week))}</b><span>Round call · ${esc(chFirst(it.sa))}</span></div>`:"";
  return `${band}<header class="tkhd"><span class="qnum tknum"><span>1</span></span><div class="tkttl"><span class="tkkind sechd">QA ticket</span><span class="tkid">Call · ${esc(it.title)}</span></div>
    <div class="tkverd"><span class="tkword v-${esc(v?v.id:"")}" id="tkWord">${esc(v?v.label:"Not agreed yet")}</span><span class="tkpct num" id="tkPct">${lk?fmt(lk.pct)+"%":""}</span>${cbClScoreHtml(it,"tkClaude","tkcl")}</div></header>
    <div class="tktabs" role="tablist" aria-label="QA ticket">${tab("ticket","Ticket")}${tab("tx","Transcript",`<span class="count num">${legs.length}</span>`)}</div>
    <div class="tkbody" id="cbTkPan-ticket" role="tabpanel" aria-labelledby="cbTkTab-ticket"${cbTkTab==="ticket"?"":" hidden"}><dl class="tkgrid">${F.map(([k,v])=>`<div class="tkf"><dt>${k}</dt><dd>${v}</dd></div>`).join("")}</dl></div>
    <div class="tkchat cbtxpan" id="cbTkPan-tx" role="tabpanel" aria-labelledby="cbTkTab-tx" tabindex="0"${cbTkTab==="tx"?"":" hidden"}>${cbTxHtml(q)}</div>`}
/* "Claude's score 82.5%", or "Not graded yet" */
function cbClScoreHtml(it,id,cls){const p=cbCGPct(it),C=cbClaude(it);
  return `<span class="${cls}" id="${id}">${cbAv("claude")}<span>Claude's score</span>${C?`<b class="num">${p==null?"–":esc(fmt(p))+"%"}</b>`:`<span class="tkmut">${cbCG.has(String(it.key))||!db?"Not graded yet":"…"}</span>`}</span>`}
function cbBrief(q){const A=validAi(q.aiFacts),F=(A&&A.facts)||{},B=[];if(A&&A.summary)B.push(A.summary);
  Object.values(F.calls||{}).forEach(L=>(Array.isArray(L)?L:[]).forEach(x=>B.push(String(x))));
  if(B.length<2)(F.timeline||[]).forEach(t=>B.push([t.who,t.what].filter(Boolean).join(" ")));
  if(!B.length&&q.summary)B.push(String(q.summary));return [...new Set(B.filter(Boolean))].slice(0,5)}
function cbEvidenceHtml(it){const q=it.q||{},A=validAi(q.aiFacts),F=(A&&A.facts)||{},legs=cbLegs(q),T=validTasks(q.tasks)||[],SL=validSlack(q.slack)||[],O=Array.isArray(q.orders)?q.orders:[],br=cbBrief(q);
  const rows=legs.map((l,i)=>({ic:"▶",t:`Call ${i+1}`,s:[shortWho(l.who||""),l.at?clock12(String(l.at).slice(11,16)):"",l.sec?dur(l.sec):""].filter(Boolean).join(" · "),u:l.id?recUrl(l.id):"",l:"▶ Recording",k:"call"}))
    .concat(T.map(t=>({ic:"W",t:t.title||"WIRA task",s:[t.id,t.status].filter(Boolean).join(" · "),u:safeUrl(t.url)||wiraUrl(t.id),l:"Open ↗",k:"task"})))
    .concat(SL.map(t=>({ic:"#",t:"#"+(t.channel||"slack"),s:String(t.text||"").slice(0,90),u:safeUrl(t.url),l:"Open ↗",k:"slack"})))
    .concat(O.map(o=>({ic:"$",t:"Order "+(o.ticket||o.id||""),s:[o.total!=null?"$"+o.total:"",o.status].filter(Boolean).join(" · "),u:"",l:"",k:"order"})))
    .concat(q.link?[{ic:"G",t:"GreenDot",s:q.restaurantName||"",u:safeUrl(q.link),l:"Open ↗",k:"gd"}]:[]);
  const lc=validChain(q.chain),all=lc?lc.legs:legs;
  const full=`${lc&&liveChain(lc).legs.length>1?timelineHtml(liveChain(lc)):""}<h4 class="evh">Calls</h4>${legsList(all)}
    ${(F.timeline||[]).length?`<h4 class="evh">Timeline</h4><ol class="cbfacts">${F.timeline.map(t=>`<li><span class="num fid">${esc(t.id||"")}</span><span>${t.when?`<span class="num hint">${esc(t.when)}</span> `:""}<b>${esc(t.who||"")}</b> ${esc(t.what||"")}</span></li>`).join("")}</ol>`:""}
    ${T.length?`<h4 class="evh">WIRA tasks</h4><div class="cxbox">${T.map(t=>`<div class="task"><div class="thead"><a class="tid" href="${esc(safeUrl(t.url)||wiraUrl(t.id))}" target="_blank" rel="noopener">${esc(t.id)} ↗</a>${t.status?`<span>${esc(t.status)}</span>`:""}</div><div class="ttitle">${esc(t.title||"")}</div>${t.desc?`<div class="hint">${esc(t.desc)}</div>`:""}</div>`).join("")}</div>`:""}`;
  return `<div class="ev2"><div class="evwhat"><h3 class="evh">What happened</h3>${br.length?`<ul class="evbrief" id="cbEvBrief">${br.map(t=>`<li>${esc(t)}</li>`).join("")}</ul>`:`<p class="tkmut">No summary.</p>`}</div>
    <div class="evsrcs" id="cbEvSrcs"><h3 class="evh">Sources</h3>${rows.map(r=>`<div class="evrow" data-ek="${r.k}"><span class="evic" aria-hidden="true">${r.ic}</span><span class="evt"><b>${esc(r.t)}</b><span class="evs">${esc(r.s)}</span></span>${r.u?`<a class="evlink${r.k==="call"?" rec":""}" href="${esc(r.u)}" target="_blank" rel="noopener">${r.l}</a>`:""}</div>`).join("")}
      <button type="button" class="evmore" id="cbEvMore" data-cb="evmore" aria-expanded="${cbEvMore}" aria-controls="cbEvFull">Timeline and full sources</button></div></div>
    <div class="evfull" id="cbEvFull"${cbEvMore?"":" hidden"}>${full}</div>`}
/* coaching from the agreed marks: what went well (full-mark rows), one card per row below full marks with its agreed note */
function cbCoach(it){const lk=(cbItems[it.ik]||{}).locked;if(!lk)return null;const R=cbRubric(it.kind,it),M=lk.marks||{},rows=cbRowsOf(it.ik),subd=cbGraderIds().filter(u=>cbSub(u,it.ik));
  const well=R.filter(r=>String(M[r.id])===String(r.max)),fix=R.filter(r=>M[r.id]!=null&&M[r.id]!=="na"&&Number(M[r.id])<r.max)
    .map(r=>({r,m:M[r.id],why:cbReason(it.ik,r.id,rows[r.id]||null,subd)||String((r.lv||[])[Number(M[r.id])]||"")}));
  return {lk,well,fix}}
function cbCoachText(it){const C=cbCoach(it);if(!C)return "";const q=it.q||{},v=chatVerdict(C.lk.pct),L=[`${it.sa||q.agent||"SA"} · ${it.title} · ${[shortDate(q.callDate),clock12(q.callTime)].filter(Boolean).join(" ")}`,`Agreed ${fmt(C.lk.pct)}%${v?" "+v.label:""}`];
  if(C.well.length)L.push("","What went well",...C.well.map(x=>"- "+x.label));
  if(C.fix.length)L.push("","Next time",...C.fix.map(x=>`- ${x.r.label} (${x.m}/${x.r.max}): ${x.why}`));return L.join("\n")}
function cbCoachHtml(it){const C=cbCoach(it);if(!C)return cbClaude(it)?cbDraftHtml(it):`<p class="tkmut">Coaching comes from the agreed score.</p>`;const first=chFirst(it.sa)||"the SA";
  return `<h4 class="evh">What went well</h4>${C.well.length?`<div class="cbwell" id="cbWell">${C.well.map(r=>`<span class="cbwchip">${esc(r.label)}</span>`).join("")}</div>`:`<p class="tkmut">No row at full marks.</p>`}
    <h4 class="evh">Next time for ${esc(first)}</h4>${C.fix.length?`<div class="fixes" id="cbFixes">${C.fix.map(x=>`<article class="fixcard" data-fix="${esc(x.r.id)}"><header class="fixhd"><h4>${esc(x.r.label)}</h4><span class="cbmk ${chMarkCls(x.m,x.r.max)}">${esc(x.m)}/${x.r.max}</span></header><p>${esc(x.why||"No note.")}</p></article>`).join("")}</div>`:`<p class="tkmut">Nothing below full marks.</p>`}
    <div class="row coachbar"><button type="button" class="btn" data-cb="ccopy" id="cbCoachCopy">Copy all</button></div>`}
function cbBoardHtml(it){const q=it.q||{},lk=(cbItems[it.ik]||{}).locked,v=lk?chatVerdict(lk.pct):null;
  return `<aside class="panel board cverdict" id="chatBoard" aria-live="polite"><div class="vhead"><span class="lbl-sm">Call · ${esc(cbKindL(q))}</span>${lk?`<span class="pill solid ${chVB(lk.pct)}">Agreed</span>`:""}</div>
    ${lk?`<div class="vword v-${esc(v?v.id:"")}" id="cvWord">${esc(v?v.label:"–")}</div><div class="vpct"><span class="num" id="cvPct">${fmt(lk.pct)}%</span></div>`:`<div class="vword v-none" id="cvWord">Not agreed yet</div>`}
    <dl class="vmeta"><dt>SA</dt><dd>${esc(q.agent||it.sa||"–")}</dd><dt>Restaurant</dt><dd>${esc(q.restaurantName||"–")}</dd><dt>Called</dt><dd class="num">${esc([shortDate(q.callDate),clock12(q.callTime)].filter(Boolean).join(" · ")||"–")}</dd><dt>Claude</dt><dd id="cvClaude">${(()=>{const C=cbClaude(it),p=cbCGPct(it);return C?`<span class="num">${p==null?"–":esc(fmt(p))+"%"}</span>`:`<span class="tkmut">Not graded yet</span>`})()}</dd></dl>
    <div class="cbgbox" id="cbGradeBox">${cbGradeBoxHtml(it)}</div>
    ${safeUrl(q.link)?`<div class="row"><a class="btn" href="${esc(safeUrl(q.link))}" target="_blank" rel="noopener">GreenDot ↗</a></div>`:""}</aside>`}
function cbCallAudit(v,force){const it=cbCallItem(callSel);if(typeof chPanel!=="undefined"&&chPanel)chPanelClose();
  const lk=(cbItems[it?it.ik:""]||{}).locked,inR=it&&cbInRound(it.ik);
  if(it)cbCGWatch(it.key);const ck=String(callSel||"");
  const sig=JSON.stringify([callSel,week,!!it,it&&it.q&&chHash(it.q),lk&&lk.at,inR,cbTkTab,cbEvMore,it&&cbRowsOf(it.ik),queueReady,myId,amOwner,
    cbCG.has(ck),cbCGSig(cbCG.get(ck)),cbGR?cbGR.qid||"-":"",cbGRErr.get(ck)||"",cbCanGrade(),!!(typeof chatRun!=="undefined"&&chatRun)]);
  if(!force&&sig===cbAuditSig&&$("#view-chat #cbGrid")){chNavPaint();cbRailPaint();cbGRPaint();return}
  cbAuditSig=sig;const nav=`<nav class="cnav" id="chNav" aria-label="Audits">${chNavHtml()}</nav>`;
  if(!it){if(cbPanel)cbPanelClose();v.innerHTML=nav+`<div class="panel empty">${queueReady||!db?`Call ${esc(callSel)} isn't in the queue.`:"Loading…"} <button type="button" class="btn small" data-go="calib">Open the round</button></div>`;return}
  if(cbPanel&&cbPanel.ik!==it.ik)cbPanelClose();
  const pct=lk?lk.pct:null,vd=lk?chatVerdict(pct):null;
  const secs=[chSec("cs-ev",2,"Evidence",[cbKindL(it.q),cbLegs(it.q).length>1?cbLegs(it.q).length+" calls":"Single call"].join(" · "),cbEvidenceHtml(it),"ref"),
    chSec("cs-score",3,"Scorecard",lk?`Agreed · ${vd?vd.label+" · ":""}${fmt(pct)}%`:"Not agreed yet",cbGridHtml(it),lk?"done cbsc-sec":"cbsc-sec"),
    chSec("cs-coach",4,"Coaching",lk?"From the agreed score":cbClaude(it)?"Claude's draft":"After the agreed score",cbCoachHtml(it),lk?"done":"")];
  v.innerHTML=nav+`<div class="cdesk has-tk${inR?" has-rail":""}"><article class="panel qticket" id="cTicket" data-call="${esc(it.key)}" aria-label="QA ticket">${cbTicketHtml(it)}</article>${inR?`<div class="cside">${cbBoardHtml(it)}${cbRailBox(it.ik)}</div>`:cbBoardHtml(it)}<div class="ccol">${secs.join("")}</div></div>`;
  {const n=$("#chNav");if(n)n._h=chNavHtml();const rb=$("#cbRailBox");if(rb)rb._h=cbRailHtml(rb.dataset.ik)}
  if(cbTkTab==="tx")cbLoadTx(it);
  if(cbPanel&&cbPanelEl){v.append(cbPanelEl);const r=cbRubric("call",it).find(x=>x.id===cbPanel.crit);if(r)cbPanelEl.innerHTML=cbPanelHtml(it,r)}}

/* the call panel: the rubric item's levels, then the call's facts (or its transcript) */
function cbPanelHtml(it,r){const q=it.q||{},A=validAi(q.aiFacts),CL=cbClaude(it),GF=CL?cbFactList(CL.g.F):[],legs=cbLegs(q).filter(l=>l.id);
  const T=(A&&A.facts&&Array.isArray(A.facts.timeline)&&A.facts.timeline.length)?A.facts.timeline:GF.filter(f=>/^F/i.test(String(f.id)));
  const lv=[0,1,2,3].map(n=>`<li><b class="cbmk ${chMarkCls(n,3)}">${n}</b><span>${esc((r.lv||[])[n]||"")}</span></li>`).join("")+(r.na?`<li><b class="cbmk na">N/A</b><span>${esc(r.naText||"Doesn't apply")}</span></li>`:"");
  const cs=CL?cbCites(CL,r.id):[],cited=cs.map(id=>GF.find(f=>String(f.id)===id)||{id,what:"Not in Claude's facts"});
  const cl=`<div class="cbpcl" id="cbPClaude">${CL?`<p class="cbclline">${cbAv("claude")}<span>${cbClLine(CL,r.id)}</span></p>${cited.length?`<ol class="cbfacts cbcited">${cited.map(cbFactLi).join("")}</ol>`:""}`:`<p class="cbclline">${cbAv("claude")}<span class="tkmut">Claude: not graded yet</span></p>`}</div>`;
  const facts=cl+(T.length?`<ol class="cbfacts">${T.map(t=>cs.includes(String(t.id))?cbFactLi(t).replace("<li ",'<li class="cited" '):cbFactLi(t)).join("")}</ol>`
    :legs.length?`<div id="cbPTx">${legs.map(l=>`<div class="txtext" data-txid="${esc(l.id)}">${cbTxBody(l)}</div>`).join("")}</div>`:`<p class="tkmut">No facts or transcript.</p>`);
  return `<header class="chphd"><div class="chpttl"><span class="lbl-sm">Levels</span><h2 id="cbpTitle" tabindex="-1">${esc(r.label)}</h2></div><button type="button" class="chpx" data-cb="pclose" aria-label="Close">×</button></header>
    <section class="chpused"><p class="chpwhy">${esc(r.title)}</p><ol class="cblevels">${lv}</ol></section>
    <section class="chpview" aria-label="Facts"><div class="chpvh"><h3 class="chph">${T.length?"Facts":"Transcript"}</h3></div>${facts}</section>`}
function cbPanelOpen(it,crit){const r=cbRubric(it.kind,it).find(x=>x.id===crit);if(!r)return;
  if(cbPanel&&cbPanel.ik===it.ik&&cbPanel.crit===crit){cbPanelClose(true);return}
  cbPanel={ik:it.ik,crit};if(!cbPanelEl){cbPanelEl=document.createElement("aside");cbPanelEl.id="cbPanel";cbPanelEl.className="chpanel cbpanel";cbPanelEl.setAttribute("aria-labelledby","cbpTitle")}
  const v=$("#view-chat");if(v&&cbPanelEl.parentNode!==v)v.append(cbPanelEl);cbPanelEl.hidden=false;cbPanelEl.innerHTML=cbPanelHtml(it,r);document.body.classList.add("chp-on");
  if(!validAi((it.q||{}).aiFacts)&&mcp)cbLoadTx(it);
  const h=$("#cbpTitle");if(h)h.focus({preventScroll:true});document.querySelectorAll('#view-chat [data-cb="panel"]').forEach(b=>b.setAttribute("aria-expanded",String(b.dataset.crit===crit)))}
function cbPanelClose(refocus){if(!cbPanel)return;const P=cbPanel;cbPanel=null;if(cbPanelEl){cbPanelEl.hidden=true;cbPanelEl.innerHTML=""}
  if(!(typeof chPanel!=="undefined"&&chPanel))document.body.classList.remove("chp-on");
  document.querySelectorAll('#view-chat [data-cb="panel"]').forEach(b=>b.setAttribute("aria-expanded","false"));
  if(refocus){const b=$(`#view-chat [data-cb="panel"][data-crit="${P.crit}"]`);if(b)b.focus({preventScroll:true})}}
function renderCalibTab(){const st=$("#st-calib");if(!st)return;const n=cbRoundItems().filter(it=>!cbSub(myId,it.ik)&&!(cbItems[it.ik]||{}).locked).length;st.textContent=n?String(n):""}
function renderCalib(){cbPresence();renderCalibTab();if(cbPanel&&(tab!=="chat"||!callSel))cbPanelClose();const v=$("#view-calib");if(!v)return;
  if(tab!=="calib"){if(v.firstChild)v.innerHTML="";return}
  /* one grid in the page at a time: the hidden Audit lets go of its grid and checklist (it re-renders when it comes back) */
  const og=$("#view-chat #cbGrid"),orb=$("#view-chat #cbRailBox");if(og)og.remove();if(orb)orb.remove();if(og||orb){chatAuditSig="";cbAuditSig=""}
  cbSeen();const k=cbFocusKey(v);
  v.innerHTML=`<div class="cbtab">${cbTabHtml()}</div>`;cbRefocus(v,k)}

/* ---------- Claude on calls: grade docs, the grader run, lessons, the draft coaching ---------- */
const cbGradeFn=()=>typeof gradeCall==="function"?gradeCall:null;
const cbCGSig=d=>d?String(d.at||"")+"|"+String(d.by||""):"";
/* the open call's grade, live: switched only when the call changes */
function cbCGWatch(qid){qid=String(qid||"");if(!db||cbCGSub.qid===qid)return;if(cbCGSub.off)try{cbCGSub.off()}catch(e){}
  const S={qid,off:null};cbCGSub=S;if(!qid)return;
  S.off=db.doc(CG_ROOT+"/"+qid).onSnapshot(s=>{if(cbCGSub!==S)return;const d=s&&s.exists?(s.data()||null):null,was=cbCG.has(qid)?cbCGSig(cbCG.get(qid)):null;
    cbCG.set(qid,d);if(was!==cbCGSig(d))cbRender()},()=>{if(!cbCG.has(qid))cbCG.set(qid,null)})}
/* the round's call grades: one get() per call, once per draw (the Round tab's scores and KPIs) */
function cbCGLoadRound(){const r=cbWeekRound();if(!db||!r)return;const id=r.id+"|"+(r.drawnAt||"");if(cbCGRound===id)return;cbCGRound=id;
  const ids=cbCallItems().map(x=>String(x.key)).filter(k=>!cbCG.has(k));if(!ids.length)return;
  Promise.all(ids.map(k=>db.doc(CG_ROOT+"/"+k).get().then(s=>{if(!cbCG.has(k))cbCG.set(k,s&&s.exists?(s.data()||null):null)}).catch(()=>{}))).then(()=>cbRender())}
/* Claude's score on the live call rubric, like the graders' */
function cbCGPct(it){const C=cbClaude(it);return C?cbPct("call",C.marks,it):null}
const cbCites=(C,id)=>(C&&C.cites&&Array.isArray(C.cites[id])?C.cites[id]:[]).map(x=>String(x||"").trim()).filter(Boolean);
/* the facts in a grade's F: the timeline, claims and promises, each with its id */
function cbFactList(F){if(!F||typeof F!=="object")return [];const f=F.facts&&typeof F.facts==="object"?F.facts:F,A=k=>Array.isArray(f[k])?f[k]:[];
  return [].concat(Array.isArray(F)?F:[],A("timeline"),A("claims").map(c=>({id:c.id,when:"",who:"",what:c.claim||c.what||""})),A("promises").map(p=>({id:p.id,when:"",who:p.who||"",what:p.what||""})))
    .filter(x=>x&&x.id)}
const cbFactLi=t=>`<li data-fid="${esc(t.id||"")}"><span class="num fid">${esc(t.id||"")}</span><span>${t.when?`<span class="num hint">${esc(t.when)}</span> `:""}<b>${esc(t.who||"")}</b> ${esc(t.what||"")}</span></li>`;
const cbMarkL=v=>v==="na"?"N/A":v==null||v===""?"–":String(chMarkL(v));
/* "Claude: 2 · reason · F3, F7" */
function cbClLine(C,id){const why=String((C.why||{})[id]||"").trim(),cs=cbCites(C,id);
  return `<b>Claude: ${esc(cbMarkL(C.marks[id]))}</b>${why?` · ${esc(why)}`:""}${cs.length?` · <span class="num">${esc(cs.join(", "))}</span>`:""}`}
/* the run: one call at a time, a progress line, Stop. Claude is asked fresh (cache off) and never retried from code */
const CB_PASS={facts:"Writing down the facts",analysis:"Drawing conclusions",grade:"Grading",conclusions:"Drawing conclusions"};
function cbGRLine(){const r=cbGR;if(!r)return "";return [r.n>1?`Grading ${r.i} of ${r.n}`:"Grading",r.n>1?r.sa:"",r.n>1?r.title:"",r.step].filter(Boolean).join(" · ")}
function cbGRPaint(){if(!cbGR)return;document.querySelectorAll("[data-grline]").forEach(el=>{el.textContent=cbGRLine()})}
function cbGRMsg(e){const c=e&&e.code;if(c==="no_text")return "No transcript for this call yet.";if(e&&e.src==="ld")return pullErr(e,"Try again");
  if(e&&e.src==="db")return c==="invalid_argument"?"You can't save to this QA Desk.":c==="quota_exceeded"?"The QA Desk storage is full.":"Couldn't save. Try again.";
  if(c==="error")return "Something went wrong with this call"+(e.message?": "+String(e.message).slice(0,80):".");
  return aiErr(e)}
const cbCanGrade=()=>!!(cbGradeFn()&&db&&mcp&&sampleFn);
async function cbCallLessons(){if(!db)return [];try{const s=await db.collection(CL_ROOT).get();
  return s.docs.map(d=>Object.assign({},d.data(),{id:d.id})).sort((a,b)=>String(b.at||"").localeCompare(String(a.at||""))).slice(0,20)}catch(e){return []}}
async function cbGradeOne(it,ctl,lessons){const fn=cbGradeFn();if(!fn)throw {code:"error",src:"run"};
  const q=it.q||{},guard=()=>{if(ctl.signal.aborted)throw {code:"cancelled",src:"run"}},step=s=>{if(cbGR){cbGR.step=s;cbGRPaint()}};
  const all=cbLegs(q),legs=all.filter(l=>l.id).map(l=>({id:String(l.id),at:l.at}));
  step("Getting transcripts");
  try{await fetchTx(legs)}catch(e){throw chTag(e,"ld")}guard();
  const transcripts=Object.fromEntries(legs.map(l=>[l.id,String(txCache.get(l.id)||"")]));
  if(!Object.values(transcripts).some(t=>t.trim()))throw {code:"no_text",src:"run"};
  const items=itemsOf(CUR,cbCallType(it)),c=Object.assign(clone(q),{id:it.key,queueId:it.key,legs:all.map(l=>Object.assign({},l,{text:transcripts[String(l.id||"")]||""}))});
  const deps={transcripts,items,lessons,signal:ctl.signal,
    ask:async(prompt,pass)=>{guard();step(CB_PASS[pass]||"Asking Claude");try{return await sampleFn.json(prompt,{signal:ctl.signal,modelTier:"default",cache:false})}catch(e){throw chTag(e,"ai")}}};
  const R=await fn(c,deps);guard();
  const G=(R&&R.G)||{};if(!G.scores||typeof G.scores!=="object")throw {code:"ai_shape",src:"ai"};
  const ids=items.map(x=>x.id),pick=o=>Object.fromEntries(ids.filter(id=>o&&o[id]!==undefined).map(id=>[id,o[id]]));
  const doc=clone({v:G.v||(R&&R.v)||1,at:new Date().toISOString(),by:myId||null,items:ids,scores:pick(G.scores),reasons:pick(G.reasons),cites:pick(G.cites),
    wentWell:Array.isArray(G.wentWell)?G.wentWell:[],fixes:Array.isArray(G.fixes)?G.fixes:[],summary:String(G.summary||""),F:(R&&R.F)??null,A:(R&&R.A)??null});
  try{await db.doc(CG_ROOT+"/"+it.key).set(doc)}catch(e){throw chTag(e,"db")}
  cbCG.set(String(it.key),doc);cbGRErr.delete(String(it.key))}
async function cbGradeRun(list,one){if(cbGR||(typeof chatRun!=="undefined"&&chatRun)||!cbCanGrade()||!list.length)return;
  const ctl=new AbortController();cbGR={ctl,n:list.length,i:0,qid:"",sa:"",title:"",step:"",done:0,errs:0,one:!!one};cbGRNote=null;cbGRRefresh();
  let stop=null;
  try{const lessons=await cbCallLessons();
    for(let i=0;i<list.length;i++){if(ctl.signal.aborted)break;const it=list[i];Object.assign(cbGR,{i:i+1,qid:String(it.key),sa:it.sa||"",title:it.title||"",step:""});cbGRRefresh();
      try{await cbGradeOne(it,ctl,lessons);cbGR.done++}
      catch(e){if(ctl.signal.aborted||(e&&e.code==="cancelled"))break;const m=capText(cbGRMsg(e),160);
        if(chatIsAccess(e)){stop=m;cbGRErr.set(String(it.key),m);break}cbGR.errs++;cbGRErr.set(String(it.key),m)}}}
  finally{const r=cbGR;cbGR=null;
    cbGRNote=r.one?null:stop?{text:stop,err:true}:r.ctl.signal.aborted?{text:`Stopped · ${r.done} graded`}:{text:`Graded ${chPl(r.done,"call")}`+(r.errs?` · ${r.errs} couldn't be graded`:"")};
    cbGRRefresh()}}
function cbGRRefresh(){if(tab==="chat"&&callSel)renderChatAudit();if(tab==="calib")renderCalib()}
/* the round's calls Claude hasn't graded (read so far) */
const cbUngraded=()=>cbCallItems().filter(it=>cbCG.has(String(it.key))&&!cbCG.get(String(it.key)));
/* a locked call: a contest lesson where the panel moved Claude's mark, a reinforce lesson where it kept it and said why. callLessons/<queueId>_<crit> */
async function cbCallLocked(it,R,marks,A,subd,at){const C=cbClaude(it);if(!C||!db)return "";const q=it.q||{};let n=0;
  for(const r of R){const cl=C.marks[r.id],ag=marks[r.id];if(cl===undefined)continue;
    const an=String((A[r.id]&&A[r.id].note)||"").trim(),why=cbReason(it.ik,r.id,A[r.id],subd);
    const base={item:"call",queueId:String(it.key),week:it.week||q.week||"",sa:it.sa||q.agent||"",caseType:String(((C.g.A||{}).caseType)||cbCallType(it)),round:it.round??null,
      crit:r.id,label:r.label,type:"",what:String((C.why||{})[r.id]||""),by:"panel",at};let doc=null;
    if(String(cl)!==String(ag))doc=Object.assign({kind:"contest"},base,{from:chMk(cl,r.max),to:chMk(ag,r.max),reason:why||"All matched"});
    else if(an&&an!=="All matched")doc=Object.assign({kind:"reinforce"},base,{from:chMk(cl,r.max),to:chMk(cl,r.max),reason:an});
    if(doc){try{await db.doc(`${CL_ROOT}/${it.key}_${r.id}`).set(doc);n++}catch(e){}}}
  return n?` · ${chPl(n,"lesson")}`:""}
async function cbCallUnlock(it){if(!db)return;for(const r of cbRubric("call",it)){try{await db.doc(`${CL_ROOT}/${it.key}_${r.id}`).delete()}catch(e){}}}
/* before the lock, coaching starts from Claude's wentWell and fixes */
function cbDraftCoach(it){const C=cbClaude(it);if(!C)return null;const R=cbRubric("call",it),g=C.g;
  return {well:(g.wentWell||[]).map(x=>String(x||"").trim()).filter(Boolean),
    fix:(g.fixes||[]).filter(f=>f&&typeof f==="object").map(f=>({r:R.find(x=>x.id===f.id)||{id:String(f.id||""),label:String(f.id||""),max:3},m:C.marks[f.id],what:String(f.what||""),should:String(f.should||"")}))}}
function cbDraftText(it){const D=cbDraftCoach(it);if(!D)return "";const q=it.q||{},p=cbCGPct(it);
  const L=[`${it.sa||q.agent||"SA"} · ${it.title} · ${[shortDate(q.callDate),clock12(q.callTime)].filter(Boolean).join(" ")}`,`Claude's draft${p!=null?" "+fmt(p)+"%":""}`];
  if(D.well.length)L.push("","What went well",...D.well.map(x=>"- "+x));
  if(D.fix.length)L.push("","Next time",...D.fix.map(x=>`- ${x.r.label}${x.m!=null&&x.m!=="na"?` (${x.m}/${x.r.max})`:""}: ${x.what}${x.should?" "+x.should:""}`));return L.join("\n")}
function cbDraftHtml(it){const D=cbDraftCoach(it),first=chFirst(it.sa)||"the SA";
  return `<p class="cbdtag" id="cbDraftTag">${cbAv("claude")}<b>Claude's draft</b></p>
    <h4 class="evh">What went well</h4>${D.well.length?`<ul class="cbwlist" id="cbDWell">${D.well.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:`<p class="tkmut">Nothing listed.</p>`}
    <h4 class="evh">Next time for ${esc(first)}</h4>${D.fix.length?`<div class="fixes" id="cbDFixes">${D.fix.map(x=>`<article class="fixcard" data-fix="${esc(x.r.id)}"><header class="fixhd"><h4>${esc(x.r.label)}</h4>${x.m!=null?`<span class="cbmk ${chMarkCls(x.m,x.r.max)}">${esc(cbMarkL(x.m))}${x.m==="na"?"":"/"+x.r.max}</span>`:""}</header><p>${esc(x.what||"No note.")}</p>${x.should?`<p class="cbshould"><b>Do</b> ${esc(x.should)}</p>`:""}</article>`).join("")}</div>`:`<p class="tkmut">Nothing to fix.</p>`}
    <div class="row coachbar"><button type="button" class="btn" data-cb="ccopy" id="cbCoachCopy">Copy all</button></div>`}
/* the grade box on the board: Grade with Claude / Re-grade, or the run's progress and Stop */
function cbGradeBoxHtml(it){const k=String(it.key),g=cbCG.get(k),err=cbGRErr.get(k);
  if(cbGR&&cbGR.qid===k)return `<div class="cbgrun" id="cbGrRun" role="status"><span class="spin" aria-hidden="true"></span><span data-grline>${esc(cbGRLine())}</span><button type="button" class="btn small" data-cb="gstop" id="cbGrStop">Stop</button></div>`;
  const btn=cbCanGrade()?`<div class="row"><button type="button" class="btn${g?"":" primary"}" data-cb="grade" id="cbGradeBtn"${cbGR||(typeof chatRun!=="undefined"&&chatRun)?" disabled":""}>${g?"Re-grade":"Grade with Claude"}</button></div>`:"";
  return btn+(err?`<div class="cvnote" id="cbGrErr" role="alert">${esc(err)}</div>`:"")}
/* the Round tab: the owner grades the round's ungraded calls one after another */
function cbRoundRunHtml(){if(cbGR&&!cbGR.one)return `<div class="cbgrun" id="cbRoundRun" role="status"><span class="spin" aria-hidden="true"></span><span data-grline>${esc(cbGRLine())}</span><button type="button" class="btn small" data-cb="gstop" id="cbRoundStop">Stop</button></div>`;
  return cbGRNote?`<div class="cvnote${cbGRNote.err?"":" ok"}" id="cbRoundNote" role="status">${esc(cbGRNote.text)}</div>`:""}

/* ---------- events ---------- */
function cbGridItem(el){const g=el&&el.closest("#cbGrid");return g?cbItemByIk(g.dataset.ik):callSel&&tab==="chat"?cbCallItem(callSel):null}
document.addEventListener("click",e=>{const el=e.target.closest("[data-cb]");if(!el||!el.closest("#view-calib,#view-chat,#cbPanel"))return;const A=el.dataset.cb;
  if(A==="x")return;
  if(A==="row"&&el.tagName==="TR"&&e.target.closest("button,a,textarea,input"))return;
  const it=cbGridItem(el),crit=el.dataset.crit;
  switch(A){
    case "filt":cbFilt=["chat","call"].includes(el.dataset.v)?el.dataset.v:"all";renderCalib();return;
    case "mine":cbMineOnly=!cbMineOnly;renderCalib();return;
    case "draw":cbDraw(false);return;
    case "redraw":cbRedraw=!cbRedraw;renderCalib();if(cbRedraw){const b=$("#cbRdGo");if(b)b.focus()}return;
    case "redrawgo":cbDraw(true);return;
    case "continue":{const nx=cbNextItem();if(nx)cbOpenItem(nx.ik);return}
    case "open":case "go":{const ik=el.dataset.ik;if(!ik)return;const cur=cbItemOnScreen();if(tab==="chat"&&cur===ik)return;cbOpenItem(ik);return}
    case "back":navBack();return;
    case "railtog":cbRailOpen=!cbRailOpen;{const r=$("#cbRail"),b=r&&r.querySelector(".cbrtog");if(r)r.dataset.open=cbRailOpen?"1":"0";if(b)b.setAttribute("aria-expanded",String(cbRailOpen))}return;
    case "graders":if(!amOwner)return;cbGrEdit=!cbGrEdit;if(cbGrEdit)cbGrDraft=cbExpected().join(", ");renderCalib();if(cbGrEdit){const i=$("#cbGrIn");if(i)i.focus()}else{const b=$("#cbGrBtn");if(b)b.focus()}return;
    case "grsave":cbGrSave();return;
    case "tk":{cbTkTab=el.dataset.v==="tx"?"tx":"ticket";document.querySelectorAll('#cTicket [data-cb="tk"]').forEach(b=>{const on=b.dataset.v===cbTkTab;b.setAttribute("aria-selected",String(on));b.tabIndex=on?0:-1});
      const p=$("#cbTkPan-ticket"),x=$("#cbTkPan-tx");if(p)p.hidden=cbTkTab!=="ticket";if(x)x.hidden=cbTkTab!=="tx";if(cbTkTab==="tx"&&it)cbLoadTx(it);return}
    case "evmore":{cbEvMore=!cbEvMore;const f=$("#cbEvFull");if(f)f.hidden=!cbEvMore;el.setAttribute("aria-expanded",String(cbEvMore));return}
    case "ccopy":if(it)chClip((cbItems[it.ik]||{}).locked?cbCoachText(it):cbDraftText(it),"Copied");return;
    case "gstop":if(cbGR)cbGR.ctl.abort();return;
    case "gradeall":if(amOwner)cbGradeRun(cbUngraded(),false);return;
    case "pclose":cbPanelClose(true);return}
  if(!it)return;const ik=it.ik,k=ik+"|"+crit;
  switch(A){
    case "pick":cbPick(it,crit,el.dataset.v);break;
    case "note":cbNoteOpen=cbNoteOpen===k?"":k;cbPaint();{const t=document.querySelector(`[data-cbnote="${crit}"]`);if(t)t.focus()}break;
    case "peek":{const p=ik+"|"+el.dataset.u;if(cbPeek.has(p))cbPeek.delete(p);else cbPeek.add(p);cbPaint();break}
    case "submit":cbSubmit(it);break;
    case "edit":cbEdit.add(ik);cbPaint();break;
    case "editdone":cbEdit.delete(ik);cbNoteOpen="";{const p=`calibMarks/${myId}/items/${ik}`;if(cbW.has(p))cbFlush(p)}cbPaint();break;
    case "compare":if(cbCompare.has(ik))cbCompare.delete(ik);else cbCompare.add(ik);cbPaint();break;
    case "row":{if(cbOpen.has(k)){cbOpen.delete(k);if(cbSettle&&cbSettle.ik===ik&&cbSettle.crit===crit)cbSettle=null}else{cbOpen.add(k);const a=cbAgreed(ik,crit,cbGraderIds().filter(u=>cbSub(u,ik)));
      cbSettle={ik,crit,mark:a?a.mark:null,note:a&&!a.auto?a.note:""}}cbPaint();break}
    case "apick":if(!cbSettle||cbSettle.ik!==ik||cbSettle.crit!==crit){const a=cbAgreed(ik,crit,cbGraderIds().filter(u=>cbSub(u,ik)));cbSettle={ik,crit,mark:null,note:a&&!a.auto?a.note:""}}
      cbSettle.mark=el.dataset.v==="na"?"na":Number(el.dataset.v);cbPaint();break;
    case "asave":cbSaveRow(it,crit);break;
    case "lock":cbLock(it);break;
    case "reopen":cbReopen(it);break;
    case "panel":cbPanelOpen(it,crit);break;
    case "grade":if(it.kind==="call"){cbGRErr.delete(String(it.key));cbGradeRun([it],true)}break}});
document.addEventListener("input",e=>{const t=e.target;if(!t.dataset||!(t.dataset.cbnote||t.dataset.cbag))return;const it=cbGridItem(t);if(!it)return;
  if(t.dataset.cbag){const crit=t.dataset.cbag;if(!cbSettle||cbSettle.ik!==it.ik||cbSettle.crit!==crit)cbSettle={ik:it.ik,crit,mark:null,note:""};cbSettle.note=t.value;return}
  const crit=t.dataset.cbnote,s=cbSub(myId,it.ik);if(s){if(!cbEdit.has(it.ik))return;s.notes=Object.assign({},s.notes,{[crit]:t.value})}else cbDraftOf(it.ik).notes[crit]=t.value;
  cbSaveMine(it.ik);const b=document.querySelector(`#cbGrid [data-cb="note"][data-crit="${crit}"].cbnotebtn`);if(b){const h=!!t.value.trim();b.classList.toggle("has",h);b.textContent=h?"Note ✓":"+ Note"}});
document.addEventListener("input",e=>{if(e.target&&e.target.id==="cbGrIn")cbGrDraft=e.target.value});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target&&e.target.id==="cbGrIn"){e.preventDefault();cbGrSave()}});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&cbPanel&&!e.defaultPrevented){e.preventDefault();cbPanelClose(true)}});
