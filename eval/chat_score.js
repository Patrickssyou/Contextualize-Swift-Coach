// Compare chat audits across runs:  node eval/chat_score.js <tag> [tag...] [--sids=a,b]
// Reads data/chats/cases/<sid>.<tag>.audit.json and data/chats/eval_expect.json (my expected labels; real data, git-ignored).
// Flags: comp logic on a non-compensation chat, fa/amt scored where they should be N/A, verdict outside the expected band, wrong fault.
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'data/chats/cases'), EXP = path.join(__dirname, '..', 'data/chats/eval_expect.json');
const args = process.argv.slice(2), tags = args.filter(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => a.replace(/^--/, '').split('=')));
const exp = fs.existsSync(EXP) ? JSON.parse(fs.readFileSync(EXP, 'utf8')) : {};
const sids = opt.sids ? opt.sids.split(',') : Object.keys(exp).filter(k => !k.startsWith('_'));
const rows = [];
for (const sid of sids) for (const tag of tags) {
  const f = path.join(DIR, `${sid}.${tag}.audit.json`); if (!fs.existsSync(f)) continue;
  const a = JSON.parse(fs.readFileSync(f, 'utf8')), e = exp[sid] || {}, flags = [];
  const type = a.caseType || '', compUsed = !!(a.bucket && a.bucket.id);
  if (e.comp === false && compUsed) flags.push(`bucket ${a.bucket.id} on a non-comp chat`);
  if (e.comp === true && !compUsed) flags.push('no bucket on a comp chat');
  (e.na || []).forEach(k => { if (a.scores[k] !== 'na') flags.push(`${k}=${a.scores[k]} (should be N/A)`); });
  (e.notNa || []).forEach(k => { if (a.scores[k] === 'na') flags.push(`${k}=N/A (should be scored)`); });
  if (e.fault && !e.fault.includes(a.fault.who)) flags.push(`fault ${a.fault.who} (expected ${e.fault.join('/')})`);
  if (e.type && type && type !== e.type) flags.push(`type ${type} (expected ${e.type})`);
  const v = a.verdict && a.verdict.id, inBand = e.verdict ? e.verdict.includes(v) : null;
  if (e.verdict && !inBand) flags.push(`verdict ${v} (expected ${e.verdict.join('/')})`);
  const contra = (a.claims || []).filter(c => c.check === 'contradicted').length, cant = (a.claims || []).filter(c => c.check === 'cant_check').length;
  rows.push({ sid, tag, sa: (e.sa || '').split(' ')[0], type: type || '-', verdict: v, pct: a.pct, fault: a.fault.who, bucket: a.bucket.id || '-',
    scores: Object.entries(a.scores).map(([k, x]) => `${k}:${x}`).join(' '), claims: `${contra}x/${cant}?/${(a.claims || []).length}`, ok: flags.length === 0, flags });
}
rows.forEach(r => console.log(`${r.sid} ${r.tag.padEnd(5)} ${r.sa.padEnd(7)} ${r.type.padEnd(17)} ${String(r.verdict).padEnd(10)} ${String(r.pct).padStart(5)}  fault ${r.fault.padEnd(12)} bucket ${r.bucket.padEnd(19)} ${r.scores}  claims ${r.claims}${r.flags.length ? '\n      ! ' + r.flags.join('; ') : ''}`));
const byTag = {}; rows.forEach(r => { const t = byTag[r.tag] = byTag[r.tag] || { n: 0, inBand: 0, flags: 0 }; t.n++; t.flags += r.flags.length; if (!r.flags.some(f => f.startsWith('verdict'))) t.inBand++; });
Object.entries(byTag).forEach(([t, s]) => console.log(`${t}: ${s.n} cases · verdict in band ${s.inBand}/${s.n} · ${s.flags} flags`));
