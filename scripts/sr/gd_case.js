/* Runs in the GreenDot tab after gd_inject.js. One recording bundle per audited call, with the same agent's follow-up calls appended
   on one timeline: a follow-up at offset `off` seconds has its clips and screen events shifted by that much. Gzipped like the desk expects
   ({kind:"srMediaZ", callId, clips, z}). Batches go to window.__bq; srCopyNext() puts a button that copies the next batch (≤ 14 MB). */
window.srCaseZ = async function (mainId, mainClips, legs) {
  const M = JSON.parse((await window.srClipBuild(mainId, mainClips)).json);
  for (const L of legs || []) {
    const B = JSON.parse((await window.srClipBuild(L.id, L.clips)).json), sh = ts => M.audioStart + L.off * 1000 + (ts - B.audioStart);
    B.clips.forEach(c => M.clips.push({ s: c.s + L.off, e: c.e + L.off, pcm: c.pcm, leg: L.id }));
    B.events.forEach(e => M.events.push(Object.assign({}, e, { timestamp: sh(e.timestamp) })));
  }
  M.events.sort((p, q) => p.timestamp - q.timestamp); M.legs = (legs || []).map(L => ({ id: L.id, off: L.off }));
  const txt = JSON.stringify(M), gz = await new Response(new Blob([txt]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer();
  const u8 = new Uint8Array(gz); let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return { kind: "srMediaZ", callId: mainId, clips: M.clips.map(c => ({ s: c.s, e: c.e })), z: btoa(s) };
};
window.srRunCases = async function (jobs) {
  window.__bz = window.__bz || []; window.__bzErr = window.__bzErr || {}; window.__bzDone = false;
  for (const j of jobs) { try { const z = await window.srCaseZ(j.id, j.clips, j.legs); window.__bz.push(z); } catch (e) { window.__bzErr[j.id] = String(e).slice(0, 100); } }
  window.__bzDone = true;
};
window.srCopyNext = function () {
  const L = window.__bz || [], items = []; let n = 0;
  while (L.length && (items.length === 0 || n + L[0].z.length < 14e6)) { const x = L.shift(); n += x.z.length; items.push(x); }
  window.__clip = JSON.stringify({ kind: "srBatch", items });
  let b = document.getElementById("srClipBtn"); if (!b) { b = document.createElement("button"); b.id = "srClipBtn"; b.style.cssText = "position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);padding:14px 22px;font:600 16px sans-serif;background:#6d28d9;color:#fff;border:0;border-radius:10px;cursor:pointer"; document.body.appendChild(b); }
  b.textContent = `Copy ${items.length} recordings (${(window.__clip.length / 1048576).toFixed(1)} MB) · ${L.length} left`;
  b.onclick = async () => { try { await navigator.clipboard.writeText(window.__clip); b.textContent = "Copied ✓"; } catch (e) { b.textContent = "Copy failed: " + String(e).slice(0, 60); } };
  return { items: items.length, mb: +(window.__clip.length / 1048576).toFixed(1), left: L.length };
};
window.srCopyRaw = function () {
  window.__clip = JSON.stringify({ kind: "srRaw", calls: window.__raw });
  let b = document.getElementById("srClipBtn"); if (!b) { b = document.createElement("button"); b.id = "srClipBtn"; b.style.cssText = "position:fixed;z-index:2147483647;top:12px;left:50%;transform:translateX(-50%);padding:14px 22px;font:600 16px sans-serif;background:#6d28d9;color:#fff;border:0;border-radius:10px;cursor:pointer"; document.body.appendChild(b); }
  b.textContent = `Copy ${Object.keys(window.__raw).length} calls (${(window.__clip.length / 1048576).toFixed(1)} MB)`;
  b.onclick = async () => { try { await navigator.clipboard.writeText(window.__clip); b.textContent = "Copied ✓"; } catch (e) { b.textContent = "Copy failed: " + String(e).slice(0, 60); } };
  return window.__clip.length;
};
"srCase ready";
