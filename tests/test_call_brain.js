// The call grade pass's deterministic parts, on invented data only (no fixtures).
const assert = require('assert');
const C = require('../src/core.js'), B = require('../src/chat.js');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

/* a small rubric in the live form's shape: lv as an array, na = the N/A condition (absent = no N/A) */
const items = [
  { id: '1a', label: 'Opening', w: 0.25, lv: ['Skipped', 'Wrong', 'Missed one element', 'Full spiel'], na: "Agent didn't handle the opening" },
  { id: '2b', label: 'Root cause and fault', w: 0.5, lv: ['None', 'Wrong', 'Misread', 'Correct'], na: 'Inquiry only; nothing went wrong' },
  { id: '3c', label: 'Close', w: 0.25, lv: ['Abrupt', 'Vague', 'Adequate', 'Clear'] },
];
const F = { calls: {}, timeline: [
  { id: 'F1', src: 'Call 1', when: '1:00 PM', who: 'Dana Test', kind: 'said', what: 'Greets the caller as Sam from Tarro' },
  { id: 'F2', src: 'Call 1', when: '1:01 PM', who: 'the store', kind: 'said', what: 'Store says ticket C12 printed twice' },
  { id: 'F3', src: 'Call 1', when: '1:03 PM', who: 'Dana Test', kind: 'did', what: 'Voids the duplicate ticket' }],
  promises: [{ id: 'P1', src: 'Call 1', who: 'Dana Test', to: 'the store', what: 'Call back by 2 PM', by: '2 PM' }] };

// clamping and N/A
const g = C.cleanCallGrade({ criteria: {
  '1a': { why: 'Full spiel (F1).', cites: ['F1', 'F9'], score: 7 },
  '2b': { why: 'Read the duplicate right.', cites: ['f2', 'P1', 'P7'], score: '2.6' },
  '3c': { why: 'Not applicable.', cites: [], score: 'na' } },
  wentWell: ['- Voided the duplicate fast', 'b', 'c', 'd'], fixes: [{ id: '3c', what: 'No recap', should: 'Recap the void' }, { id: '9z', what: 'x', should: 'y' }], summary: 'Fine call.' }, items, F);
ok(g.scores['1a'] === 3, 'a score above the scale is clamped to 3');
ok(g.scores['2b'] === 3, 'a decimal score is rounded');
ok(!('3c' in g.scores), 'na on an item with no N/A is left unscored for the reviewer');
ok(g.reasons['3c'] === 'Not applicable.', 'the reason is kept even when the score is dropped');
const neg = C.cleanCallGrade({ criteria: { '1a': { why: '', score: -2 }, '2b': { why: '', score: 'N/A' }, '3c': { why: '', score: 'not applicable' } } }, items, F);
ok(neg.scores['1a'] === 0, 'a score below the scale is clamped to 0');
ok(neg.scores['2b'] === 'na', 'N/A is allowed where the item has an N/A condition');
ok(!('3c' in neg.scores), '"not applicable" is still refused on an item with no N/A');
ok(C.cleanCallGrade({ criteria: { '1a': { why: 'x', score: 'great' } } }, items, F) === null, 'no usable score at all: null');
ok(C.cleanCallGrade('nope', items, F) === null && C.cleanCallGrade([], items, F) === null, 'not an object: null');
const v1 = [{ id: '1a', label: 'Opening', w: 1, lv: { 1: 'wrong', 2: 'missed one', 3: 'full' } }];
ok(C.cleanCallGrade({ scores: { '1a': 0 } }, v1, F).scores['1a'] === 1, 'a 1-3 item clamps to its own floor');

// cites: only facts that exist, from "cites" and from ids named in the reason
ok(JSON.stringify(g.cites['1a']) === '["F1"]', 'a cite to a missing fact is dropped');
ok(JSON.stringify(g.cites['2b']) === '["F2","P1"]', 'cites are upper-cased and promises count');
ok(!g.cites['3c'], 'no cites, no entry');
const fromWhy = C.cleanCallGrade({ criteria: { '1a': { why: 'Opened well (F1, F3; not F44).', score: 3 } } }, items, F);
ok(JSON.stringify(fromWhy.cites['1a']) === '["F1","F3"]', 'fact ids named in the reason are cites too');

