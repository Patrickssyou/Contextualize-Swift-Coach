// A checkpoint: grade every base chat of a week with the current brain, blind, from this machine, the same way the page does.
//   node eval/checkpoint.js <cpId> [--week=2026-10-05] [--conc=8] [--only=sid,sid] [--model=sonnet]
// Inputs (git-ignored, real data):
//   data/chats/week_<week>/base_full.json        the week's base rows
//   data/chats/week_<week>/pool/                  Lightdash rows answered offline by eval/week_pool.js
//   data/checkpoints/<cpId>/inputs.json           {policy, cal, lessons, learned, notes} copied from the live db by the main session
// Outputs: data/checkpoints/<cpId>/{audits,tx,grades}/<sid>.json and run.json (the brainRuns doc).
// The refs pass is cached per chat in data/checkpoints/refs/<sid>.json so every checkpoint links the same evidence.
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const B = require('../src/chat.js'), C = require('../src/core.js');
const ROOT = path.join(__dirname, '..');
const [cp] = process.argv.slice(2);
const opt = Object.fromEntries(process.argv.slice(3).map(a => a.replace(/^--/, '').split('=')));
if (!cp) throw new Error('usage: node eval/checkpoint.js <cpId>');
const week = opt.week || '2026-10-05', conc = Number(opt.conc || 8), model = opt.model || 'sonnet';
const OUT = path.join(ROOT, 'data/checkpoints', cp), REFS = path.join(ROOT, 'data/checkpoints/refs');
['audits', 'tx', 'grades', 'logs'].forEach(d => fs.mkdirSync(path.join(OUT, d), { recursive: true })); fs.mkdirSync(REFS, { recursive: true });
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8')), wj = (f, o) => fs.writeFileSync(f, JSON.stringify(o, null, 1));
const inputs = rj(path.join(OUT, 'inputs.json'));
const { poolQuery } = require('./week_pool.js');

/* one Claude pass, blind: no tools, no project files. A reply that isn't JSON is passed back as invalid_json so the brain's askPass can repair it, like the page */
function claude(prompt) {
  return new Promise((resolve, reject) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-'));
    const p = spawn('claude', ['-p', '--safe-mode', '--model', model, '--tools', '', '--output-format', 'text',
      '--system-prompt', 'Follow the instructions in the message exactly. Reply with only the JSON object it asks for.'], { cwd });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    const t = setTimeout(() => p.kill('SIGKILL'), 15 * 60e3);
    p.on('close', code => { clearTimeout(t); if (code) return reject({ code: 'cli', message: err.slice(0, 300) }); resolve(out) });
    p.stdin.end(prompt);
  });
}
async function ask(prompt, pass, sid) {
  let txt;
  try { txt = await claude(prompt) } catch (e) { txt = await claude(prompt) }   // one retry on a CLI failure only
  fs.appendFileSync(path.join(OUT, 'logs', sid + '.log'), `\n=== ${pass} ===\n${txt}\n`);
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  try { return JSON.parse(txt.slice(a, b + 1)) } catch (e) { throw { code: 'invalid_json', text: txt } }
}

async function gradeOne(c) {
  const refsFile = path.join(REFS, c.sid + '.json');
  const deps = {
    query: async (cfg, title) => poolQuery(cfg, title),
    ask: async (prompt, pass) => {
      if (pass === 'refs') { if (fs.existsSync(refsFile)) return rj(refsFile); const r = await ask(prompt, pass, c.sid); wj(refsFile, r); return r }
      return ask(prompt, pass, c.sid);
    },
    policy: inputs.policy, cal: inputs.cal || [], lessons: inputs.lessons || [], gradeRuns: 1,
  };
  const k = await B.chatContext(JSON.parse(JSON.stringify(c)), deps);
  const R = await B.gradeChat(k, deps);
  const doc = Object.assign(B.chatAuditDoc(k, R, { by: 'claude-checkpoint', at: new Date().toISOString() }), { checkpoint: cp });
  wj(path.join(OUT, 'audits', c.sid + '.json'), doc);
  wj(path.join(OUT, 'tx', c.sid + '.json'), B.chatTxDoc(k));
  const g = { sid: c.sid, sa: c.sa, restaurant: c.restaurant, pct: R.pct, verdict: R.verdict ? R.verdict.id : null, scores: R.G.scores, priority: doc.priority,
    caseType: R.A.caseType || '', fault: (R.A.fault || {}).who || '' };
  wj(path.join(OUT, 'grades', c.sid + '.json'), g);
  return g;
}

(async () => {
  const rows = rj(path.join(ROOT, 'data/chats', 'week_' + week, 'base_full.json'));
  const staff = (inputs.staff && inputs.staff.map) || {};
  let chats = B.pullChatWeekRows ? B.pullChatWeekRows(rows) : rows.map(x => B.chatRow(x, { roster: C.ROSTER_DEFAULT, staff })).filter(B.isBaseChat);
  const seen = new Set(); chats = chats.filter(c => c.wid && !seen.has(c.wid) && seen.add(c.wid));
  const gradable = chats.filter(B.chatGradable);
  let list = gradable;
  if (opt.only) { const o = new Set(opt.only.split(',')); list = gradable.filter(c => o.has(c.sid)) }
  if (!opt.redo) list = list.filter(c => !fs.existsSync(path.join(OUT, 'grades', c.sid + '.json')));
  console.log(`${cp}: ${chats.length} base chats, ${gradable.length} gradable, ${list.length} to grade, ${conc} at a time`);
  let i = 0, done = 0, fail = [];
  await Promise.all(Array.from({ length: conc }, async () => {
    while (i < list.length) { const c = list[i++];
      try { const g = await gradeOne(c); done++; console.log(`${done}/${list.length} ${c.sid} ${c.sa} ${g.verdict} ${g.pct}`) }
      catch (e) { fail.push(c.sid); console.log(`FAIL ${c.sid} ${e.code || ''} ${String(e.message || e).slice(0, 200)}`) }
    }
  }));
  // the brainRuns doc
  const G = gradable.map(c => path.join(OUT, 'grades', c.sid + '.json')).filter(fs.existsSync).map(rj);
  const avg = a => a.length ? Math.round(a.reduce((s, x) => s + x, 0) / a.length * 10) / 10 : null;
  const mix = l => Object.fromEntries(B.VERDICTS.map(([id]) => [id, l.filter(g => g.verdict === id).length]));
  const perSA = {}; G.forEach(g => (perSA[g.sa] = perSA[g.sa] || []).push(g));
  const run = { id: cp, round: Number(String(cp).replace(/\D/g, '')) || 0, at: new Date().toISOString(), brain: B.CHAT_V, model, week,
    chats: chats.length, graded: G.length, avgPct: avg(G.map(g => g.pct).filter(x => x != null)), verdicts: mix(G),
    perSA: Object.fromEntries(Object.entries(perSA).map(([sa, l]) => [sa, { n: l.length, avgPct: avg(l.map(g => g.pct).filter(x => x != null)), verdicts: mix(l) }])),
    lessonsUsed: (inputs.lessons || []).length, learned: inputs.learned || [], notes: inputs.notes || '' };
  wj(path.join(OUT, 'run.json'), run);
  console.log(`done: ${G.length} graded, ${fail.length} failed${fail.length ? ' (' + fail.join(',') + ')' : ''}; avg ${run.avgPct}`, JSON.stringify(run.verdicts));
})().catch(e => { console.error(e); process.exit(1) });
