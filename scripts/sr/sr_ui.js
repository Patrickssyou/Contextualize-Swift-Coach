/* ---------- SCREEN RECORD + VOICE AUDITS: a test of 6 calls. Each srAudits/<queueId> doc holds the GreenDot screen replay boiled down to a
   timeline (clicks, typing, panels, idle stretches), the timed captions with voice measures (pitch, loudness, pace) split by speaker,
   and Claude's read of what the screen and voice show that the transcript alone doesn't. ---------- */
let srDocs=null,srSel="",srOff=null;
function srListen(){if(!db||srOff)return;srOff=db.collection("srAudits").onSnapshot(s=>{srDocs=s.docs.map(d=>Object.assign({},d.data(),{id:d.id})).sort((a,b)=>String(a.sa||"").localeCompare(String(b.sa||"")));if(!srSel&&srDocs.length)srSel=srDocs[0].id;if(tab==="sr")renderSR()},()=>{srDocs=srDocs||[];if(tab==="sr")renderSR()})}
const srT=t=>{t=Math.max(0,Number(t)||0);return `${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,"0")}`};
const SR_K={click:"Clicked",dblclick:"Double-clicked",type:"Typed",panel:"Screen",page:"Page",load:"Screen",idle:"No activity"};
function srChart(d){const L=(d.lines||[]).filter(l=>l.f0),dur=Number(d.dur)||Math.max(1,...(d.lines||[]).map(l=>l.e||0));if(!L.length)return "";
  const W=640,H=150,P=28,x=t=>P+(W-P-8)*Math.min(1,t/dur),am=Number((d.stats||{}).agentF0)||L[0].f0,st=f=>12*Math.log2(f/am),ys=L.map(l=>st(l.f0)),lo=Math.min(-8,...ys),hi=Math.max(8,...ys),y=v=>8+(H-8-18)*(1-(v-lo)/(hi-lo));
  const ticks=[];for(let t=0;t<=dur;t+=dur>240?60:30)ticks.push(t);
  return `<figure class="srfig"><figcaption><span class="lbl-sm">Pitch over the call</span><span class="srleg"><i class="a"></i>Agent<i class="c"></i>Caller</span></figcaption>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Pitch of each line, agent and caller">
      <line x1="${P}" x2="${W-8}" y1="${y(0)}" y2="${y(0)}" class="srz"/>${ticks.map(t=>`<text x="${x(t)}" y="${H-4}" class="srtk">${srT(t)}</text>`).join("")}
      <text x="2" y="${y(0)+4}" class="srtk">avg</text>
      ${(d.screen||[]).filter(s=>s.k==="click"||s.k==="type").map(s=>`<line x1="${x(s.t)}" x2="${x(s.t)}" y1="${H-20}" y2="${H-14}" class="srsc"/>`).join("")}
      ${L.map(l=>`<circle cx="${x((l.t+l.e)/2)}" cy="${y(st(l.f0))}" r="${l.flag?4:3}" class="${l.who==="agent"?"a":"c"}${l.flag?" f":""}" data-srjump="${l.t}"><title>${srT(l.t)} ${esc(l.who)}: ${esc(String(l.txt||"").slice(0,80))} · ${l.f0} Hz</title></circle>`).join("")}
    </svg><p class="hint">Each dot is one line, placed by its pitch against the agent's average. Ticks along the bottom are clicks and typing on screen.</p></figure>`}
function srStats(d){const S=d.stats||{},c=(k,v,s,cls)=>`<div class="srst${cls?" "+cls:""}"><span class="lbl-sm">${k}</span><b class="num">${v}</b>${s?`<span class="hint">${s}</span>`:""}</div>`;
  const sd=Number(S.agentF0sd),tone=isNaN(sd)?"":sd<2?"flat":sd<4.5?"normal":"lively";
  return `<div class="srstats">${c("Agent talk",S.agentTalkPct!=null?S.agentTalkPct+"%":"–",S.callerTalkPct!=null?`caller ${S.callerTalkPct}%`:"")}
    ${c("Agent pitch range",isNaN(sd)?"–":sd.toFixed(1)+" st",tone,tone==="flat"?"warn":"")}
    ${c("Agent pace",S.agentWps!=null?S.agentWps+" w/s":"–",S.callerWps!=null?`caller ${S.callerWps} w/s`:"")}
    ${c("Screen idle",S.idleSec!=null?srT(S.idleSec):"–",S.idleN?`${S.idleN} stretch${S.idleN===1?"":"es"} of 12 s+`:"")}
    ${c("On-screen actions",S.actions!=null?S.actions:"–",S.typed?`${S.typed} typed`:"")}</div>`}