// the rest of the shape
ok(g.wentWell.length === 3 && g.wentWell[0] === 'Voided the duplicate fast', 'wentWell: at most 3, bullets stripped');
ok(g.fixes.length === 1 && g.fixes[0].id === '3c' && g.fixes[0].should === 'Recap the void', 'fixes only for known criteria');
ok(g.summary === 'Fine call.', 'summary kept');
const flat = C.cleanCallGrade({ scores: { '1a': 2 }, reasons: { '1a': 'Missed the name (F1)' }, cites: { '1a': ['F1'] } }, items, F);
ok(flat.scores['1a'] === 2 && flat.cites['1a'][0] === 'F1', 'the flat {scores, reasons, cites} shape is read too');

// the live form's total: score / 3 of the weight, N/A left out
ok(C.callScore({ '1a': 3, '2b': 'na', '3c': 0 }, items) === 50, 'total leaves N/A out of the weight');
ok(C.callScore({}, items) === null, 'no scores, no total');

// lessons, rendered like the chat brain's
const L = C.callLessonLines([
  { kind: 'contest', crit: '2b', label: 'Root cause and fault', from: 1, to: 3, reason: 'nothing went wrong on Tarro', what: 'agent never stated fault' },
  { kind: 'reinforce', crit: '3c', label: 'Close', from: 2, reason: 'the read-back was the confirmation', what: 'no summary' },
  { kind: 'not', crit: '1a', label: 'Opening', what: 'clipped greeting', reason: 'the recording starts late' }]);
ok(/Root cause and fault \(2b\): the coach gave 1, the QA lead says 3\. Why: nothing went wrong/.test(L), 'a contest names both marks and why');
ok(/mark is right, but the reasoning was off.*The right reason: the read-back/.test(L), 'a reinforce keeps the mark and teaches the reason');
ok(/the QA lead marked it not a mistake: the recording starts late/.test(L), 'a "not a mistake" lesson');
ok(L.split('\n').length === 3 && C.callLessonLines([]) === '', 'one line per lesson; none renders empty');

// input: talked legs only, case team
const q = { agent: 'Dana Test', type: 'case', kind: 'CL', restaurantId: 'R12345', restaurantName: 'Test Pizza', callDate: '2026-01-05', team: ['Lee Other'],
  chain: { legs: [
    { id: 'a', at: '2026-01-05T13:00:00', sec: 120, who: 'Dana Test', graded: true, dir: 'in', party: 'caller' },
    { id: 'b', at: '2026-01-05T13:03:00', sec: 20, who: 'Dana Test', graded: true, dir: 'out', party: '…1234' },
    { id: 'c', at: '2026-01-05T13:05:00', sec: 90, who: 'Lee Other', graded: false, group: 'sa', dir: 'in', party: 'caller' }] }, tasks: [] };
const talk = 'Hi, this is Sam from Tarro, how can I help? The ticket C12 printed twice, can you void one? Sure, voiding it now.';
const inp = C.callInput(q, [{ id: 'a', text: talk }, { id: 'b', text: 'Please leave a message after the tone.' }, { id: 'c', text: talk + ' Following up on the void.' }]);
ok(inp.legs.length === 2 && inp.setAside === 1 && !inp.legs.some(l => l.id === 'b'), 'voicemail leg set aside');
ok(inp.team.join(',') === 'Dana Test,Lee Other', 'case team starts with the audited agent');
ok(C.callInput(q, { a: talk }).legs.length === 1, 'transcripts as a map work; a leg with no text is set aside');
/* the page's shape: a queue-doc clone with id, queueId and legs carrying text; transcripts as {legId: text} */
const pageC = Object.assign({}, q, { id: 'ld-x', queueId: 'ld-x', legs: q.chain.legs.map(l => Object.assign({}, l, { text: l.id === 'c' ? talk : '' })) });
const pin = C.callInput(pageC, { a: talk, c: '' });
ok(pin.legs.map(l => l.id).join(',') === 'a,c' && pin.legs[1].text === talk, "page shape: c.legs used, an empty map entry keeps the leg's own text");

