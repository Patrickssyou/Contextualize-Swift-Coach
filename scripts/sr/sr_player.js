/* ---------- SR PLAYER: the call as a highlight reel. A stage (the GreenDot screen replay when a recording is loaded, otherwise the
   live caption and last screen action), an activity curve (who is talking, what is clicked), icons at each moment by kind, click to
   seek, and "Highlights only" that plays ±12 s around each moment and skips the rest. Recording clips live in the artifact's asset
   store as one JSON per call ({sr, audioStart, t0, clips:[{s,e,pcm}], events}) and are pointed to by srAudits/<id>.media. ---------- */
const SR_ICON={
  info:'<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>',
  solution:'<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3z"/>',
  resolution:'<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>',
  remark:'<path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h7M9 16h5"/>',
  friction:'<path d="M13 2L5 14h6l-1 8 8-12h-6z"/>',
  escalation:'<path d="M6 3h3l2 5-2.5 1.6a11 11 0 0 0 5.9 5.9L16 13l5 2v3.2A2 2 0 0 1 19 20 16 16 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
  ownership:'<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 4v5h-5"/>',
  tone:'<path d="M4 5h16v11H10l-5 4v-4H4z"/>'};
const SR_KL={info:"Found the info",solution:"Solution offered",resolution:"Resolved",remark:"Remark or task",friction:"Friction",escalation:"Escalation",ownership:"Follow-through",tone:"Tone"};
const SR_KO=["info","solution","resolution","remark","escalation","ownership","tone","friction"];
const srSvgI=(k,cls)=>`<svg viewBox="0 0 24 24" class="${cls||"sri"}" aria-hidden="true">${SR_ICON[k]||SR_ICON.info}</svg>`;
function srKind(f){if(f.kind&&SR_ICON[f.kind])return f.kind;const x=String(f.text||"").toLowerCase(),c=String(f.crit||"").toLowerCase();
  if(c==="wira ticket"||/remark|wira|task|saves the order|logged|filed/.test(x))return "remark";
  if(/3-way|boss|manager|escalat|transfer/.test(x))return "escalation";
  if(/redial|call(s|ed)? back|callback/.test(x))return "ownership";
  if(/silence|idle|dead air|no clicks|instead of|waiting|mid-call|gives up|don't want/.test(x))return "friction";
  if(/offer|promise|i'll /.test(x))return "solution";
  if(c==="immediate resolution")return f.tone==="bad"?"friction":"resolution";
  if(c==="ownership")return "ownership";
  if(/tone|composure|empathy/.test(c))return f.tone==="bad"?"friction":"tone";
  return f.tone==="bad"?"friction":"info"}
const SR_PAD=12;
function srClips(d){const dur=srDur(d),F=((d.audit||{}).findings||[]).map(f=>+f.t).filter(t=>!isNaN(t)).sort((a,b)=>a-b),o=[];
  if(d.media&&Array.isArray(d.media.clips)&&d.media.clips.length)return d.media.clips.map(c=>({s:+c[0],e:+c[1]}));
  for(const t of F){const s=Math.max(0,t-SR_PAD),e=Math.min(dur,t+SR_PAD);if(o.length&&s<=o[o.length-1].e+4)o[o.length-1].e=Math.max(o[o.length-1].e,e);else o.push({s,e})}return o}
const srDur=d=>Math.max(1,Number(d.dur)||0,...(d.lines||[]).map(l=>+l.e||0),...((d.audit||{}).findings||[]).map(f=>(+f.t||0)+SR_PAD),...(((d.media||{}).clips)||[]).map(c=>+c[1]||0));
/* activity per second: speech (0-1) plus a little for on-screen actions, smoothed */
function srCurve(d){const dur=Math.ceil(srDur(d)),v=new Float32Array(dur+1);
  for(const l of d.lines||[]){const s=Math.max(0,+l.t||0),e=Math.min(dur,+l.e||s);for(let i=Math.floor(s);i<=Math.floor(e);i++)v[i]+=Math.max(0,Math.min(i+1,e)-Math.max(i,s))*(l.who==="agent"?.85:.75)}
  for(const s of d.screen||[])if(s.k==="click"||s.k==="type"||s.k==="dblclick"){const i=Math.min(dur,Math.floor(+s.t||0));v[i]+=.35}
  const k=[.06,.12,.2,.24,.2,.12,.06],o=new Float32Array(dur+1);for(let i=0;i<=dur;i++){let a=0;for(let j=-3;j<=3;j++){const q=i+j;if(q>=0&&q<=dur)a+=Math.min(1.3,v[q])*k[j+3]}o[i]=a}return o}
let srP={id:"",t:0,playing:false,rate:1,hl:true,raf:0,last:0,media:null};
function srPlayerHtml(d){const dur=srDur(d),C=srCurve(d),clips=srClips(d),F=((d.audit||{}).findings||[]).slice().sort((a,b)=>a.t-b.t);
  const W=1000,H=64,x=t=>(t/dur)*W,mx=Math.max(.6,...C);
  let p=`M0 ${H}`;for(let i=0;i<C.length;i+=1)p+=` L${x(i).toFixed(1)} ${(H-2-(H-6)*(C[i]/mx)).toFixed(1)}`;p+=` L${W} ${H} Z`;
  const sil=(d.silences||[]).filter(s=>+s[1]>=10).map(s=>`<rect x="${x(+s[0]).toFixed(1)}" y="${H-3}" width="${Math.max(2,x(+s[1])).toFixed(1)}" height="3" class="srsil"/>`).join("");
  const step=dur>900?120:dur>360?60:30,ticks=[];for(let t=0;t<=dur;t+=step)ticks.push(t);
  /* icons: two rows when they crowd */
  let lastX=[-99,-99];const ic=F.map((f,i)=>{const k=srKind(f),px=x(+f.t)/W*100;let row=px-lastX[0]<3.2?(px-lastX[1]<3.2?0:1):0;lastX[row]=px;
    return `<button type="button" class="srpin k-${k} t-${esc(f.tone||"note")} r${row}" style="left:${px.toFixed(2)}%" data-srseek="${f.t}" aria-label="${esc(srT(f.t)+" "+SR_KL[k]+": "+f.text)}"><span class="srpico">${srSvgI(k)}</span><span class="srtip"><b>${esc(srT(f.t))} · ${esc(SR_KL[k])}</b>${esc(f.text)}</span></button>`}).join("");
  const kinds=SR_KO.filter(k=>F.some(f=>srKind(f)===k));
  const hasMedia=!!(d.media&&d.media.asset);
  return `<section class="srplay" id="srPlay" data-id="${esc(d.id)}" data-dur="${dur}">
    <div class="srstage${hasMedia?"":" norec"}" id="srStage"><div class="srnow" id="srNow"></div><div class="srrep" id="srRep" hidden></div>${hasMedia?"":`<span class="srnorec">No recording loaded</span>`}</div>
    <div class="srctl">
      <button type="button" class="srbtn srpp" id="srPP" aria-label="Play"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg></button>
      <span class="num srclock"><b id="srClock">0:00</b> / ${srT(dur)}</span>
      <button type="button" class="srbtn srprev" data-srstep="-1" aria-label="Previous moment"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 5v14L8 12zM6 5h2v14H6z"/></svg></button>
      <button type="button" class="srbtn srnext" data-srstep="1" aria-label="Next moment"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5v14l10-7zM16 5h2v14h-2z"/></svg></button>
      <span class="srsp"></span>
      <button type="button" class="srtog" id="srHL" aria-pressed="${srP.hl}">Highlights only</button>
      <div class="srrate" role="group" aria-label="Speed">${[1,1.5,2].map(r=>`<button type="button" data-srrate="${r}" aria-pressed="${srP.rate===r}">${r}×</button>`).join("")}</div>
    </div>
    <div class="srtrack" id="srTrack">
      <div class="srpins">${ic}</div>
      <div class="srcurvew" data-srbar="1">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="srcurve" aria-hidden="true">
          ${clips.map(c=>`<rect x="${x(c.s).toFixed(1)}" y="0" width="${(x(c.e)-x(c.s)).toFixed(1)}" height="${H}" class="srclip"/>`).join("")}
          <path d="${p}" class="srarea"/>${sil}
        </svg>
        <div class="srhead" id="srHead"></div><div class="srhover" id="srHover" hidden></div>
      </div>
      <div class="srticks">${ticks.map(t=>`<span style="left:${(t/dur*100).toFixed(2)}%">${t>=60?Math.round(t/60)+"m":t+"s"}</span>`).join("")}</div>
    </div>
    <ul class="srkeys">${kinds.map(k=>`<li class="k-${k}">${srSvgI(k)}${SR_KL[k]}</li>`).join("")}<li class="srkclip"><i></i>Highlight clip</li><li class="srksil"><i></i>Dead air 10 s+</li></ul>
  </section>`}
/* the "now" view when there is no recording: the caption being spoken and the last thing done on screen */
function srNowHtml(d,t){const L=d.lines||[],S=d.screen||[],F=(d.audit||{}).findings||[];
  let l=null;for(const x of L){if(+x.t<=t+.2)l=x;else break}const live=l&&t<=(+l.e||+l.t)+1.5;
  let s=null;for(const x of S){if(+x.t<=t)s=x;else break}
  const f=F.filter(x=>t>=+x.t-1&&t<=+x.t+6).sort((a,b)=>Math.abs(a.t-t)-Math.abs(b.t-t))[0];
  const who=l?(l.who==="agent"?(d.alias||"Agent"):l.who==="other"?"Store":"Caller"):"";
  return `${f?`<div class="srnowf k-${srKind(f)} t-${esc(f.tone||"note")}">${srSvgI(srKind(f))}<span><b>${esc(SR_KL[srKind(f)])}</b> ${esc(f.text)}</span></div>`:""}
    <div class="srnowl${live?"":" dim"}${l?" "+l.who:""}">${l?`<span class="srnoww">${esc(who)}</span><p>${esc(l.txt||"")}</p>`:`<p class="dim">…</p>`}</div>
    ${s?`<div class="srnows"><span class="num">${srT(s.t)}</span><span>${esc(SR_K[s.k]||s.k)}</span><b>${esc(s.l||"")}${s.v?` “${esc(s.v)}”`:""}</b></div>`:""}`}
const srDoc=()=>(srDocs||[]).find(x=>x.id===srP.id);
function srPaint(){const d=srDoc(),pl=$("#srPlay");if(!d||!pl||pl.dataset.id!==d.id)return;const dur=srDur(d),t=srP.t;
  const h=$("#srHead");if(h)h.style.left=(Math.min(1,t/dur)*100).toFixed(3)+"%";const c=$("#srClock");if(c)c.textContent=srT(t);
  const pp=$("#srPP");if(pp){pp.setAttribute("aria-label",srP.playing?"Pause":"Play");pp.innerHTML=srP.playing?'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>':'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4l13 8-13 8z"/></svg>'}
  const M=srP.media&&srP.media.id===d.id&&srP.media.ready;const n=$("#srNow"),r=$("#srRep");
  if(r)r.hidden=!M;if(n){n.hidden=!!M;if(!M)n.innerHTML=srP.media&&srP.media.id===d.id&&srP.media.err?`<p class="dim">${esc(srP.media.err)}</p>`:srP.media&&srP.media.id===d.id&&!srP.media.ready?`<p class="dim">Loading recording…</p>`:srNowHtml(d,t)}
  if(M){const o=$("#srRepCap");if(o)o.innerHTML=srNowCap(d,t)}
  document.querySelectorAll("#srPlay .srpin").forEach(b=>b.classList.toggle("on",Math.abs(+b.dataset.srseek-t)<2.5))}
function srNowCap(d,t){let l=null;for(const x of d.lines||[]){if(+x.t<=t+.2)l=x;else break}if(!l||t>(+l.e||+l.t)+1.5)return "";return `<span class="${l.who}">${esc(l.who==="agent"?(d.alias||"Agent"):l.who==="other"?"Store":"Caller")}</span>${esc(l.txt||"")}`}
const srClipAt=(cl,t)=>cl.findIndex(c=>t>=c.s-.05&&t<c.e);
function srTick(){if(!srP.playing)return;const d=srDoc();if(!d){srPause();return}const now=performance.now(),dt=Math.min(.25,(now-srP.last)/1000);srP.last=now;
  const cl=srClips(d),dur=srDur(d),prev=srP.t;let t=prev+dt*srP.rate,jump=false;
  if(srP.hl&&cl.length){const i=srClipAt(cl,prev);
    if(i<0||t>=cl[i].e){const nx=i<0?cl.find(c=>c.s>prev):cl[i+1];if(!nx){srP.t=i<0?prev:cl[i].e;srPause();return}t=nx.s;jump=true}}
  if(t>=dur){srP.t=dur;srPause();return}
  const ci=srClipAt(cl,prev),cn=srClipAt(cl,t);srP.t=t;if(jump||ci!==cn)srMediaSync(true);
  srPaint();srP.raf=requestAnimationFrame(srTick)}
function srPlay(){const d=srDoc();if(!d)return;const cl=srClips(d);
  if(srP.hl&&cl.length&&srClipAt(cl,srP.t)<0){const nx=cl.find(c=>c.s>srP.t)||cl[0];srP.t=nx.s}
  if(srP.t>=srDur(d)-.2)srP.t=srP.hl&&cl.length?cl[0].s:0;
  srP.playing=true;srP.last=performance.now();srMediaSync(true);cancelAnimationFrame(srP.raf);srP.raf=requestAnimationFrame(srTick);srPaint()}
function srPause(){srP.playing=false;cancelAnimationFrame(srP.raf);srMediaSync(false);srPaint()}
function srSeek(t,play){const d=srDoc();if(!d)return;srP.t=Math.max(0,Math.min(srDur(d),+t||0));if(play&&!srP.playing)srPlay();else{srMediaSync(srP.playing);srPaint()}}
/* recording: audio clips through Web Audio, screen through the rrweb replayer */
function srMediaSync(on){const M=srP.media;if(!M||!M.ready||M.id!==srP.id)return;
  try{if(M.src){M.src.onended=null;M.src.stop()}}catch(e){}M.src=null;
  const ms=Math.max(0,M.audioStart+srP.t*1000-M.t0);
  if(M.rep){try{M.rep.setConfig({speed:srP.rate});if(on)M.rep.play(ms);else M.rep.pause(ms)}catch(e){}}
  if(!on||!M.ctx)return;const i=M.clips.findIndex(c=>srP.t>=c.s&&srP.t<c.e);if(i<0)return;const c=M.clips[i];
  if(M.ctx.state==="suspended")M.ctx.resume();const s=M.ctx.createBufferSource();s.buffer=c.buf;s.playbackRate.value=srP.rate;s.connect(M.ctx.destination);s.start(0,Math.max(0,srP.t-c.s));M.src=s}
const srB64=b=>{const s=atob(b),u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=s.charCodeAt(i);return u};
async function srLoadMedia(d){if(!d||!d.media||!d.media.asset)return;if(srP.media&&srP.media.id===d.id)return;srMediaDrop();
  const M={id:d.id,ready:false};srP.media=M;srPaint();
  try{const r=await fetch(d.media.url||("/_blob/"+d.media.asset));if(!r.ok)throw new Error("recording "+r.status);const j=await r.json();if(srP.media!==M)return;
    const AC=window.AudioContext||window.webkitAudioContext;M.ctx=AC?new AC({sampleRate:j.sr||8000}):null;
    M.clips=(j.clips||[]).map(c=>{const u=srB64(c.pcm),n=u.length>>1,dv=new DataView(u.buffer),f=new Float32Array(n);for(let i=0;i<n;i++)f[i]=dv.getInt16(i*2,true)/32768;let buf=null;if(M.ctx){buf=M.ctx.createBuffer(1,n,j.sr||8000);buf.copyToChannel(f,0)}return {s:+c.s,e:+c.e,buf}});
    M.audioStart=+j.audioStart||0;M.t0=+j.t0||((j.events||[])[0]||{}).timestamp||M.audioStart;
    M.events=j.events||[];srMakeRep(M);
    M.ready=true;srPaint();srFit();srMediaSync(srP.playing)}
  catch(e){M.err="Couldn't load the recording.";srPaint()}}
/* an iframe that is moved in the DOM loses its document, so the replayer is rebuilt in the current stage after each render */
function srMakeRep(M){const R=$("#srRep");if(!window.rrweb||!R||(M.events||[]).length<2)return;try{M.rep&&M.rep.destroy&&M.rep.destroy()}catch(e){}
  R.innerHTML=`<div class="srrepin" id="srRepIn"></div><div class="srrepcap" id="srRepCap"></div>`;
  M.rep=new rrweb.Replayer(M.events,{root:$("#srRepIn"),skipInactive:false,showWarning:false,showDebug:false,mouseTail:false,triggerFocus:false,UNSAFE_replayCanvas:false,speed:srP.rate});
  M.rep.on("resize",()=>srFit());M.node=R}
function srMediaDrop(){const M=srP.media;if(!M)return;try{M.src&&M.src.stop()}catch(e){}try{M.rep&&M.rep.pause()}catch(e){}try{M.ctx&&M.ctx.close()}catch(e){}srP.media=null}
function srFit(){const M=srP.media;if(!M||!M.rep)return;const st=$("#srStage"),w=M.rep.wrapper,ifr=M.rep.iframe;if(!st||!w||!ifr)return;
  const iw=+ifr.width||ifr.offsetWidth||1280,ih=+ifr.height||ifr.offsetHeight||720,sw=st.clientWidth,sh=st.clientHeight,k=Math.min(sw/iw,sh/ih);
  w.style.transform=`scale(${k})`;w.style.transformOrigin="0 0";w.style.position="absolute";w.style.left=((sw-iw*k)/2)+"px";w.style.top=((sh-ih*k)/2)+"px"}
window.addEventListener("resize",()=>srFit());
/* after a re-render, put the live replay node back so a db update doesn't kill playback */
function srMount(d){if(srP.id!==d.id){srPause();srMediaDrop();srP.id=d.id;srP.t=0}
  const M=srP.media;if(M&&M.id===d.id&&M.ready&&M.node&&$("#srRep")!==M.node){srMakeRep(M);srMediaSync(srP.playing)}
  if(d.media&&d.media.asset)srLoadMedia(d);srPaint();srFit()}
function srBarT(e){const b=e.target.closest("[data-srbar]")||$("#srPlay [data-srbar]");const r=b.getBoundingClientRect(),d=srDoc();return Math.max(0,Math.min(1,(e.clientX-r.left)/r.width))*srDur(d)}
document.addEventListener("click",e=>{if(!e.target.closest||!e.target.closest("#srPlay"))return;
  if(e.target.closest("#srPP")){srP.playing?srPause():srPlay();return}
  const pin=e.target.closest("[data-srseek]");if(pin){const d=srDoc(),cl=srClips(d),t=+pin.dataset.srseek,c=cl.find(c=>t>=c.s&&t<=c.e);srSeek(srP.hl&&c?Math.max(c.s,t-4):t,true);return}
  const st=e.target.closest("[data-srstep]");if(st){const d=srDoc(),F=((d.audit||{}).findings||[]).map(f=>+f.t).sort((a,b)=>a-b),dir=+st.dataset.srstep;const n=dir>0?F.find(t=>t>srP.t+1):F.slice().reverse().find(t=>t<srP.t-5);if(n!=null)srSeek(Math.max(0,n-4),srP.playing);return}
  const hl=e.target.closest("#srHL");if(hl){srP.hl=!srP.hl;hl.setAttribute("aria-pressed",srP.hl);return}
  const rt=e.target.closest("[data-srrate]");if(rt){srP.rate=+rt.dataset.srrate;document.querySelectorAll("#srPlay [data-srrate]").forEach(b=>b.setAttribute("aria-pressed",+b.dataset.srrate===srP.rate));srMediaSync(srP.playing);return}
  if(e.target.closest("[data-srbar]")){srSeek(srBarT(e),false);return}});
document.addEventListener("mousemove",e=>{const b=e.target.closest&&e.target.closest("#srPlay [data-srbar]"),h=$("#srHover");if(!h)return;if(!b){h.hidden=true;return}const r=b.getBoundingClientRect(),f=(e.clientX-r.left)/r.width;h.hidden=false;h.style.left=(f*100)+"%";h.textContent=srT(f*srDur(srDoc()))});
document.addEventListener("keydown",e=>{if(tab!=="sr"||!$("#srPlay")||/input|textarea|select/i.test((e.target.tagName||"")))return;if(e.key===" "&&!e.target.closest("button")){e.preventDefault();srP.playing?srPause():srPlay()}
  else if(e.key==="ArrowRight")srSeek(srP.t+5,false);else if(e.key==="ArrowLeft")srSeek(srP.t-5,false)});
/* owner only: paste a recording bundle (made in a logged-in GreenDot tab) to store it in the asset store and point the audit at it */
let srPasteNote="";const srMediaImpHtml=()=>amOwner?`<details class="panel srimp"${srPasteNote?" open":""}><summary>Add recording clips</summary><div class="srpaste" id="srPaste" tabindex="0" role="textbox" aria-label="Paste recording">Click here and paste</div><span class="hint" id="srPasteMsg">${esc(srPasteNote)}</span></details>`:"";
document.addEventListener("paste",async e=>{const z=e.target.closest&&e.target.closest("#srPaste");if(!z)return;e.preventDefault();const say=s=>{srPasteNote=s;const m=$("#srPasteMsg");if(m)m.textContent=s};
  const txt=(e.clipboardData||window.clipboardData).getData("text");let j;try{j=JSON.parse(txt)}catch(_){say("Not a recording bundle.");return}
  if(!j||j.kind!=="srMedia"||!/^[0-9a-f-]{36}$/.test(j.callId||"")){say("Not a recording bundle.");return}
  const doc=(srDocs||[]).find(x=>x.callId===j.callId);if(!doc){say("No audit for call "+j.callId.slice(0,8)+".");return}
  say(`Saving ${(txt.length/1048576).toFixed(1)} MB…`);
  try{const A=await window.claude.use("assets");if(!A){say("Can't store files here.");return}
    const up=await A.upload(new Blob([txt],{type:"application/json"}));
    await db.doc("srAudits/"+doc.id).update({media:{asset:up.id,url:up.url,size:up.sizeBytes,clips:(j.clips||[]).map(c=>[+c.s,+c.e]),at:new Date().toISOString()}});
    say("Saved for "+(doc.sa||"call")+".");if(srP.id===doc.id){srMediaDrop()}}
  catch(err){say("Couldn't save: "+String(err&&(err.code||err.message)||err).slice(0,80))}});
