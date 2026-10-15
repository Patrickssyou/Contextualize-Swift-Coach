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
let cbKind="chat",cbCall=null,cbBusy=false,cbNote="",cbPeers=[],cbPresSig="",cbSeenAt=0,cbPanel=null,cbPanelEl=null,cbLockRun=false;
const CB_CALL_SHORT={"1a":"Opening spiel","1b":"Tone and dead air","1c":"Empathy and composure","1d":"Clear communication","2a":"Listened and gathered info","2b":"Root cause and fault",
  "2c":"Immediate resolution","2d":"Long-term solution","2e":"Ticket documented","3a":"Ownership","3b":"Self-serve coaching","3c":"Next steps"};
const CB_N=10;
/* who should grade: settings/calibGraders {expected:[names]} (owner edits); missing doc → these three */
const CB_EXPECT=["Pat","Howard","Li Qi"];
let cbExpectDoc=null,cbGrEdit=false,cbGrDraft="",cbRailOpen=false;

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
function cbRubric(kind){if(kind==="chat")return CHAT_RUBRIC.map(r=>({id:r.id,label:r.label,title:r.d||"",min:0,max:r.max,na:!!r.na}));
  const v2=itemsOf("v2","call");
  return itemsOf("v1","call").map(it=>({id:it.id,label:CB_CALL_SHORT[it.id]||it.label,title:it.label,min:1,max:3,na:!!((v2.find(x=>x.id===it.id)||{}).na),lv:it.lv,naText:(v2.find(x=>x.id===it.id)||{}).na||""}))}
/* the score the item's own scorecard computes: the chat score, or the call rubric calc */
function cbPct(kind,m){if(kind==="chat")return chatScore(m);const c=calc("v1","call",m||{});return c.total==null?null:Math.round(c.total*10)/10}
function cbChatItems(){const r=lrnLast();if(!r)return [];const w=lrnWeek();
  return (r.sample||[]).map((s,i)=>({kind:"chat",key:String(s.sid),ik:"chat_"+s.sid,week:w,round:r.round,i,n:(r.sample||[]).length,sa:s.sa||"",title:s.restaurant||"Chat "+s.sid,s}))}
function cbCallRound(){const L=cbRounds.filter(x=>x.kind==="call").sort((a,b)=>String(a.drawnAt||"").localeCompare(String(b.drawnAt||""))||String(a.id).localeCompare(String(b.id)));
  return L.length?Object.assign({},L[L.length-1],{n:L.length}):null}
function cbCallItems(){const r=cbCallRound();if(!r)return [];
  return (r.items||[]).map((x,i)=>{const q=(queueAll||[]).find(d=>String(d.id)===String(x.key))||null;
    return {kind:"call",key:String(x.key),ik:"call_"+x.key,round:r.n,i,n:(r.items||[]).length,sa:x.sa||(q&&q.agent)||"",title:q?(q.restaurantName||"Call "+(q.callId||x.key)):"Call "+x.key,q}})}
const cbItemsOf=kind=>kind==="call"?cbCallItems():cbChatItems();
/* a chat is under calibration when it is in the latest round (its week) or has a calibration item */
function cbItemFor(c){if(!c)return null;const sid=String(c.sid),hit=cbChatItems().find(x=>x.key===sid&&x.week===chWk(c));if(hit)return hit;
  const d=cbItems["chat_"+sid];return d?{kind:"chat",key:sid,ik:"chat_"+sid,week:chWk(c),round:d.round??null,sa:c.sa||"",title:c.restaurant||"Chat "+sid}:null}
const cbChatOn=c=>!!cbItemFor(c);
function cbItemOnScreen(){if(tab==="chat"){const c=chatSel&&chatBy(chatSel),it=cbItemFor(c);return it?it.ik:null}
  if(tab==="calib"&&cbCall){return "call_"+cbCall}return null}