function srTimeline(d){const R=[].concat((d.lines||[]).map(l=>({t:l.t,kind:"line",l})),(d.screen||[]).map(s=>({t:s.t,kind:"scr",s}))).sort((a,b)=>a.t-b.t||(a.kind==="line"?-1:1));
  return `<ol class="srtl" id="srTl">${R.map(r=>r.kind==="line"?`<li class="srl ${r.l.who}${r.l.flag?" flag":""}" data-t="${r.t}"><span class="num srts">${srT(r.t)}</span><span class="srwho">${r.l.who==="agent"?esc(d.alias||"Agent"):"Caller"}</span><span class="srtx">${esc(r.l.txt||"")}${r.l.flag?`<span class="srflag">${esc(r.l.flag)}</span>`:""}</span></li>`
    :`<li class="srs k-${r.s.k}" data-t="${r.t}"><span class="num srts">${srT(r.t)}</span><span class="srwho">${esc(SR_K[r.s.k]||r.s.k)}</span><span class="srtx">${esc(r.s.l||"")}${r.s.v?` <b>“${esc(r.s.v)}”</b>`:""}${r.s.k==="idle"&&r.s.d?` <span class="hint">${Math.round(r.s.d)} s</span>`:""}</span></li>`).join("")}</ol>`}
function srDetail(d){const A=d.audit||{};
  const F=(A.findings||[]).slice().sort((a,b)=>a.t-b.t);
  return `<header class="srhd"><div><h2>${esc(d.restaurant||"Call")}</h2><span class="hint">${esc([d.sa,d.kind,d.date,d.dur?srT(d.dur):""].filter(Boolean).join(" · "))}</span></div>
      ${d.callId?`<a class="btn small" href="${esc(recUrl(d.callId))}" target="_blank" rel="noopener">▶ Open in GreenDot</a>`:""}</header>
    ${A.summary?`<section class="srread"><h3 class="lbl-sm">What the screen and voice add</h3><p>${esc(A.summary)}</p>${(A.adds||[]).length?`<ul>${A.adds.map(x=>`<li>${esc(x)}</li>`).join("")}</ul>`:""}</section>`:""}
    ${F.length?`<section class="srfind"><h3 class="lbl-sm">Moments</h3><ol>${F.map(f=>`<li class="${esc(f.tone||"note")}"><button type="button" class="num srjump" data-srjump="${f.t}">${srT(f.t)}</button><span class="srsrc">${esc(f.src==="screen"?"Screen":f.src==="voice"?"Voice":"Screen + voice")}</span><span>${esc(f.text)}${f.crit?` <span class="hint">· ${esc(f.crit)}</span>`:""}</span></li>`).join("")}</ol></section>`:""}
    ${(A.crit||[]).length?`<section class="srcrit"><h3 class="lbl-sm">For the scorecard</h3><dl>${A.crit.map(c=>`<div><dt>${esc(c.label)}</dt><dd>${esc(c.note)}</dd></div>`).join("")}</dl></section>`:""}
    ${srStats(d)}${srChart(d)}
    <section class="srtlw"><h3 class="lbl-sm">Call and screen, second by second</h3>${srTimeline(d)}</section>
    ${A.limits?`<p class="hint srlim">${esc(A.limits)}</p>`:""}`}
function renderSR(){const v=$("#view-sr");if(!v||tab!=="sr")return;srListen();
  if(srDocs==null){v.innerHTML=`<div class="panel empty">Loading…</div>`;return}
  if(!srDocs.length){v.innerHTML=`<div class="panel empty">No screen and voice audits yet.</div>`;return}
  const d=srDocs.find(x=>x.id===srSel)||srDocs[0];
  v.innerHTML=`<div class="srwrap"><nav class="panel srnav" aria-label="Calls"><h2 class="srnh">Screen + voice · test</h2><ul>${srDocs.map(x=>`<li><button type="button" class="srpick" data-srpick="${esc(x.id)}" aria-pressed="${x.id===d.id}"><b>${esc(x.sa||"")}</b><span>${esc(x.restaurant||"")}</span><span class="hint num">${esc([x.kind,x.dur?srT(x.dur):""].filter(Boolean).join(" · "))}</span></button></li>`).join("")}</ul></nav>
    <article class="panel srmain">${srDetail(d)}</article></div>`}
document.addEventListener("click",e=>{const p=e.target.closest("[data-srpick]");if(p){srSel=p.dataset.srpick;renderSR();return}
  const j=e.target.closest("[data-srjump]");if(j&&$("#view-sr")&&!$("#view-sr").hidden){const t=Number(j.dataset.srjump),rows=[...document.querySelectorAll("#srTl li")];const r=rows.find(x=>Number(x.dataset.t)>=t-0.5)||rows[rows.length-1];
    if(r){rows.forEach(x=>x.classList.remove("hit"));r.classList.add("hit");r.scrollIntoView({block:"center",behavior:"smooth"})}}});
