/* the call log (MGR tool style): what was said and done on screen, grouped by source, each time a button that jumps the player there */
function srLogRows(d){const A=d.audit||{},R=[];
  (d.lines||[]).forEach(l=>R.push({t:+l.t||0,src:"voice",who:l.who==="agent"?(d.alias||"Agent"):l.who==="other"?"Store":"Caller",cls:l.who||"",txt:l.txt||"",flag:l.flag||""}));
  (d.screen||[]).filter(s=>s.k!=="load"&&s.k!=="page"&&(s.l||s.v||s.k==="idle")).forEach(s=>R.push({t:+s.t||0,src:"screen",who:SR_K[s.k]||s.k,cls:"k-"+s.k,txt:(s.l||"")+(s.v?` “${s.v}”`:"")+(s.k==="idle"&&s.d?` · ${Math.round(s.d)} s`:"")}));
  (A.findings||[]).forEach(f=>R.push({t:+f.t||0,src:"moment",f}));
  return R.sort((a,b)=>a.t-b.t||(a.src==="moment"?-1:b.src==="moment"?1:0))}
function srLogHtml(d){const R=srLogRows(d),cl=srClips(d),inC=t=>!cl.length||cl.some(c=>t>=c.s-.5&&t<=c.e+.5),G=[];
  R.forEach(r=>{const g=G[G.length-1];if(g&&g.src===r.src&&r.src!=="moment")g.rows.push(r);else G.push({src:r.src,rows:[r]})});
  const row=r=>{const out=inC(r.t)?"":" out";
    if(r.src==="moment"){const f=r.f,k=srKind(f);return `<li class="lg-r srlr srlm k-${k} t-${esc(f.tone||"note")}${out}" data-t="${r.t}"><button type="button" class="lg-t num srlt" data-srlog="${r.t}">${srT(r.t)}</button><span class="lg-w">${srSvgI(k,"sri srli")}<b>${esc(SR_KL[k])}</b> ${esc(f.text)}</span></li>`}
    return `<li class="lg-r srlr ${esc(r.cls)}${r.flag?" flag":""}${out}" data-t="${r.t}"><button type="button" class="lg-t num srlt" data-srlog="${r.t}">${srT(r.t)}</button><span class="lg-w"><b>${esc(r.who)}</b> ${esc(r.txt)}${r.flag?` <span class="srflag">${esc(r.flag)}</span>`:""}</span></li>`};
  const head=g=>{if(g.src==="moment")return "";const a=g.rows[0].t,b=g.rows[g.rows.length-1].t;
    return `<div class="lg-gh"><span class="lg-src">${g.src==="voice"?"Call":"Screen"}</span><span class="lg-meta num">${srT(a)}${b>a+1?"–"+srT(b):""}</span></div>`};
  return `<aside class="panel tlog srlog${srP.hl?" hlon":""}" id="srLog" aria-label="Call log"><header class="lg-hd"><span>Call log</span><span class="num tkmut">${R.length} events</span></header>
    <ol class="lg-list" id="srLogL">${G.map(g=>`<li class="lg-g${g.src==="moment"?" srlmg":""}">${head(g)}<ol class="lg-rows">${g.rows.map(row).join("")}</ol></li>`).join("")}</ol></aside>`}
/* keep the row being played lit, and in view while playing */
function srLogPaint(t){const L=$("#srLogL");if(!L)return;const rows=L.querySelectorAll(".srlr");let cur=null;for(const r of rows){if(+r.dataset.t<=t+.25)cur=r;else break}
  if(srP.logRow===cur)return;if(srP.logRow&&srP.logRow.isConnected)srP.logRow.classList.remove("now");srP.logRow=cur;if(!cur)return;cur.classList.add("now");
  if(srP.playing&&!L.matches(":hover")){const a=cur.getBoundingClientRect(),b=L.getBoundingClientRect();if(a.top<b.top||a.bottom>b.bottom)L.scrollTop+=a.top-b.top-b.height/3}}
document.addEventListener("click",e=>{const b=e.target.closest&&e.target.closest("[data-srlog]");if(!b)return;const d=srDoc();if(!d)return;const t=+b.dataset.srlog,cl=srClips(d);
  if(srP.hl&&cl.length&&!cl.some(c=>t>=c.s-.5&&t<=c.e+.5)){srP.hl=false;const h=$("#srHL");if(h)h.setAttribute("aria-pressed","false");const g=$("#srLog");if(g)g.classList.remove("hlon")}
  srSeek(t,true)});
