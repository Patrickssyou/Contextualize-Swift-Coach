// The case-type pass alone, blind through the Claude CLI, over calls already graded (their saved facts, no regrade).
//   node eval/call_case.js [--week=2026-10-05] [--only=queueId,...] [--conc=6] [--redo] [--model=sonnet]
// Inputs (git-ignored, real data):
//   data/live_queue_<week>/queue/<queueId>.json        the queue doc (restaurant, kind, legs, tasks)
//   data/calls/week_<week>/grades/<queueId>.json       the saved grade; field F = the pass-1 facts
// Output: data/calls/week_<week>/cases/<queueId>.json  {caseType, caseWhy}, and the distribution on stdout.
const fs = require('fs'), path = require('path'), os = require('os'), { spawn } = require('child_process');
const C = require('../src/core.js'), B = require('../src/chat.js');
const ROOT = path.join(__dirname, '..');
const opt = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const week = opt.week || '2026-10-05', conc = Number(opt.conc || 6), model = opt.model || 'sonnet';
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8')), wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)) };
const val = d => (d && d.value && typeof d.value === 'object' && !d.agent ? d.value : d);
const W = path.join(ROOT, `data/calls/week_${week}`), QD = path.join(ROOT, `data/live_queue_${week}/queue`), OUT = path.join(W, 'cases');

function claude(prompt) {
  return new Promise((resolve, reject) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-'));
    const p = spawn('claude', ['-p', '--safe-mode', '--model', model, '--tools', '', '--output-format', 'text',
      '--system-prompt', 'Follow the instructions in the message exactly. Reply with only the JSON object it asks for.'], { cwd });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    const t = setTimeout(() => p.kill('SIGKILL'), 5 * 60e3);
    p.on('close', code => { clearTimeout(t); if (code) return reject({ code: 'cli', message: err.slice(0, 300) }); resolve(out) });
    p.stdin.end(prompt);
  });
}
async function ask(prompt) {
  let txt; try { txt = await claude(prompt) } catch (e) { txt = await claude(prompt) }
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
  try { return JSON.parse(txt.slice(a, b + 1)) } catch (e) { return B.repairJson(txt) }
}

(async () => {
  let ids = fs.readdirSync(path.join(W, 'grades')).filter(f => f.endsWith('.json')).map(f => f.replace(/\.json$/, ''));
  if (opt.only) { const o = new Set(opt.only.split(',')); ids = ids.filter(id => o.has(id)) }
  const todo = ids.filter(id => 'redo' in opt || !fs.existsSync(path.join(OUT, id + '.json')));
  console.log(`week ${week}: ${ids.length} graded, ${todo.length} to classify`);
  let i = 0; const fail = [];
  await Promise.all(Array.from({ length: Math.min(conc, todo.length) }, async () => {
    while (i < todo.length) { const id = todo[i++];
      try {
        const g = rj(path.join(W, 'grades', id + '.json')), q = Object.assign({ id }, val(rj(path.join(QD, id + '.json'))));
        const tx = l => { const f = path.join(W, 'tx', l.id + '.json'); return { id: l.id, text: fs.existsSync(f) ? rj(f).text || '' : '' } };
        const input = C.callInput(q, q.chain.legs.map(tx));
        const R = C.cleanCallCase(await ask(C.callCasePrompt(input, g.F)));
        if (!R) throw { code: 'ai_shape' };
        wj(path.join(OUT, id + '.json'), R); console.log(`${id} ${q.agent} ${q.type} ${R.caseType} | ${R.caseWhy}`);
      } catch (e) { fail.push(id); console.log(`FAIL ${id} ${e.code || ''} ${String(e.message || '').slice(0, 200)}`) } }
  }));
  const dist = {}; ids.forEach(id => { const f = path.join(OUT, id + '.json'); const t = fs.existsSync(f) ? rj(f).caseType : '(none)'; dist[t] = (dist[t] || 0) + 1 });
  console.table(Object.entries(dist).sort((a, b) => b[1] - a[1]).map(([id, n]) => ({ id, label: (C.CALL_CASE_TYPES.find(t => t.id === id) || {}).label || '', n })));
  console.log(`done; ${fail.length} failed${fail.length ? ': ' + fail.join(', ') : ''}`);
})().catch(e => { console.error(e); process.exit(1) });
