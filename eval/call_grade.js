// The call grade pass, blind, from this machine, the same passes the page runs (facts -> analysis -> grade; facts and analysis reused from aiFacts when there).
//   node eval/call_grade.js week [--week=2026-10-05] [--only=queueId,...] [--conc=6] [--redo] [--model=sonnet]
//   node eval/call_grade.js gt [--runs=3] [--tag=name]          grade the QA lead's own audited calls and score agreement
// Inputs (git-ignored, real data):
//   data/live_queue_<week>/queue/<queueId>.json       the week's queue docs (chain legs, tasks, aiFacts for some)
//   data/calls/week_<week>/tx/<legId>.json            {id, text} transcripts (Lightdash, transcriptConfig)
//   data/live_audits/audits/*.json                    the QA lead's audits; only those with a call link can be graded
//   data/calls/gt/tx/<legId>.json, data/calls/gt/tasks.json   transcripts and WIRA task rows for those calls
// Outputs: data/calls/week_<week>/grades/<queueId>.json  {v, at, by, items, scores, reasons, cites, wentWell, fixes, summary, F, A}
//          data/calls/gt/runs/<tag>/<auditId>.json, and the agreement table on stdout.
// The rubric is read from src/template.html (the live form's V2), so the eval grades on exactly what the page shows.
const fs = require('fs'), path = require('path'), os = require('os'), vm = require('vm'), { spawn } = require('child_process');
const C = require('../src/core.js'), B = require('../src/chat.js');
const ROOT = path.join(__dirname, '..');
const [mode] = process.argv.slice(2);
const opt = Object.fromEntries(process.argv.slice(3).map(a => a.replace(/^--/, '').split('=')));
const week = opt.week || '2026-10-05', conc = Number(opt.conc || 6), model = opt.model || 'sonnet';
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8')), wj = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)) };
const val = d => (d && d.value && typeof d.value === 'object' && !d.agent ? d.value : d);

/* the live form's rubric: the block between "rubric" and "stable keys" in the template, run in a sandbox */
function liveRubric() {
  const t = fs.readFileSync(path.join(ROOT, 'src/template.html'), 'utf8');
  const a = t.indexOf('/* ---------- rubric ---------- */'), b = t.indexOf('/* stable keys');
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(t.slice(a, b).replace('__RUBRIC_V1__', '{}') + '\nthis.V2 = V2;', ctx);
  return ctx.V2;
}
const V2 = liveRubric();
const itemsFor = type => (V2[type] || V2.call).flatMap(s => s.items.map(it => ({ id: it.id, label: it.label, w: it.w, lv: it.lv, na: it.na || null, section: s.name })));

function claude(prompt) {
  return new Promise((resolve, reject) => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'cg-'));
    const p = spawn('claude', ['-p', '--safe-mode', '--model', model, '--tools', '', '--output-format', 'text',
      '--system-prompt', 'Follow the instructions in the message exactly. Reply with only the JSON object it asks for.'], { cwd });
    let out = '', err = '';
    p.stdout.on('data', d => out += d); p.stderr.on('data', d => err += d);
    const t = setTimeout(() => p.kill('SIGKILL'), 15 * 60e3);
    p.on('close', code => { clearTimeout(t); if (code) return reject({ code: 'cli', message: err.slice(0, 300) }); resolve(out) });
    p.stdin.end(prompt);
  });
}
function asker(logFile) {
  return async (prompt, pass) => {
    let txt;
    try { txt = await claude(prompt) } catch (e) { txt = await claude(prompt) }
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.appendFileSync(logFile, `\n=== ${pass} (${prompt.length} chars in) ===\n${txt}\n`);
    const a = txt.indexOf('{'), b = txt.lastIndexOf('}');
    try { return JSON.parse(txt.slice(a, b + 1)) } catch (e) { throw { code: 'invalid_json', text: txt } }
  };
}
const gradeDoc = (R, items) => ({ v: C.CALL_GRADE_V, at: new Date().toISOString(), by: 'claude-checkpoint', items: items.map(i => i.id),
  caseType: R.G.caseType, caseWhy: R.G.caseWhy, scores: R.G.scores, reasons: R.G.reasons, cites: R.G.cites, wentWell: R.G.wentWell, fixes: R.G.fixes, summary: R.G.summary, F: R.F, A: R.A });