/* Claude's marks and reasons: the chat's audit when it is loaded, else the marks at draw; calls aren't graded by Claude yet */
function cbClaude(it){if(it.kind!=="chat")return null;const a=chatAud[it.key],G=(a&&a.grade)||{};
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
  const R=cbRubric(it.kind),ik=it.ik,G=cbCols(),me=myId,mine=cbMine(ik),iSub=mine.sub,doc=cbItems[ik]||{},lk=doc.locked||null,edit=iSub&&cbEdit.has(ik)&&!lk;
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
      const cards=(C?[`<div class="cbnt"><header>${cbAv("claude")}Claude · ${cbMk(cv,r)}</header><p>${esc((C.why||{})[r.id]||"No reason given.")}</p></div>`]:[])
        .concat(subd.map(u=>{const d=cbSub(u,ik),n=String((d.notes||{})[r.id]||"").trim();return `<div class="cbnt${n?"":" empty"}"><header>${cbAv(u)}${u===me?"You":esc(cbName(u))} · ${cbMk((d.marks||{})[r.id],r)}</header><p>${esc(n||"No note.")}</p></div>`}));
      const pickV=S?S.mark:a?a.mark:null,noteV=S?S.note:a&&!a.auto?a.note:"";
      det=`<tr class="cbdet"><td colspan="${cols}"><div class="cbnotes">${cards.join("")}</div>${lk?(a&&a.note?`<p class="cbagwhy"><span class="lbl-sm">Agreed</span> ${esc(a.note)}</p>`:""):
        `<div class="cbagree"><span class="lbl-sm">Agreed</span><span class="cbpicks" role="group" aria-label="Agreed mark for ${esc(r.label)}">${cbOpts(r).map(x=>`<button type="button" class="cm ${chMarkCls(x,r.max)}" data-cb="apick" data-crit="${r.id}" data-v="${x}" aria-pressed="${pickV!=null&&String(pickV)===String(x)}">${x==="na"?"N/A":x}</button>`).join("")}</span>
          <textarea rows="1" data-cbag="${r.id}" aria-label="Why we agreed on ${esc(r.label)}">${esc(noteV)}</textarea><button type="button" class="btn primary" data-cb="asave" data-crit="${r.id}"${pickV==null?" disabled":""}>Save</button></div>`}</td></tr>`}
    if(active&&cbNoteOpen===k)det=`<tr class="cbdet"><td colspan="${cols}"><div class="cbmynote">${me?cbAv(me):""}<textarea rows="2" data-cbnote="${r.id}" aria-label="Your note on ${esc(r.label)}" placeholder="Why this mark">${esc(mine.notes[r.id]||"")}</textarea><button type="button" class="btn" data-cb="note" data-crit="${r.id}">Done</button></div></td></tr>`;
    return `<tr class="${cmp?"cbrow":""}${open?" open":""}" data-cb="${cmp?"row":"x"}" data-crit="${r.id}" id="cbr-${r.id}"><th scope="row" class="cbcritc">${crit}</th><td>${C?cbMk(cv,r):`<span class="cbmk na">–</span>`}</td>${cells.join("")}${extra}</tr>`+det}).join("");
  const agM=Object.fromEntries(R.map(r=>[r.id,ag[r.id]?ag[r.id].mark:null]));
  const pct=m=>{const p=cbPct(it.kind,m);return p==null?"–":fmt(p)+"%"};
  const tot=cmp?`<tfoot><tr><th scope="row">Score</th><td class="num">${C?pct(C.marks):"–"}</td>${G.map(u=>{const d=u===me?(iSub?mine:null):cbSub(u,ik);return `<td class="num${u===me?" me":""}">${d?pct(d.marks||{}):"–"}</td>`}).join("")}<td></td><td class="num" id="cbAgPct">${lk?fmt(lk.pct)+"%":allAgreed?pct(agM):"–"}</td></tr></tfoot>`:"";
  const dots=`<span class="cbdots">${G.map(u=>`<span class="cbdot ${cbColor(u)}${cbSub(u,ik)?" done":""}" title="${esc(cbName(u))}${cbSub(u,ik)?" · submitted":cbPend(u)?" · hasn't opened it":""}">${esc(cbIni(u))}</span>`).join("")}</span>`;
  const need=R.length,filled=cbDone(R,mine.marks);
  let status;
  if(lk)status=`<span><b>Agreed</b> ${esc(lrnDay(lk.at))} · locked by ${lk.by===me?"you":esc(cbName(lk.by))}. This is the score.</span><span class="r"><button type="button" class="btn" data-cb="reopen">Reopen</button></span>`;
  else if(!iSub)status=`<span><b class="num">${subd.length} of ${G.length}</b> submitted. Submit yours to reveal the others.</span>${dots}<span class="r"><span class="hint num" id="cbFilled">${filled}/${need}</span><button type="button" class="btn primary" data-cb="submit"${filled<need||!db?" disabled":""}>Submit my marks</button></span>`;
  else if(!cmp)status=`<span><b class="num">${subd.length} of ${G.length}</b> submitted.</span>${dots}<span class="r">${edit?`<button type="button" class="btn" data-cb="editdone">Done</button>`:`<button type="button" class="btn" data-cb="edit">Edit my marks</button>`}<button type="button" class="btn primary" data-cb="compare">Compare all</button></span>`;
  else status=`<span><b>Compare.</b> <span class="num" id="cbToSettle">${toSettle}</span> of ${need} rows to settle.</span>${dots}<span class="r"><button type="button" class="btn" data-cb="compare">Hide compare</button>${edit?`<button type="button" class="btn" data-cb="editdone">Done</button>`:`<button type="button" class="btn" data-cb="edit">Edit my marks</button>`}<button type="button" class="btn primary" data-cb="lock"${allAgreed&&!cbLockRun&&db?"":" disabled"}>Lock agreed score</button></span>`;
  const meta=`<div class="cbmeta"><span class="hint num">${it.round!=null?`Round ${esc(it.round)}`:"Calibration"}${it.n?` · ${it.kind} ${it.i+1} of ${it.n}`:""}</span><span data-cbhere="${esc(ik)}">${cbHereHtml(ik)}</span></div>`;
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
function cbItemByIk(ik){ik=String(ik||"");const all=cbChatItems().concat(cbCallItems()),hit=all.find(x=>x.ik===ik);if(hit)return hit;
  if(ik.startsWith("chat_")){const c=chatBy(ik.slice(5));return cbItemFor(c)}return null}