// the prompt: rubric levels, N/A conditions, facts, lessons, team rule, transcripts
const p = C.callGradePrompt(inp, F, { summary: 'Duplicate ticket voided.', rootCause: 'Ticket printed twice', faultAgent: 'none', faultCorrect: 'unclear', facts: { promises: [{ id: 'P1', status: 'kept', why: 'called back' }] } }, items, [{ kind: 'contest', crit: '2b', label: 'Root cause and fault', from: 1, to: 3, reason: 'plain request' }]);
ok(p.includes('0: Skipped') && p.includes('3: Full spiel') && p.includes('1: Vague'), 'every level is in the prompt');
ok(p.includes("N/A only when: Agent didn't handle the opening") && p.includes('No N/A: always score it.'), 'N/A conditions, and items without one');
ok(p.includes('F2 · 1:01 PM · Call 1 · the store [said]: Store says ticket C12 printed twice') && p.includes('P1 · Call 1 · Dana Test to the store: Call back by 2 PM'), 'facts and promises are listed');
ok(p.includes('P1: kept (called back)'), 'promise status from the analysis');
ok(p.includes('the coach gave 1, the QA lead says 3'), 'lessons are in the prompt');
ok(/This is a CASE: several agents worked it \(Dana Test, Lee Other\)/.test(p), 'case: graded once as a team');
ok(p.includes('GRADED · Dana Test') && p.includes('Lee Other, inbound from the caller') && !p.includes('leave a message'), 'transcripts of talked legs only');
ok(p.includes('"1a": {"why": "one sentence", "cites": ["F1"], "score": "0-3 or na"}') && p.includes('"3c": {"why": "one sentence", "cites": ["F1"], "score": "0-3"}'), 'reply shape offers na only where allowed');
ok(/customer or restaurant acting on a Tarro agent's instruction/.test(p) && /exact to the cent/.test(p) && /the decision AND the handling/.test(p), "the QA lead's standing rules");
const pc = C.callGradePrompt(Object.assign({}, q, { type: 'call', team: [] }), F, null, items, []);
ok(/Grade only what Dana Test said or did on the GRADED calls/.test(pc) && /credit Dana Test for a clean handoff/.test(pc) && pc.includes('No analysis'), 'a call (from a queue doc): graded on own legs, handoff credited');

// case type: the grade asks for it and keeps a known id (old ids read through the alias), else "other"
ok(p.includes('"caseType": "compensation | order_investigation | contact_customer') && p.includes('"caseWhy"') && p.includes('order_investigation (Order-taking investigation)'), 'grade prompt asks for caseType and caseWhy');
const gc = C.cleanCallGrade({ caseType: 'Order_Issue', caseWhy: 'Store asks to check the recording (F2).', criteria: { '1a': { why: 'F1', score: 3 } } }, items, F);
ok(gc.caseType === 'order_investigation' && gc.caseWhy === 'Store asks to check the recording (F2).', 'grade keeps caseType (alias applied) and caseWhy');
ok(C.cleanCallGrade({ caseType: 'refund_stuff', criteria: { '1a': { score: 3 } } }, items, F).caseType === 'other' && C.cleanCallGrade({ criteria: { '1a': { score: 3 } } }, items, F).caseType === 'other', 'unknown or missing caseType -> other');
ok(C.CALL_CASE_TYPES.every(t => t.id && t.label && t.desc) && C.callCaseId('device_printer') === 'device_printer' && C.callCaseId('') === '', 'call case list and id reader');
// the standalone case pass: facts and task titles only, no transcripts
const cp = C.callCasePrompt(inp, F);
ok(cp.includes('F2 · 1:01 PM · Call 1 · the store [said]: Store says ticket C12 printed twice') && cp.includes('"caseType": "compensation |') && !cp.includes('leave a message') && !/SCORECARD/.test(cp), 'case prompt: facts, the reply shape, no transcripts, no scorecard');
ok(C.callCasePrompt(q, F).includes('Audited agent: Dana Test'), 'case prompt takes a queue doc too');
const cc = C.cleanCallCase({ caseType: 'contact_customer', caseWhy: 'x'.repeat(400) });
ok(cc.caseType === 'contact_customer' && cc.caseWhy.length <= 301 && C.cleanCallCase({ case: { type: 'menu_setup', why: 'Price change (F1).' } }).caseType === 'menu_setup', 'cleanCallCase: id kept, why capped, nested shape read');
ok(C.cleanCallCase(null) === null && C.cleanCallCase([]) === null && C.cleanCallCase({}).caseType === 'other', 'cleanCallCase: not an object -> null; empty -> other');

// the runner: facts and analysis reused from aiFacts, invalid JSON repaired, items required
(async () => {
  const passes = [];
  const reply = { criteria: { '1a': { why: 'ok F1', cites: ['F1'], score: 3 }, '2b': { why: 'F2', score: 3 }, '3c': { why: 'F3', score: 2 } }, wentWell: [], fixes: [], summary: 's' };
  const deps = { items, transcripts: [{ id: 'a', text: talk }], ask: async (prompt, pass) => { passes.push(pass);
    if (pass === 'facts') return { calls: [{ n: 1, bullets: ['Store asks to void C12'] }], timeline: [{ src: 'Call 1', when: '1:00 PM', who: 'the store', kind: 'said', what: 'Store asks to void C12' }], promises: [] };
    if (pass === 'analysis') return { summary: 'Void asked', rootCause: 'Printed twice', faultAgent: 'none', faultCorrect: 'unclear', cites: { rootCause: ['F1'] } };
    throw { code: 'invalid_json', text: 'Here: ' + JSON.stringify(reply).slice(0, -1) } }, repair: B.repairJson };
  const solo = { agent: 'Dana Test', type: 'call', kind: 'CL', restaurantId: 'R12345', callDate: '2026-01-05', chain: { legs: [q.chain.legs[0]] } };
  const R = await C.gradeCall(solo, deps);
  ok(passes.join(',') === 'facts,analysis,grade', 'fresh call: all three passes');
  ok(R.G.scores['1a'] === 3 && R.G.scores['3c'] === 2 && R.F.timeline[0].id === 'F1' && R.A.rootCause === 'Printed twice', 'a cut-off grade reply is repaired');
  passes.length = 0;
  const saved = Object.assign({}, solo, { aiFacts: { summary: 'Saved', rootCause: 'Saved cause', faultAgent: 'none', faultCorrect: 'unclear', cites: {},
    facts: { calls: {}, timeline: F.timeline, promises: [Object.assign({}, F.promises[0], { status: 'kept', why: '', cites: [] })] } } });
  const R2 = await C.gradeCall(saved, deps);
  ok(passes.join(',') === 'grade', 'saved aiFacts: only the grade pass runs');
  ok(R2.F.timeline.length === 3 && R2.F.promises[0].id === 'P1' && !('status' in R2.F.promises[0]) && R2.A.rootCause === 'Saved cause', 'facts and analysis reused');
  await assert.rejects(C.gradeCall(solo, Object.assign({}, deps, { items: [] })), e => e.code === 'no_items'); n++;
  await assert.rejects(C.gradeCall(solo, Object.assign({}, deps, { transcripts: [] })), e => e.code === 'no_text'); n++;
  await assert.rejects(C.gradeCall(solo, Object.assign({}, deps, { ask: async () => ({ junk: 1 }) })), e => e.code === 'ai_shape' && e.pass === 'facts'); n++;
  console.log(`call brain: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
