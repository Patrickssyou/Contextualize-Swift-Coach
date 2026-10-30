(()=>{const B='https://greendot.prod.letsdowonders.io/greendot/backend/v6/multiplexed2/';const Z='00000000-0000-0000-0000-000000000000';
const P={get_call_info:'greendot/gd_call_edge/get_call_info',get_call_captions:'batch_engine/batch_engine_rrdesktop_api/get_call_captions',get_rrweb_events:'batch_engine/batch_engine_call_api/get_rrweb_events'};
window.__tpl={};for(const [k,p] of Object.entries(P))window.__tpl[k]={url:B+p,req:B+p,body:JSON.stringify({kind:k,payload:{call_id:Z}})};
window.__mkReq=(t,body)=>new Request(t.url,{method:'POST',credentials:'include',headers:{'content-type':'application/json'},body});window.__of=window.fetch.bind(window)})();
/* Runs inside a logged-in GreenDot tab. Pulls one call's captions, rrweb screen events and audio with the page's own request templates,
   and boils them down to a compact JSON: a speaker-split caption list with voice measures, a voice summary, and a screen timeline.
   window.__tpl must hold the captured request templates (get_call_info, get_call_captions, get_rrweb_events). */
window.srExtract = async function (id) {
  const T = window.__tpl, OF = window.__of || window.fetch;
  const get = async k => { const t = T[k]; const m = t.body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/); const r = await OF(window.__mkReq(t, t.body.replace(m[0], id))); return r.json(); };
  const mask = s => String(s == null ? "" : s).replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/\d[\d\s().-]{6,}\d/g, d => "•••" + d.replace(/\D/g, "").slice(-2));
  const out = { id, v: 1, at: new Date().toISOString() };
  /* info */
  try { const I = await get("get_call_info"); const w = (I.Ok && I.Ok.payload && I.Ok.payload.wprop) || {}; out.info = { direction: w.direction && (w.direction.kind || w.direction), start: w.start_time, end: w.end_time, skills: w.skills_needed, agentHungUp: w.is_agent_hung_up, ring: w.ring_duration }; } catch (e) { out.info = { err: String(e).slice(0, 80) }; }
  /* captions */
  let caps = [], a0 = null;
  try { const C = await get("get_call_captions"); const p = C.Ok.payload; a0 = Date.parse(p.audio_start_utc); caps = (p.captions || []).map(c => ({ s: +c.start_sec, e: +c.end_sec, t: mask(c.primary || "") })).filter(c => c.t); } catch (e) { out.capErr = String(e).slice(0, 80); }
  out.audioStart = a0 ? new Date(a0).toISOString() : null;
  /* audio */
  const FR = 0.05; let A = null;
  try {
    let res = null; for (let i = 0; i < 4; i++) { res = await OF(`/greendot/greendot-rust/call/${id}/audio`, { credentials: "include" }); if (res.ok) break; await new Promise(f => setTimeout(f, 1500)); }
    if (!res.ok) throw new Error("audio " + res.status);
    const buf = await res.arrayBuffer(), ctx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(1, 16000, 16000), ab = await ctx.decodeAudioData(buf);
    /* the audio file starts at the call start (ring and hold music included); captions and screen start at audio_start_utc */
    const st0 = Date.parse(String((out.info || {}).start || "").replace(" ", "T")), lead = a0 && st0 ? Math.max(0, Math.min(ab.duration - 1, (a0 - st0) / 1000)) : 0; out.audioLead = +lead.toFixed(2);
    const sr = ab.sampleRate, nC = ab.numberOfChannels, cut = Math.floor(lead * sr), adur = ab.duration - cut / sr, N = Math.floor(adur / FR), hop = Math.floor(sr * FR);
    const chans = []; for (let c = 0; c < nC; c++) chans.push(ab.getChannelData(c).subarray(cut));
    const db = chans.map(x => { const o = new Float32Array(N); for (let i = 0; i < N; i++) { let s = 0; for (let j = i * hop; j < (i + 1) * hop; j++) s += x[j] * x[j]; o[i] = 10 * Math.log10(s / hop + 1e-10); } return o; });
    const pct = (arr, q) => { const a = Array.from(arr).sort((p, q2) => p - q2); return a[Math.floor(q * (a.length - 1))]; };
    const floor = db.map(d => pct(d, 0.1)), sp = db.map((d, c) => Array.from(d, v => v > Math.max(floor[c] + 12, -55)));
    /* pitch: autocorrelation on a 40 ms window, 70-400 Hz, decimated to ~8 kHz */
    const dec = Math.max(1, Math.round(sr / 8000)), fs = sr / dec, W = Math.floor(0.04 * fs), lmin = Math.floor(fs / 400), lmax = Math.floor(fs / 70);
    const f0 = chans.map((x, c) => { const o = new Float32Array(N); for (let i = 0; i < N; i++) { if (!sp[c][i]) continue; const st = i * hop; const w = new Float32Array(W); let m = 0; for (let j = 0; j < W; j++) { w[j] = x[st + j * dec] || 0; m += w[j]; } m /= W; let e0 = 0; for (let j = 0; j < W; j++) { w[j] -= m; e0 += w[j] * w[j]; } if (e0 <= 0) continue; let best = 0, bl = 0; for (let l = lmin; l <= lmax; l++) { let s = 0, e1 = 0; for (let j = 0; j + l < W; j++) { s += w[j] * w[j + l]; e1 += w[j + l] * w[j + l]; } const r = s / Math.sqrt(e0 * e1 + 1e-12); if (r > best) { best = r; bl = l; } } if (best > 0.6 && bl) o[i] = fs / bl; } return o; });
    A = { sr, nC, dur: adur, db, sp, f0, N };
    const st = c => { const v = Array.from(A.f0[c]).filter(x => x > 0); if (!v.length) return null; const med = pct(v, 0.5); const semis = v.map(x => 12 * Math.log2(x / med)); const mean = semis.reduce((p, q) => p + q, 0) / semis.length; const sd = Math.sqrt(semis.reduce((p, q) => p + (q - mean) ** 2, 0) / semis.length); return { f0med: Math.round(med), f0sd: +sd.toFixed(1), range: +(pct(semis, 0.9) - pct(semis, 0.1)).toFixed(1) }; };
    const talk = c => +(A.sp[c].filter(Boolean).length * FR).toFixed(1), dbm = c => { const v = Array.from(A.db[c]).filter((x, i) => A.sp[c][i]); return v.length ? +(v.reduce((p, q) => p + q, 0) / v.length).toFixed(1) : null; };
    out.voice = { channels: nC, dur: +adur.toFixed(1), lead: out.audioLead, perCh: [...Array(nC).keys()].map(c => Object.assign({ ch: c, talkSec: talk(c), dbSpeech: dbm(c) }, st(c))) };
    /* silences (nobody speaking, >= 3 s) and overlaps (both speaking, >= 0.6 s) */
    const any = i => A.sp.some(s => s[i]), both = i => nC > 1 && A.sp.filter(s => s[i]).length > 1, runs = (fn, min) => { const r = []; let s = -1; for (let i = 0; i <= N; i++) { const on = i < N && fn(i); if (on && s < 0) s = i; if (!on && s >= 0) { if ((i - s) * FR >= min) r.push([+(s * FR).toFixed(1), +((i - s) * FR).toFixed(1)]); s = -1; } } return r; };
    out.voice.silences = runs(i => !any(i), 3);
    out.voice.overlaps = nC > 1 ? runs(both, 0.6) : null;
    /* 5-second buckets for the chart: loudness and pitch per channel */
    const B = Math.ceil(adur / 5); out.voice.buckets = [...Array(B).keys()].map(b => { const i0 = Math.floor(b * 5 / FR), i1 = Math.min(N, Math.floor((b + 1) * 5 / FR)); return { t: b * 5, ch: [...Array(nC).keys()].map(c => { let d = 0, n = 0, fv = []; for (let i = i0; i < i1; i++) if (A.sp[c][i]) { d += A.db[c][i]; n++; if (A.f0[c][i] > 0) fv.push(A.f0[c][i]); } return n ? { db: +(d / n).toFixed(1), f0: fv.length ? Math.round(fv.sort((p, q) => p - q)[fv.length >> 1]) : null, sp: +(n * FR).toFixed(1) } : null; }) }; });
  } catch (e) { out.audioErr = String(e).slice(0, 120); }
  /* captions with voice measures */
  out.captions = caps.map(c => { const o = { s: +c.s.toFixed(1), e: +c.e.toFixed(1), t: c.t, wps: +(c.t.split(/\s+/).length / Math.max(0.3, c.e - c.s)).toFixed(1) };
    if (A) { const i0 = Math.max(0, Math.floor(c.s / FR)), i1 = Math.min(A.N, Math.ceil(c.e / FR)); const sc = [...Array(A.nC).keys()].map(ch => { let n = 0, d = 0, fv = []; for (let i = i0; i < i1; i++) if (A.sp[ch][i]) { n++; d += A.db[ch][i]; if (A.f0[ch][i] > 0) fv.push(A.f0[ch][i]); } return { ch, n, d: n ? d / n : -99, fv }; });
      const top = sc.slice().sort((p, q) => q.n - p.n)[0]; o.ch = A.nC > 1 ? top.ch : 0; o.db = top.n ? +top.d.toFixed(1) : null; const fv = top.fv.sort((p, q) => p - q);
      if (fv.length > 3) { o.f0 = Math.round(fv[fv.length >> 1]); o.f0end = Math.round(fv.slice(-Math.max(2, fv.length >> 2)).reduce((p, q) => p + q, 0) / Math.max(2, fv.length >> 2)); o.f0rng = +(12 * Math.log2(fv[Math.floor(fv.length * .9)] / fv[Math.floor(fv.length * .1)])).toFixed(1); }
      if (A.nC > 1) o.both = sc.filter(x => x.n > 3).length > 1; }
    return o; });
  /* screen: rrweb events replayed into a node map; clicks, typing, page and panel changes, idle stretches */
  try {
    const R = await get("get_rrweb_events"); let ev = (R.Ok ? R.Ok.payload : R).events || []; if (typeof ev === "string") ev = JSON.parse(ev);
    ev = ev.map(e => typeof e === "string" ? JSON.parse(e) : e).sort((p, q) => p.timestamp - q.timestamp);
    const nodes = new Map(), rel = ts => +(((ts - (a0 || ev[0].timestamp)) / 1000)).toFixed(1);
    const add = (n, parent) => { if (!n || n.id == null) return; const o = { id: n.id, type: n.type, tag: (n.tagName || "").toLowerCase(), attrs: n.attributes || {}, text: n.textContent || "", parent, kids: [] }; nodes.set(n.id, o); const p = nodes.get(parent); if (p) p.kids.push(n.id); (n.childNodes || []).forEach(c => add(c, n.id)); };
    const txt = (id, lim, depth) => { const n = nodes.get(id); if (!n || (depth || 0) > 8) return ""; if (n.type === 3) return n.text; if (["script", "style", "svg", "path"].includes(n.tag)) return ""; let s = ""; for (const k of n.kids) { s += " " + txt(k, lim, (depth || 0) + 1); if (s.length > lim) break; } return s.replace(/\s+/g, " ").trim().slice(0, lim); };
    const attrL = n => n && (n.attrs["aria-label"] || n.attrs.title || n.attrs.placeholder || n.attrs.alt || n.attrs.name || "");
    const clickable = id => { let n = nodes.get(id), hops = 0; while (n && hops < 6) { const r = n.attrs.role; if (["button", "a", "input", "select", "textarea", "label", "li"].includes(n.tag) || ["button", "tab", "menuitem", "option", "checkbox", "radio", "link", "switch"].includes(r)) return n; n = nodes.get(n.parent); hops++; } return nodes.get(id); };
    const labelOf = id => { const n = clickable(id); if (!n) return ""; return mask((attrL(n) || txt(n.id, 70) || n.tag).slice(0, 70)); };
    const fieldOf = id => { const n = nodes.get(id); if (!n) return "field"; let l = attrL(n); if (!l && n.attrs.id) { for (const m of nodes.values()) if (m.tag === "label" && m.attrs.for === n.attrs.id) { l = txt(m.id, 40); break; } } if (!l) { const p = nodes.get(n.parent); l = p ? txt(p.id, 40) : ""; } return mask((l || n.tag).slice(0, 40)); };
    const tl = []; let lastAct = null; const idle = []; let lastInput = null, lastPanel = -99;
    for (const e of ev) {
      const t = rel(e.timestamp);
      if (e.type === 4) { const h = String(e.data.href || "").split("?")[0].split("#")[0].replace(/^https?:\/\/[^/]+/, ""); tl.push({ t, k: "page", l: h }); }
      if (e.type === 2) { nodes.clear(); add(e.data.node, null); tl.push({ t, k: "load", l: "screen loaded" }); }
      if (e.type !== 3) continue; const d = e.data, src = d.source;
      if (src === 0) { (d.removes || []).forEach(r => { const n = nodes.get(r.id); if (n) { const p = nodes.get(n.parent); if (p) p.kids = p.kids.filter(k => k !== r.id); } nodes.delete(r.id); });
        let big = 0; const heads = []; (d.adds || []).forEach(a => { add(a.node, a.parentId); const cnt = (function c(n) { return 1 + (n.childNodes || []).reduce((s, k) => s + c(k), 0); })(a.node); big += cnt; if (cnt > 15) { const n = nodes.get(a.node.id); const role = n && n.attrs.role; const h = txt(a.node.id, 60); if (h) heads.push((role === "dialog" ? "dialog: " : "") + h); } });
        (d.texts || []).forEach(x => { const n = nodes.get(x.id); if (n) n.text = x.value || ""; }); (d.attributes || []).forEach(x => { const n = nodes.get(x.id); if (n) Object.assign(n.attrs, x.attributes); });
        if (big > 40 && heads.length && t - lastPanel > 2) { tl.push({ t, k: "panel", l: mask(heads[0]).slice(0, 70) }); lastPanel = t; } }
      if (src === 2 && (d.type === 2 || d.type === 4)) { tl.push({ t, k: d.type === 4 ? "dblclick" : "click", l: labelOf(d.id) }); }
      if (src === 5) { const v = d.isChecked != null && d.text == null ? (d.isChecked ? "checked" : "unchecked") : mask(String(d.text || "").slice(0, 80)); if (lastInput && lastInput.id === d.id && t - lastInput.t < 4) { lastInput.ref.v = v; lastInput.t = t; } else { const o = { t, k: "type", l: fieldOf(d.id), v }; tl.push(o); lastInput = { id: d.id, t, ref: o }; } }
      if ([1, 2, 3, 5, 6].includes(src)) { if (lastAct != null && t - lastAct >= 12) idle.push([lastAct, +(t - lastAct).toFixed(1)]); lastAct = t; }
    }
    out.screen = { events: ev.length, span: ev.length ? [rel(ev[0].timestamp), rel(ev[ev.length - 1].timestamp)] : null, timeline: tl.filter(x => x.l || x.v).slice(0, 400), idle };
  } catch (e) { out.screenErr = String(e).slice(0, 120); }
  return out;
};
"srExtract ready";