async function pool(list, fn) {
  let i = 0; const fail = [];
  await Promise.all(Array.from({ length: Math.min(conc, list.length) }, async () => {
    while (i < list.length) { const x = list[i++]; try { await fn(x) } catch (e) { fail.push(x); console.log(`FAIL ${x.id || x} ${e.code || ''} ${String(e.message || e.text || '').slice(0, 200)}`) } }
  }));
  return fail;
}

async function runWeek() {
  const QD = path.join(ROOT, `data/live_queue_${week}/queue`), W = path.join(ROOT, `data/calls/week_${week}`);
  const tx = id => { const f = path.join(W, 'tx', id + '.json'); return fs.existsSync(f) ? rj(f).text || '' : '' };
  let docs = fs.readdirSync(QD).filter(f => f.endsWith('.json')).map(f => Object.assign({ id: f.replace(/\.json$/, '') }, val(rj(path.join(QD, f))))).filter(q => !q.removed);
  if (opt.only) { const o = new Set(opt.only.split(',')); docs = docs.filter(q => o.has(q.id)) }
  /* --out=<dir>: write to data/calls/week_<w>/<dir> instead of grades; --frozen=<dir>: reuse that dir's facts and analysis so only the grade pass varies */
  const out = opt.out || 'grades';
  if (!('redo' in opt)) docs = docs.filter(q => !fs.existsSync(path.join(W, out, q.id + '.json')));
  if (opt.frozen) docs.forEach(q => { const g = rj(path.join(W, opt.frozen, q.id + '.json')); q.aiFacts = Object.assign({}, g.A, { facts: Object.assign({}, g.A.facts || {}, { timeline: g.F.timeline, calls: g.F.calls }) }) });
  console.log(`week ${week}: ${docs.length} to grade into ${out}, ${conc} at a time`);
  const fail = await pool(docs, async q => {
    const items = itemsFor(q.type), legs = q.chain.legs.map(l => ({ id: l.id, text: tx(l.id) }));
    const R = await C.gradeCall(q, { ask: asker(path.join(W, 'logs', q.id + (opt.out ? '.' + out : '') + '.log')), transcripts: legs, items, lessons: [], repair: B.repairJson });
    wj(path.join(W, out, q.id + '.json'), gradeDoc(R, items));
    console.log(`${q.id} ${q.agent} ${q.type} ${C.callScore(R.G.scores, items)}% · ${Object.keys(R.G.scores).length}/${items.length} scored · ${items.filter(i => !(R.G.cites[i.id] || []).length && R.G.scores[i.id] != null && R.G.scores[i.id] !== 'na').length} uncited`);
  });
  console.log(`done; ${fail.length} failed${fail.length ? ': ' + fail.map(q => q.id).join(', ') : ''}`);
}