/* ---------- actions ---------- */
function cbPick(it,crit,v){const ik=it.ik,s=cbSub(myId,ik);if((cbItems[ik]||{}).locked)return;
  const val=v==="na"?"na":Number(v);if(s){if(!cbEdit.has(ik))return;s.marks=Object.assign({},s.marks,{[crit]:val})}else{const d=cbDraftOf(ik);d.marks[crit]=val}
  cbSaveMine(ik);cbSeen();cbPaint()}
async function cbSubmit(it){const ik=it.ik,R=cbRubric(it.kind),d=cbDraftOf(ik);if(!db||!myId||cbDone(R,d.marks)<R.length)return;
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
async function cbLock(it){const ik=it.ik,R=cbRubric(it.kind),subd=cbGraderIds().filter(u=>cbSub(u,ik));if(!db||cbLockRun)return;
  const A={};for(const r of R){const a=cbAgreed(ik,r.id,subd);if(!a)return;A[r.id]=a}
  cbLockRun=true;cbPaint();
  try{const at=new Date().toISOString(),marks=Object.fromEntries(R.map(r=>[r.id,A[r.id].mark]));
    for(const r of R){const a=A[r.id];if(a.auto)await db.doc(`calibItems/${ik}/rows/${r.id}`).set({mark:a.mark,note:"All matched",by:myId||null,at})}
    const pct=cbPct(it.kind,marks),v=chatVerdict(pct),locked={by:myId||null,at,pct,verdict:v?v.id:null,marks};
    const doc=Object.assign({},cbItems[ik]||{},{kind:it.kind,key:it.key,round:it.round??null,locked});
    await db.doc("calibItems/"+ik).set(doc);cbItems[ik]=doc;
    let msg=`Locked ${v?v.label+" ":""}${fmt(pct)}%`;
    if(it.kind==="chat"){const x=await cbChatLocked(it,R,marks,A,subd,pct,v,at);msg+=x}
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
    toast("Reopened")}
  catch(e){toast("Couldn't reopen. Try again.")}
  cbRender(true)}
async function cbDrawCalls(){if(!db||cbBusy)return;const w=week,pool=(queueAll||[]).filter(q=>!q.removed&&q.week===w).map(q=>Object.assign({},q,{sa:q.agent||""}));
  const drawn=new Set(cbRounds.filter(r=>r.kind==="call").flatMap(r=>(r.items||[]).map(x=>String(x.key))));
  let pick=lrnSpread(pool.filter(q=>!drawn.has(String(q.id))),CB_N);if(pick.length<CB_N)pick=pick.concat(lrnSpread(pool.filter(q=>drawn.has(String(q.id))),CB_N-pick.length));
  cbNote="";if(!pick.length){cbNote=`No calls in ${weekLabel(w)} to draw.`;renderCalib();return}
  cbBusy=true;renderCalib();
  try{const at=new Date().toISOString(),id="r"+Date.now().toString(36);
    await db.doc("calibRounds/"+id).set({kind:"call",week:w,items:pick.map(q=>({key:String(q.id),sa:q.agent||""})),drawnAt:at,by:myId||null});cbCall=null}
  catch(e){cbNote=e&&e.code==="invalid_argument"?"You can't save to this QA Desk.":"Couldn't draw. Try again."}
  finally{cbBusy=false;renderCalib()}}

/* ---------- expected graders (owner edits) ---------- */
function cbGrEditHtml(){if(!amOwner||!cbGrEdit)return "";
  return `<div class="cbgred" id="cbGrEd"><label class="lbl-sm" for="cbGrIn">Graders</label><input id="cbGrIn" type="text" autocomplete="off" spellcheck="false" value="${esc(cbGrDraft)}"><button type="button" class="btn primary" data-cb="grsave">Save</button><button type="button" class="btn" data-cb="graders">Cancel</button></div>`}
async function cbGrSave(){if(!db||!amOwner)return;const seen=new Set(),L=[];
  cbGrDraft.split(",").map(x=>x.trim().replace(/\s+/g," ")).filter(Boolean).forEach(x=>{const k=x.toLowerCase();if(!seen.has(k)&&L.length<12){seen.add(k);L.push(x.slice(0,40))}});
  const doc={expected:L,by:myId||null,at:new Date().toISOString()};
  try{await db.doc("settings/calibGraders").set(doc);cbExpectDoc=doc;cbGrEdit=false;toast("Saved")}catch(e){toast(e&&e.code==="invalid_argument"?"You can't save to this QA Desk.":"Couldn't save. Try again.")}
  cbRender()}

/* ---------- the round checklist: the round's items, my status on each, click to open (a navigation, so it goes on the Back stack) ---------- */
const CB_RST={agreed:"Agreed",done:"All in",wait:"Waiting on others",mine:"Yours to do"};
function cbRailState(it){if((cbItems[it.ik]||{}).locked)return "agreed";const C=cbCols();if(C.length&&C.every(u=>cbSub(u,it.ik)))return "done";return cbSub(myId,it.ik)?"wait":"mine"}
/* the round item for a chat: only the current round (a chat with an older calibration doc gets no checklist) */
function cbRoundItem(c){if(!c)return null;const sid=String(c.sid),w=chWk(c);return cbChatItems().find(x=>x.key===sid&&x.week===w)||null}
function cbRailHtml(kind,cur){const L=cbItemsOf(kind);if(!L.length)return "";
  const mine=L.filter(it=>cbSub(myId,it.ik)||(cbItems[it.ik]||{}).locked).length,sum=`<span class="num">${mine} of ${L.length}</span> done (you)`;
  const rows=L.map(it=>{const st=cbRailState(it),lk=(cbItems[it.ik]||{}).locked,on=it.ik===cur;
    return `<li><button type="button" class="cbrrow${on?" cur":""}" data-cb="go" data-ik="${esc(it.ik)}" data-st="${st}"${on?' aria-current="true"':""}><span class="cbrmk ${st}" aria-hidden="true">${st==="agreed"?"✓":""}</span><span class="cbrt"><b>${esc(it.title)}</b><span>${esc(chFirst(it.sa)||"–")}</span></span><span class="cbrst ${st}">${st==="agreed"?`Agreed <span class="num">${esc(fmt(lk.pct))}%</span>`:esc(CB_RST[st])}</span></button></li>`}).join("");
  return `<section class="cbrail" id="cbRail" data-open="${cbRailOpen?1:0}" aria-label="Round checklist"><button type="button" class="cbrtog" data-cb="railtog" aria-expanded="${cbRailOpen}" aria-controls="cbRailBody"><b>Round checklist</b><span class="cbrsum">${sum}</span><span class="cbrchev" aria-hidden="true">▾</span></button>
    <div class="cbrbody" id="cbRailBody"><header class="cbrhd"><b>Round ${esc(L[0].round)} · ${kind==="call"?"calls":"chats"}</b><span id="cbRailDone">${sum}</span></header><ol class="cbrlist">${rows}</ol></div></section>`}
const cbRailBox=(kind,ik)=>`<div class="cbrailbox" id="cbRailBox" data-kind="${kind}" data-ik="${esc(ik)}">${cbRailHtml(kind,ik)}</div>`;
/* repaint in place when marks change (keeps focus on a row) */
function cbRailPaint(){const el=$("#view-"+tab+" #cbRailBox");if(!el)return;const h=cbRailHtml(el.dataset.kind,el.dataset.ik);if(el._h===h)return;
  const f=document.activeElement,k=f&&el.contains(f)?(f.dataset.ik?`[data-ik="${f.dataset.ik}"]`:f.dataset.cb?`[data-cb="${f.dataset.cb}"]`:""):"";
  el.innerHTML=h;el._h=h;if(k){const g=el.querySelector(k);if(g)g.focus({preventScroll:true})}}

/* ---------- the Calibration tab ---------- */
function cbStats(items){const kind=cbKind,R=cbRubric(kind),G=cbCols(),locked=items.filter(x=>(cbItems[x.ik]||{}).locked);
  let same=0,crit=0,cm=0,cn=0;const per=new Map(),dis={};R.forEach(r=>dis[r.id]={n:0,d:0});
  locked.forEach(it=>{const M=cbItems[it.ik].locked.marks||{},subd=G.filter(u=>cbSub(u,it.ik)),C=cbClaude(it);
    R.forEach(r=>{const vals=subd.map(u=>((cbSub(u,it.ik)||{}).marks||{})[r.id]);if(vals.length){crit++;if(cbSpread(vals)===0||vals.length===1)same++}
      if(C&&C.marks[r.id]!==undefined){cn++;if(String(C.marks[r.id])===String(M[r.id]))cm++}
      subd.forEach(u=>{const p=per.get(u)||{n:0,m:0};p.n++;if(String(((cbSub(u,it.ik)||{}).marks||{})[r.id])===String(M[r.id]))p.m++;per.set(u,p)})})});
  items.forEach(it=>{const subd=G.filter(u=>cbSub(u,it.ik));if(subd.length<2)return;R.forEach(r=>{const s=cbSpread(subd.map(u=>((cbSub(u,it.ik)||{}).marks||{})[r.id]));if(s==null)return;dis[r.id].n++;if(s!==0)dis[r.id].d++})});
  const turn=items.filter(it=>!cbSub(myId,it.ik)&&!(cbItems[it.ik]||{}).locked).length,toSettle=items.filter(it=>cbStage(it)==="settle").length;
  return {R,G,n:items.length,locked:locked.length,toSettle,same:crit?same/crit*100:null,claude:cn?cm/cn*100:null,turn,per,
    split:R.some(r=>dis[r.id].n),dis:R.map(r=>({r,n:dis[r.id].n,p:dis[r.id].n?dis[r.id].d/dis[r.id].n*100:null})).filter(x=>x.n&&x.p>0).sort((a,b)=>b.p-a.p||a.r.label.localeCompare(b.r.label)).slice(0,6)}}
const cbBar=(lab,p,cls,id)=>`<div class="cbbar"${id?` data-g="${esc(id)}"`:""}>${lab}<span class="cbtrack"><span class="cbfill ${cls}" style="width:${p==null?0:Math.max(0,Math.min(100,p))}%"></span></span><span class="num">${p==null?"–":Math.round(p)+"%"}</span></div>`;
function cbTabHtml(){const kind=cbKind,items=cbItemsOf(kind),S=cbStats(items);
  const r=kind==="chat"?lrnLast():cbCallRound(),open=kind==="chat"?!!lrnOpenRound():items.some(it=>!(cbItems[it.ik]||{}).locked);
  const canDraw=!!db&&!cbBusy&&!(kind==="chat"&&lrnBusy)&&!open;
  const seg=`<div class="cbseg" role="group" aria-label="Items">${[["chat","Chats"],["call","Calls"]].map(([v,l])=>`<button type="button" data-cb="kind" data-v="${v}" aria-pressed="${kind===v}">${l}</button>`).join("")}</div>`;
  const head=`<div class="cbhd">${seg}<h2>${r?`Round ${esc(kind==="chat"?r.round:r.n)}`:"No round yet"}</h2><span class="hint">${CB_N} drawn at random, spread across the SAs</span><span class="cbhdr"><span data-cbhere="">${cbHereHtml("")}</span>${amOwner?`<button type="button" class="btn" data-cb="graders" id="cbGrBtn" aria-expanded="${cbGrEdit}">Graders</button>`:""}<button type="button" class="btn primary" data-cb="draw" id="cbDraw"${canDraw?"":" disabled"}>${cbBusy||(kind==="chat"&&lrnBusy)?"Drawing…":"Draw next "+CB_N}</button></span></div>${cbGrEditHtml()}`;
  const note=cbNote||(kind==="chat"&&lrnNote)?`<div class="cvnote">${esc(cbNote||lrnNote)}</div>`:"";
  if(!items.length)return `<section class="panel cbsec" id="cbRound">${head}<div class="cbbd">${note}<p class="hint">${!db?"Sign in to claude.ai to calibrate.":kind==="chat"?"Draw 10 graded chats to start.":`Draw 10 calls from ${esc(weekLabel(week))}.`}</p></div></section>`;
  cbNeedNames(S.G);
  const kpi=(id,k,v,sub)=>`<div class="cbkpi" id="${id}"><span class="lbl-sm">${k}</span><b class="num">${v}</b>${sub?`<span class="hint">${sub}</span>`:""}</div>`;
  const kpis=`<div class="cbkpis">${kpi("cbkAgreed","Agreed",`${S.locked} / ${S.n}`,S.toSettle?`${S.toSettle} to settle`:"")}${kpi("cbkSame","Same mark, all graders",S.same==null?"–":Math.round(S.same)+"%","on agreed items")}
    ${kpi("cbkClaude","Claude vs agreed",kind==="call"?"–":S.claude==null?"–":Math.round(S.claude)+"%",kind==="call"?"calls aren't graded by Claude yet":"criteria matched")}${kpi("cbkTurn","Your turn",String(S.turn),"items you haven't submitted")}</div>`;
  const dis=`<div><h3 class="evh">Where we disagree most</h3>${S.dis.length?`<div class="cbbars" id="cbDis">${S.dis.map(x=>cbBar(`<span>${esc(x.r.label)}</span>`,x.p,x.p>=50?"hi":x.p<15?"lo":"")).join("")}</div>`:`<p class="hint">${S.split?"No splits yet.":"Needs two graders' marks."}</p>`}</div>`;
  /* pending graders sit in the list as empty bars once anything is agreed */
  const any=S.G.some(u=>S.per.get(u))||(kind==="chat"&&S.claude!=null);
  const gl=any?S.G.filter(u=>S.per.get(u)||cbPend(u)).map(u=>{const p=S.per.get(u);return cbBar(`<span class="cbcolh">${cbAv(u)}${u===myId?"You":esc(cbName(u))}</span>`,p?p.m/p.n*100:null,"lo",u)}):[];
  if(kind==="chat"&&S.claude!=null)gl.push(cbBar(`<span class="cbcolh">${cbAv("claude")}Claude</span>`,S.claude,"lo","claude"));
  const each=`<div><h3 class="evh">Each grader vs the agreed mark</h3>${gl.length?`<div class="cbbars" id="cbEach">${gl.join("")}</div>`:`<p class="hint">Nothing agreed yet.</p>`}</div>`;
  const stg=s=>s==="agreed"?`<span class="pill good">Agreed</span>`:s==="settle"?`<span class="pill ok">To settle</span>`:`<span class="pill none">Scoring</span>`;
  const list=`<div class="cbscroll"><table class="cblist" id="cbItems"><thead><tr><th scope="col">Item</th><th scope="col" class="cbty">Type</th><th scope="col">SA</th><th scope="col">Scored</th><th scope="col">Stage</th></tr></thead><tbody>${items.map(it=>{const q=it.q||{};
    const type=it.kind==="chat"?"Chat":q.kind==="CL"?"CL call":q.type==="mgr"?"MGR / DE":"Call";
    return `<tr data-ik="${esc(it.ik)}"><td><button type="button" class="cblink" data-cb="open" data-ik="${esc(it.ik)}">${esc(it.title)}</button></td><td class="cbty">${type}</td><td>${esc(it.sa||"–")}</td>
      <td><span class="cbdots">${S.G.map(u=>`<span class="cbdot ${cbColor(u)}${cbSub(u,it.ik)?" done":""}" title="${esc(cbName(u))}${cbSub(u,it.ik)?" · submitted":cbPend(u)?" · hasn't opened it":""}">${esc(cbIni(u))}</span>`).join("")}</span></td><td>${stg(cbStage(it))}</td></tr>`}).join("")}</tbody></table></div>`;
  return `<section class="panel cbsec" id="cbRound">${head}<div class="cbbd">${note}${kpis}<div class="cbtwo">${dis}${each}</div>${list}</div></section>`}
/* a call item, inline: a compact ticket, the evidence, the grid */
function cbCallHtml(it){const q=it.q||{},A=validAi(q.aiFacts),legs=cbCallLegs(q),T=(A&&A.facts&&Array.isArray(A.facts.timeline))?A.facts.timeline:[];
  const type=q.kind==="CL"?"CL call":q.type==="mgr"?"MGR / DE":"Call",brief=[A&&A.summary,...T.slice(0,4).map(t=>[t.who,t.what].filter(Boolean).join(" "))].filter(Boolean).slice(0,5);
  const tx=legs.filter(l=>l.id);
  return `<div class="cbcallnav"><button type="button" class="btn small cnavback" data-cb="back">← ${esc(navBackLabel())}</button></div>
   <div class="cbcallgrid"><div class="cbcallmain"><article class="panel cbcall" id="cbCall" aria-label="Call"><div class="cbtk"><div><span class="lbl-sm">Call · ${esc(shortDate(q.callDate)||"–")}${q.callTime?" · "+esc(clock12(q.callTime)):""}</span><h2>${esc(it.title)}</h2>
     <div class="cbtkmeta"><span>${esc(q.agent||it.sa||"–")}</span>${q.restaurantId?`<span class="num">${esc(q.restaurantId)}</span>`:""}<span class="pill tp">${esc(type)}</span>${q.chain&&q.chain.count>1?`<span class="num">${q.chain.count} legs</span>`:""}</div></div>
     <div class="cbverd">${cbVerdHtml(it)}</div></div>
    <div class="cbev"><div><h3 class="evh">What happened</h3>${brief.length?`<ul class="evbrief" id="cbBrief">${brief.map(b=>`<li>${esc(b)}</li>`).join("")}</ul>`:`<p class="hint">No facts read for this call yet.</p>`}</div>
     <div class="cbsrcs"><h3 class="evh">Sources</h3>${legs.map((l,i)=>`<div class="evrow"><span class="evic" aria-hidden="true">▶</span><span class="evt"><b>Call ${i+1}</b><span class="num">${esc([l.who,l.at?clock12(String(l.at).slice(11,16)):"",l.sec?dur(l.sec):""].filter(Boolean).join(" · "))}</span></span>${l.id?`<a href="${esc(recUrl(l.id))}" target="_blank" rel="noopener">▶ Recording</a>`:""}</div>`).join("")||`<p class="hint">No recording.</p>`}
      ${q.link?`<div class="evrow"><span class="evic" aria-hidden="true">G</span><span class="evt"><b>GreenDot</b><span>${esc(q.restaurantName||"")}</span></span><a href="${esc(safeUrl(q.link)||"#")}" target="_blank" rel="noopener">Open ↗</a></div>`:""}
      ${tx.length?`<details class="cbtx" data-cbtx="${esc(it.ik)}"><summary>Transcript</summary><div class="txtext" id="cbTx">${cbTxBody(tx)}</div></details>`:""}</div></div></article>
   <section class="qsec cbcallsc" aria-label="Scorecard"><div class="qhd"><span class="qnum"><span>3</span></span><span class="qttl">Scorecard</span><span class="qans">${esc(cbStage(it)==="agreed"?"Agreed":"")}</span></div><div class="qbody cbqbody">${cbGridHtml(it)}</div></section></div>${cbRailBox("call",it.ik)}</div>`}
function cbVerdHtml(it){const lk=(cbItems[it.ik]||{}).locked;if(!lk)return `<span class="lbl-sm">Score</span><span class="cbhid">Not agreed yet</span>`;const v=chatVerdict(lk.pct);
  return `<span class="lbl-sm">Agreed score</span><b class="num cbbig">${fmt(lk.pct)}%</b><span class="hint">${esc(v?v.label:"")}</span>`}
function cbCallLegs(q){const L=((q.chain&&q.chain.legs)||[]).filter(l=>l.own||l.graded||l.sampled);if(L.length)return L;return q.callId?[{id:q.callId,at:(q.callDate||"")+"T"+(q.callTime||"00:00"),sec:q.durationSec,who:q.agent}]:[]}
function cbTxBody(legs){if(!mcp)return `<span class="hint">Transcripts need Lightdash.</span>`;
  return legs.map((l,i)=>{const t=txCache.get(String(l.id));return `<div class="cbtxleg"><b>Call ${i+1}</b>${t==null?` <span class="hint">Loading…</span>`:t.trim()?`<div>${esc(t)}</div>`:` <span class="hint">No transcript for this call.</span>`}</div>`}).join("")}
async function cbLoadTx(ik){const it=cbItemByIk(ik);if(!it||!mcp)return;const legs=cbCallLegs(it.q||{}).filter(l=>l.id).map(l=>({id:String(l.id),at:l.at}));
  try{await fetchTx(legs)}catch(e){legs.forEach(l=>{if(!txCache.has(l.id))txCache.set(l.id,"")})}
  const b=$("#cbTx");if(b)b.innerHTML=cbTxBody(legs)}
/* the call panel: the rubric item's levels, then the call's facts (or its transcript) */
function cbPanelHtml(it,r){const q=it.q||{},A=validAi(q.aiFacts),T=(A&&A.facts&&Array.isArray(A.facts.timeline))?A.facts.timeline:[],legs=cbCallLegs(q).filter(l=>l.id);
  const lv=[1,2,3].map(n=>`<li><b class="cbmk ${chMarkCls(n,3)}">${n}</b><span>${esc((r.lv||[])[n]||"")}</span></li>`).join("")+(r.na?`<li><b class="cbmk na">N/A</b><span>${esc(r.naText||"Doesn't apply")}</span></li>`:"");
  const facts=T.length?`<ol class="cbfacts">${T.map(t=>`<li><span class="num fid">${esc(t.id||"")}</span><span>${t.when?`<span class="num hint">${esc(t.when)}</span> `:""}<b>${esc(t.who||"")}</b> ${esc(t.what||"")}</span></li>`).join("")}</ol>`
    :legs.length?`<div class="txtext" id="cbPTx">${cbTxBody(legs)}</div>`:`<p class="tkmut">No facts or transcript.</p>`;
  return `<header class="chphd"><div class="chpttl"><span class="lbl-sm">Levels</span><h2 id="cbpTitle" tabindex="-1">${esc(r.label)}</h2></div><button type="button" class="chpx" data-cb="pclose" aria-label="Close">×</button></header>
    <section class="chpused"><p class="chpwhy">${esc(r.title)}</p><ol class="cblevels">${lv}</ol></section>
    <section class="chpview" aria-label="Facts"><div class="chpvh"><h3 class="chph">${T.length?"Facts":"Transcript"}</h3></div>${facts}</section>`}
function cbPanelOpen(it,crit){const r=cbRubric(it.kind).find(x=>x.id===crit);if(!r)return;
  if(cbPanel&&cbPanel.ik===it.ik&&cbPanel.crit===crit){cbPanelClose(true);return}
  cbPanel={ik:it.ik,crit};if(!cbPanelEl){cbPanelEl=document.createElement("aside");cbPanelEl.id="cbPanel";cbPanelEl.className="chpanel cbpanel";cbPanelEl.setAttribute("aria-labelledby","cbpTitle")}
  const v=$("#view-calib");if(v&&cbPanelEl.parentNode!==v)v.append(cbPanelEl);cbPanelEl.hidden=false;cbPanelEl.innerHTML=cbPanelHtml(it,r);document.body.classList.add("chp-on");
  if(!validAi((it.q||{}).aiFacts)&&mcp)cbLoadTx(it.ik).then(()=>{const b=$("#cbPTx");if(b)b.innerHTML=cbTxBody(cbCallLegs(it.q||{}).filter(l=>l.id))});
  const h=$("#cbpTitle");if(h)h.focus({preventScroll:true});document.querySelectorAll('#view-calib [data-cb="panel"]').forEach(b=>b.setAttribute("aria-expanded",String(b.dataset.crit===crit)))}
function cbPanelClose(refocus){if(!cbPanel)return;const P=cbPanel;cbPanel=null;if(cbPanelEl){cbPanelEl.hidden=true;cbPanelEl.innerHTML=""}
  if(!(typeof chPanel!=="undefined"&&chPanel))document.body.classList.remove("chp-on");
  document.querySelectorAll('#view-calib [data-cb="panel"]').forEach(b=>b.setAttribute("aria-expanded","false"));
  if(refocus){const b=$(`#view-calib [data-cb="panel"][data-crit="${P.crit}"]`);if(b)b.focus({preventScroll:true})}}
function renderCalibTab(){const st=$("#st-calib");if(!st)return;const n=cbChatItems().concat(cbCallItems()).filter(it=>!cbSub(myId,it.ik)&&!(cbItems[it.ik]||{}).locked).length;st.textContent=n?String(n):""}
function renderCalib(){cbPresence();renderCalibTab();const v=$("#view-calib");if(!v)return;
  /* one grid in the page at a time: the hidden view lets go of its grid (the Audit re-renders when it comes back) */
  if(tab!=="calib"){if(cbPanel)cbPanelClose();if(v.firstChild)v.innerHTML="";return}
  const og=$("#view-chat #cbGrid"),orb=$("#view-chat #cbRailBox");if(og)og.remove();if(orb)orb.remove();if(og||orb)chatAuditSig="";
  cbSeen();
  const it=cbCall?cbItemByIk("call_"+cbCall):null;if(cbCall&&!it)cbCall=null;
  if(cbPanel&&(!it||cbPanel.ik!==it.ik))cbPanelClose();
  const k=cbFocusKey(v);
  v.innerHTML=`<div class="cbtab">${it?cbCallHtml(it):cbTabHtml()}</div>`;{const rb=$("#cbRailBox");if(rb)rb._h=cbRailHtml(rb.dataset.kind,rb.dataset.ik)}
  if(cbPanel&&cbPanelEl){v.append(cbPanelEl);const r=cbRubric("call").find(x=>x.id===cbPanel.crit);if(it&&r)cbPanelEl.innerHTML=cbPanelHtml(it,r)}
  cbRefocus(v,k)}

/* ---------- events ---------- */
function cbGridItem(el){const g=el&&el.closest("#cbGrid");return g?cbItemByIk(g.dataset.ik):cbCall?cbItemByIk("call_"+cbCall):null}
document.addEventListener("click",e=>{const el=e.target.closest("[data-cb]");if(!el||!el.closest("#view-calib,#view-chat,#cbPanel"))return;const A=el.dataset.cb;
  if(A==="x")return;
  if(A==="row"&&el.tagName==="TR"&&e.target.closest("button,a,textarea,input"))return;
  const it=cbGridItem(el),crit=el.dataset.crit;
  switch(A){
    case "kind":cbKind=el.dataset.v==="call"?"call":"chat";cbCall=null;cbNote="";renderCalib();return;
    case "draw":if(cbKind==="chat")lrnDraw().then(()=>renderCalib());else cbDrawCalls();return;
    case "open":case "go":{const ik=el.dataset.ik;if(!ik)return;if(ik.startsWith("chat_")){const x=cbChatItems().find(y=>y.ik===ik);openChat(ik.slice(5),x?x.week:undefined)}
      else{if(tab==="calib"&&cbCall===ik.slice(5))return;navPush();cbCall=ik.slice(5);cbPanelClose();renderCalib();window.scrollTo({top:0})}return}
    case "back":navBack();return;
    case "railtog":cbRailOpen=!cbRailOpen;{const r=$("#cbRail"),b=r&&r.querySelector(".cbrtog");if(r)r.dataset.open=cbRailOpen?"1":"0";if(b)b.setAttribute("aria-expanded",String(cbRailOpen))}return;
    case "graders":if(!amOwner)return;cbGrEdit=!cbGrEdit;if(cbGrEdit)cbGrDraft=cbExpected().join(", ");renderCalib();if(cbGrEdit){const i=$("#cbGrIn");if(i)i.focus()}else{const b=$("#cbGrBtn");if(b)b.focus()}return;
    case "grsave":cbGrSave();return;
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
    case "panel":cbPanelOpen(it,crit);break}});
document.addEventListener("input",e=>{const t=e.target;if(!t.dataset||!(t.dataset.cbnote||t.dataset.cbag))return;const it=cbGridItem(t);if(!it)return;
  if(t.dataset.cbag){const crit=t.dataset.cbag;if(!cbSettle||cbSettle.ik!==it.ik||cbSettle.crit!==crit)cbSettle={ik:it.ik,crit,mark:null,note:""};cbSettle.note=t.value;return}
  const crit=t.dataset.cbnote,s=cbSub(myId,it.ik);if(s){if(!cbEdit.has(it.ik))return;s.notes=Object.assign({},s.notes,{[crit]:t.value})}else cbDraftOf(it.ik).notes[crit]=t.value;
  cbSaveMine(it.ik);const b=document.querySelector(`#cbGrid [data-cb="note"][data-crit="${crit}"].cbnotebtn`);if(b){const h=!!t.value.trim();b.classList.toggle("has",h);b.textContent=h?"Note ✓":"+ Note"}});
document.addEventListener("input",e=>{if(e.target&&e.target.id==="cbGrIn")cbGrDraft=e.target.value});
document.addEventListener("keydown",e=>{if(e.key==="Enter"&&e.target&&e.target.id==="cbGrIn"){e.preventDefault();cbGrSave()}});
document.addEventListener("toggle",e=>{const d=e.target;if(d instanceof HTMLDetailsElement&&d.dataset.cbtx&&d.open)cbLoadTx(d.dataset.cbtx)},true);
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&cbPanel&&!e.defaultPrevented){e.preventDefault();cbPanelClose(true)}});
