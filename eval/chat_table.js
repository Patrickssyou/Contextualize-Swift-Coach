// Before/after table over repeated runs:  node eval/chat_table.js --before=b1,o2,o3 --after=b15,f1,f2 [--sids=...]
// For each case: verdict per run, mean %, range, and how many runs land in the expected band (data/chats/eval_expect.json).
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, '..', 'data/chats/cases'), exp = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/chats/eval_expect.json'), 'utf8'));
const opt = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const sids = opt.sids ? opt.sids.split(',') : Object.keys(exp).filter(k => !k.startsWith('_'));
const V = { great: 'Great', good: 'Good', okay: 'Okay', needs_work: 'NeedsWork', miss: 'Miss' };
const side = (sid, tags) => { const runs = tags.map(t => path.join(DIR, `${sid}.${t}.audit.json`)).filter(fs.existsSync).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  if (!runs.length) return null; const p = runs.map(a => a.pct), e = exp[sid] || {};
  const inBand = runs.filter(a => (e.verdict || []).includes(a.verdict && a.verdict.id)).length;
  const naOk = runs.filter(a => (e.na || []).every(k => a.scores[k] === 'na')).length;
  const faultOk = runs.filter(a => (e.fault || []).includes(a.fault.who)).length;
  return { n: runs.length, list: runs.map(a => `${V[a.verdict.id]} ${a.pct}`).join(', '), mean: Math.round(p.reduce((s, x) => s + x, 0) / p.length * 10) / 10, lo: Math.min(...p), hi: Math.max(...p), inBand, naOk, faultOk,
    types: [...new Set(runs.map(a => a.caseType || '-'))].join('/') }; };
for (const sid of sids) { const e = exp[sid] || {}, b = side(sid, (opt.before || '').split(',')), a = side(sid, (opt.after || '').split(','));
  console.log(`${sid} ${(e.sa || '').padEnd(15)} ${String(e.type).padEnd(17)} expected ${(e.verdict || []).join('/')}`);
  [['before', b], ['after', a]].forEach(([k, x]) => x && console.log(`   ${k.padEnd(6)} mean ${String(x.mean).padStart(5)} range ${x.lo}-${x.hi} · in band ${x.inBand}/${x.n} · N/A right ${x.naOk}/${x.n} · fault ok ${x.faultOk}/${x.n} · type ${x.types} · ${x.list}`)); }