/* ---- the QA lead's audits: only those with a call link can be placed. v1 audits are on 1-3 with "mark 3 if N/A" ---- */
function gtCases() {
  const A = path.join(ROOT, 'data/live_audits/audits'), G = path.join(ROOT, 'data/calls/gt');
  const pull = val(rj(path.join(ROOT, 'data/live3/pulls/2026-09-21.json')));
  const tasks = fs.existsSync(path.join(G, 'tasks.json')) ? rj(path.join(G, 'tasks.json')) : null;
  return fs.readdirSync(A).filter(f => f.endsWith('.json')).map(f => Object.assign({ id: f.replace(/\.json$/, '') }, val(rj(path.join(A, f))))).filter(a => a.link && a.type === 'call').map(a => {
    const cid = (String(a.link).match(/callId=([0-9a-f-]{36})/) || [])[1], code = (String(a.link).match(/restaurant\/(R\d+)/) || [])[1] || '';
    const p = (pull.population || []).find(x => x.id === cid);
    if (!p || (p.ids || []).length > 1) return null;   // single-leg calls only (both linked audits are)
    const q = { id: a.id, agent: a.agent, type: 'call', kind: p.kind, restaurantId: code, restaurantName: p.name, callDate: p.at.slice(0, 10),
      chain: { legs: [{ id: cid, at: p.at, sec: p.sec, who: a.agent, graded: true, own: true, dir: 'in', party: 'caller' }] }, tasks: [] };
    if (tasks) { const R = C.makeRoster(C.ROSTER_DEFAULT), ag = R.agents.find(x => x.name === a.agent), rows = C.taskRows(tasks);
      const legs = C.legsOfDoc(q), link = C.linkTasks({ legs, code }, rows, ag, C.TASKS), byId = new Map(rows.map(r => [r.id, r.raw]));
      q.tasks = link.map(l => C.taskDoc(byId.get(l.id), l, ag, C.TASKS)) }
    return { audit: a, q, tx: [{ id: cid, text: fs.existsSync(path.join(G, 'tx', cid + '.json')) ? rj(path.join(G, 'tx', cid + '.json')).text : '' }] };
  }).filter(Boolean);
}
async function runGt() {
  const cases = gtCases(), runs = Number(opt.runs || 3), tag = opt.tag || 'base', items = itemsFor('call'), D = path.join(ROOT, 'data/calls/gt/runs', tag);
  console.log(`${cases.length} audited calls with a link · ${runs} runs · tag ${tag}`);
  const jobs = []; cases.forEach(c => { for (let r = 1; r <= runs; r++) jobs.push({ id: `${c.audit.id}.r${r}`, c, r }) });
  /* --frozen=<tag>: reuse that tag's run-1 facts and analysis for every run, so only the grade pass varies (the page does the same when aiFacts is saved) */
  if (opt.frozen) cases.forEach(c => { const g = rj(path.join(ROOT, 'data/calls/gt/runs', opt.frozen, c.audit.id + '.r1.json')); c.q.aiFacts = Object.assign({}, g.A, { facts: Object.assign({}, g.A.facts || {}, { timeline: g.F.timeline, calls: g.F.calls }) }) });
  await pool(jobs.filter(j => 'redo' in opt || !fs.existsSync(path.join(D, j.id + '.json'))), async j => {
    /* without --frozen the facts and analysis are rebuilt per run, so each run is the whole route */
    const R = await C.gradeCall(j.c.q, { ask: asker(path.join(D, 'logs', j.id + '.log')), transcripts: j.c.tx, items, lessons: [], repair: B.repairJson });
    wj(path.join(D, j.id + '.json'), gradeDoc(R, items));
  });
  /* agreement: per criterion exact and within 1. v1 has no 0 ("1 = wrong or skipped") and N/A = 3, so ours is mapped 0->1, na->3 for the v1 comparison */
  const v1 = s => s === 'na' ? 3 : Math.max(1, Number(s));
  const v1Total = sc => { let g = 0, d = 0; items.forEach(it => { const s = sc[it.id]; if (s == null) return; d += it.w; g += it.w * (v1(s) - 1) / 2 }); return d ? Math.round(g / d * 1000) / 10 : null };
  const rows = [], per = {}; let ex = 0, w1 = 0, n = 0;
  cases.forEach(c => { for (let r = 1; r <= runs; r++) { const f = path.join(D, `${c.audit.id}.r${r}.json`); if (!fs.existsSync(f)) continue; const g = rj(f);
    let e = 0, o = 0, k = 0;
    items.forEach(it => { const p = c.audit.scores[it.id], s = g.scores[it.id]; if (p == null || s == null) return; const d = Math.abs(v1(s) - p); k++; if (d === 0) e++; if (d <= 1) o++;
      (per[it.id] = per[it.id] || { ex: 0, w1: 0, n: 0, lead: [], ours: [] }); per[it.id].n++; if (d === 0) per[it.id].ex++; if (d <= 1) per[it.id].w1++; per[it.id].lead.push(p); per[it.id].ours.push(s) });
    ex += e; w1 += o; n += k;
    rows.push({ audit: c.audit.id, agent: c.audit.agent, code: c.q.restaurantId, run: r, lead: c.audit.total, oursV2: C.callScore(g.scores, items), oursV1: v1Total(g.scores), exact: `${e}/${k}`, within1: `${o}/${k}` }) } });
  console.table(rows);
  console.table(Object.fromEntries(Object.entries(per).map(([id, v]) => [id, { exact: `${v.ex}/${v.n}`, within1: `${v.w1}/${v.n}`, lead: v.lead.join(' '), ours: v.ours.join(' ') }])));
  const dT = rows.map(r => Math.abs(r.oursV1 - r.lead)), dT2 = rows.map(r => Math.abs(r.oursV2 - r.lead));
  console.log(`overall exact ${ex}/${n} (${Math.round(ex / n * 100)}%) · within 1 ${w1}/${n} (${Math.round(w1 / n * 100)}%) · mean |total diff| v1 formula ${(dT.reduce((a, b) => a + b, 0) / dT.length).toFixed(1)} pts, v2 formula ${(dT2.reduce((a, b) => a + b, 0) / dT2.length).toFixed(1)} pts`);
}

(mode === 'week' ? runWeek() : mode === 'gt' ? runGt() : Promise.reject(new Error('usage: node eval/call_grade.js week|gt'))).catch(e => { console.error(e); process.exit(1) });