/* Runs inside a logged-in GreenDot tab after extract.js (needs window.__tpl). Builds one call's highlight bundle for the desk:
   8 kHz mono audio for each clip (Int16, base64) and the rrweb screen events up to the end of the last clip, with emails and long
   digit runs masked. srClipButton(id, clips) puts a button on the page; pressing it copies the bundle so it can be pasted into the
   desk's "Add recording clips" box. */
window.srClipBuild = async function (id, clips) {
  const T = window.__tpl, OF = window.__of || window.fetch;
  const get = async k => { const t = T[k]; const m = t.body.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/); const r = await OF(window.__mkReq ? window.__mkReq(t, t.body.replace(m[0], id)) : new Request(t.req, { body: t.body.replace(m[0], id) })); return r.json(); };
  const mask = s => typeof s !== "string" ? s : s.replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]").replace(/\d[\d\s().-]{6,}\d/g, d => "•••" + d.replace(/\D/g, "").slice(-2));
  clips = clips.map(c => ({ s: Math.max(0, +c[0]), e: +c[1] })).sort((a, b) => a.s - b.s);
  const C = await get("get_call_captions"), a0 = Date.parse(C.Ok.payload.audio_start_utc);
  let st0 = NaN; try { const I = await get("get_call_info"); st0 = Date.parse(String(((I.Ok && I.Ok.payload && I.Ok.payload.wprop) || {}).start_time || "").replace(" ", "T")); } catch (e) {}
  /* audio */
  const SR = 8000; let res = null;
  for (let i = 0; i < 4; i++) { res = await OF(`/greendot/greendot-rust/call/${id}/audio`, { credentials: "include" }); if (res.ok) break; await new Promise(f => setTimeout(f, 1500)); }
  if (!res.ok) throw new Error("audio " + res.status);
  const ab = await new OfflineAudioContext(1, SR, SR).decodeAudioData(await res.arrayBuffer());
  /* skip the ring: sample 0 must be audio_start_utc, where the captions and the screen start */
  const lead = st0 ? Math.max(0, Math.min(ab.duration - 1, (a0 - st0) / 1000)) : 0, cut = Math.floor(lead * SR);
  const ch = [...Array(ab.numberOfChannels).keys()].map(c => ab.getChannelData(c).subarray(cut)), n = ch[0].length;
  const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  /* a clip may run past hang-up (the wrap-up on screen: save order, remark, WIRA task): the audio after the end is silence, not cut */
  const outClips = clips.map(c => { const i0 = Math.floor(c.s * SR), i1 = Math.floor(c.e * SR), len = Math.max(0, i1 - i0), dv = new DataView(new ArrayBuffer(len * 2));
    for (let i = 0; i < len; i++) { const j = i0 + i; if (j >= n) break; let v = 0; for (const x of ch) v += x[j]; v /= ch.length; dv.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(v * 32767))), true); }
    return { s: c.s, e: c.e, pcm: b64(new Uint8Array(dv.buffer)) }; });
  /* screen */
  const R = await get("get_rrweb_events"); let ev = (R.Ok ? R.Ok.payload : R).events || []; if (typeof ev === "string") ev = JSON.parse(ev);
  ev = ev.map(e => typeof e === "string" ? JSON.parse(e) : e).sort((p, q) => p.timestamp - q.timestamp);
  const end = a0 + (clips[clips.length - 1].e + 2) * 1000, first = a0 + clips[0].s * 1000;
  const inClip = ts => clips.some(c => ts >= a0 + (c.s - 1) * 1000 && ts <= a0 + (c.e + 1) * 1000);
  let fs = 0; ev.forEach((e, i) => { if (e.type === 2 && e.timestamp <= first) fs = i; });
  const start = fs > 0 && ev[fs - 1].type === 4 ? fs - 1 : fs;
  const walk = node => { if (!node) return; if (node.textContent) node.textContent = mask(node.textContent); if (node.attributes) for (const k of ["value", "placeholder", "title", "aria-label"]) if (node.attributes[k]) node.attributes[k] = mask(node.attributes[k]); (node.childNodes || []).forEach(walk); };
  const keep = [];
  for (let i = start; i < ev.length; i++) { const e = ev[i]; if (e.timestamp > end) break;
    if (e.type === 3 && (e.data.source === 1 || e.data.source === 3 || e.data.source === 6) && !inClip(e.timestamp)) continue;
    if (e.type === 2) walk(e.data.node);
    if (e.type === 3 && e.data.source === 0) { (e.data.adds || []).forEach(a => walk(a.node)); (e.data.texts || []).forEach(t => t.value = mask(t.value)); (e.data.attributes || []).forEach(a => { for (const k of ["value", "placeholder", "title", "aria-label"]) if (a.attributes && typeof a.attributes[k] === "string") a.attributes[k] = mask(a.attributes[k]); }); }
    if (e.type === 3 && e.data.source === 5 && typeof e.data.text === "string") e.data.text = mask(e.data.text);
    keep.push(e); }
  const out = JSON.stringify({ kind: "srMedia", v: 2, lead, callId: id, sr: SR, audioStart: a0, t0: keep.length ? keep[0].timestamp : a0, clips: outClips, events: keep });
  return { json: out, mb: +(out.length / 1048576).toFixed(2), events: keep.length, clips: outClips.length };
};
window.srClipButton = async function (id, clips, label) {
  const r = await window.srClipBuild(id, clips); window.__clip = r.json;
  let b = document.getElementById("srClipBtn"); if (!b) { b = document.createElement("button"); b.id = "srClipBtn"; b.style.cssText = "position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);padding:14px 22px;font:600 16px sans-serif;background:#6d28d9;color:#fff;border:0;border-radius:10px;box-shadow:0 4px 16px rgba(0,0,0,.3);cursor:pointer"; document.body.appendChild(b); }
  b.textContent = `Copy clips: ${label || id.slice(0, 8)} (${r.mb} MB)`;
  b.onclick = async () => { try { await navigator.clipboard.writeText(window.__clip); b.textContent = "Copied ✓"; } catch (e) { b.textContent = "Copy failed: " + String(e).slice(0, 60); } };
  return { mb: r.mb, events: r.events, clips: r.clips };
};
"srClip ready";
