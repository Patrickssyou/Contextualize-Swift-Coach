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
  /* audio */
  const SR = 8000; let res = null;
  for (let i = 0; i < 4; i++) { res = await OF(`/greendot/greendot-rust/call/${id}/audio`, { credentials: "include" }); if (res.ok) break; await new Promise(f => setTimeout(f, 1500)); }
  if (!res.ok) throw new Error("audio " + res.status);
  const ab = await new OfflineAudioContext(1, SR, SR).decodeAudioData(await res.arrayBuffer());
  const ch = [...Array(ab.numberOfChannels).keys()].map(c => ab.getChannelData(c)), n = ch[0].length;
  const b64 = u8 => { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  const outClips = clips.map(c => { const i0 = Math.floor(c.s * SR), i1 = Math.min(n, Math.floor(c.e * SR)), len = Math.max(0, i1 - i0), dv = new DataView(new ArrayBuffer(len * 2));
    for (let i = 0; i < len; i++) { let v = 0; for (const x of ch) v += x[i0 + i]; v /= ch.length; dv.setInt16(i * 2, Math.max(-32768, Math.min(32767, Math.round(v * 32767))), true); }
    return { s: c.s, e: Math.min(c.e, n / SR), pcm: b64(new Uint8Array(dv.buffer)) }; });
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
  const out = JSON.stringify({ kind: "srMedia", v: 1, callId: id, sr: SR, audioStart: a0, t0: keep.length ? keep[0].timestamp : a0, clips: outClips, events: keep });
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
