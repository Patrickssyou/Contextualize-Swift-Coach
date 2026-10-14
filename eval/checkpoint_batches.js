// Plan the ArtifactData batch writes that load a checkpoint into the live db (the main session sends them).
//   node eval/checkpoint_batches.js <cpId> [--week=2026-10-05] [--existing=sid:ver,...]
// Prints one JSON array of writes per line, each under 50 entries and ~900 KB.
const fs = require('fs'), path = require('path');
const [cp] = process.argv.slice(2);
const opt = Object.fromEntries(process.argv.slice(3).map(a => a.replace(/^--/, '').split('=')));
const week = opt.week || '2026-10-05', OUT = path.join(__dirname, '..', 'data/checkpoints', cp);
const existing = Object.fromEntries((opt.existing || '').split(',').filter(Boolean).map(x => x.split(':')));
const writes = [];
const add = (collection, dir, kind) => fs.readdirSync(path.join(OUT, dir)).filter(f => f.endsWith('.json')).sort().forEach(f => {
  const sid = f.replace('.json', ''), file = path.join(OUT, dir, f), w = { op: 'set', collection, doc_id: sid, file_path: file };
  const v = existing[`${kind}/${sid}`]; if (v) w.if_version = Number(v);
  writes.push([w, fs.statSync(file).size]);
});
add(`chatWeeks/${week}/audits`, 'audits', 'audits');
add(`chatWeeks/${week}/tx`, 'tx', 'tx');
add(`brainRuns/${cp}/grades`, 'grades', 'grades');
writes.push([{ op: 'set', collection: 'brainRuns', doc_id: cp, file_path: path.join(OUT, 'run.json') }, 2000]);
let cur = [], size = 0;
const flush = () => { if (cur.length) console.log(JSON.stringify(cur)); cur = []; size = 0 };
writes.forEach(([w, s]) => { if (cur.length >= 50 || size + s > 900e3) flush(); cur.push(w); size += s });
flush();
