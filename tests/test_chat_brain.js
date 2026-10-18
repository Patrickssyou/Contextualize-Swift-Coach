// The chat brain's deterministic parts, on a real case (data/chats/cases/1831362.json, git-ignored).
const fs = require('fs'), path = require('path'), assert = require('assert');
const B = require('../src/chat.js'), C = require('../src/core.js');
const D = path.join(__dirname, '..', 'data/chats');
if (!fs.existsSync(path.join(D, 'cases/1831362.json'))) { console.log('chat brain: skipped (no data/chats fixture)'); process.exit(0); }
const fx = JSON.parse(fs.readFileSync(path.join(D, 'cases/1831362.json'), 'utf8'));
const policy = JSON.parse(fs.readFileSync(path.join(D, 'policy_pack.json'), 'utf8'));
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };

// base config: the chart's filters, roster assignees
const cfg = B.chatBaseConfig('2026-10-12', '2026-10-18', ['Christ Aragon', 'CJ Domingo']);
ok(/restaurants_cuisine_type equals=pizza/.test(cfg.filters.dimensions) && /project_name equals=conversation/.test(cfg.filters.dimensions), 'base filters');
ok(/assigned_user equals="Christ Aragon","CJ Domingo"/.test(cfg.filters.dimensions), 'assignee filter quoted');
ok(B.isBaseChat({ direction: 'inbound' }) && B.isBaseChat({ direction: 'outbound', createdByTitle: 'Account Executive' }) && !B.isBaseChat({ direction: 'outbound', createdByTitle: 'Front-End Developer' }), 'base = client-initiated or AE-created');

// messages with owners
const chat = B.chatRow(fx.chatRow, { roster: C.ROSTER_DEFAULT });
ok(chat.msgs.length === 13, '13 messages');
ok(chat.msgs[0].role === 'client' && /^[A-Z][a-z]+$/.test(chat.msgs[0].name) && chat.clientName === chat.msgs[0].name, 'client named from their sign-off');
ok(chat.msgs[1].role === 'sa' && chat.msgs[1].name === 'Christ Aragon' && !chat.msgs[1].internal, 'SA reply is client-visible');
ok(chat.msgs[10].role === 'ae' && chat.msgs[10].internal, 'AE note is internal');
ok(chat.msgs[11].role === 'sa' && chat.msgs[11].internal, 'SA @mention is internal');
ok(chat.msgs[12].role === 'lead' && chat.msgs[12].internal, 'lead note is internal');
ok(chat.initiator === 'client' && chat.frt === 2.32, 'initiator and first reply');

// context: child task, order match, calls
const tasks = B.pickRelated(chat, fx.relRows);
ok(tasks.length === 1 && tasks[0].sid === '1831693', 'child compensation task linked, other chat skipped');
const orders = fx.orderRows.map(B.orderRow);
const refs = B.mergeRefs(B.textRefs(chat.msgs.map(m => m.text).concat(tasks.flatMap(t => [t.title, t.desc]))), {});
ok(refs.amounts.includes(59.1) && refs.amounts.includes(17.73), 'amounts found in chat and task');
const ranked = B.rankOrders(orders, refs, chat.at), linked = B.linkedOrders(ranked);
ok(linked.length === 1 && linked[0].ticket === '65', 'ticket 65 linked');
ok(linked[0].items === 54.72 && linked[0].tax === 4.38 && linked[0].total === 59.1, 'money breakdown');
ok(B.linkedOrders([{ score: 5, order: {} }, { score: 4, order: {} }]).length === 0, 'close calls are left for the reviewer');
linked[0].label = 'O1';

// money: computed in code
const A = { bucket: { id: 'made_twice_one_paid' }, affectedOrder: 'O1', selfDelivery: false };
const comp = B.compFor(A, linked, policy);
ok(comp.amount === 16.42 && comp.formula === '30% × $54.72 items = $16.42' && !comp.needsApproval, '30% of items = $16.42');
const offer = B.offerCheck({ amount: 17.73 }, comp, linked);
ok(offer.match === 'wrong_base' && /full bill \$59\.10/.test(offer.note), 'SA offer flagged as the wrong base');
ok(B.offerCheck({ amount: 16.42 }, comp, linked).match === 'right', 'right amount recognised');
ok(B.compFor({ bucket: { id: 'unpaid' }, affectedOrder: 'O1', selfDelivery: true, deliveryFee: 3 }, linked, policy).amount === 57.72, '100% + delivery fee');
ok(B.compFor({ bucket: { id: 'unpaid' }, affectedOrder: 'O1' }, linked, policy).needsApproval, 'above $25 needs approval');
ok(B.compFor({ bucket: { id: 'none' } }, linked, policy).amount === 0, 'no compensation bucket');

// score and verdict are deterministic
const pat = { fr: 1, ev: 3, rs: 3, fa: 3, path: 3, amt: 1, expl: 1, esc: 2, tone: 2 };
const pct = B.chatScore(pat);
ok(pct > 65 && pct < 80 && B.chatVerdict(pct).id === 'okay', `Patrick-style marks give Okay (${pct}%)`);
ok(B.chatScore({ fr: 'na', ev: 3, rs: 3, fa: 3, path: 3, amt: 3, expl: 'na', esc: 'na', tone: 3 }) === 100, 'N/A drops out of the denominator');
ok(B.chatVerdict(92).id === 'great' && B.chatVerdict(49.9).id === 'miss', 'verdict bands');

// cleaners survive messy replies
ok(B.cleanChatFacts({ timeline: [{ what: 'x', kind: 'INTERNAL' }], claims: [{ claim: 'y', check: 'Not supported' }] }, []).claims[0].check === 'cant_check', 'unknown check -> cant_check');
const g = B.cleanChatGrade({ scores: { esc: 9, fr: 'na', amt: '2' }, route: { facts: { mark: 'RIGHT' } } });
ok(g.scores.esc === 4 && g.scores.fr === 'na' && g.scores.amt === 2 && g.scores.ev === 0 && g.route.facts.mark === 'right', 'grade cleaner clamps and keeps N/A');
ok(B.cleanChatRefs({ tickets: ['C46'], amounts: ['17.73', 0], orderType: 'Pickup' }).orderType === 'pickup', 'refs cleaner');

// case type: compensation logic only on compensation cases (older replies with no caseType keep their bucket)
const Fx = { timeline: [{ id: 'F1' }, { id: 'F2' }], claims: [], promises: [] };
const nonComp = B.cleanChatAnalysis({ caseType: 'Menu_Setup', bucket: { id: 'none' }, affectedOrder: 'O1', saOffer: { amount: 7 }, fault: { who: 'None' } }, Fx, policy);
ok(nonComp.caseType === 'menu_setup' && nonComp.bucket.id === '' && nonComp.affectedOrder === '' && nonComp.saOffer.amount === null && nonComp.fault.who === 'none', 'non-comp case: no bucket, order or offer; fault none');
ok(B.compFor(nonComp, linked, policy).amount === null, 'non-comp case: no money computed');
const isComp = B.cleanChatAnalysis({ caseType: 'compensation', bucket: { id: 'made_twice_one_paid' }, affectedOrder: 'o1', saOffer: { amount: '$17.73' }, escalation: { needed: true, to: 'Lead' } }, Fx, policy);
ok(isComp.bucket.id === 'made_twice_one_paid' && isComp.affectedOrder === 'O1' && isComp.saOffer.amount === 17.73, 'comp case keeps bucket, order and offer');
ok(isComp.ideal.escalation.needed === true && isComp.ideal.escalation.to === 'Lead', 'flat escalation key lands in ideal.escalation');
ok(B.cleanChatAnalysis({ bucket: { id: 'unpaid' } }, Fx, policy).bucket.id === 'unpaid' && B.cleanChatAnalysis({ caseType: 'weird' }, Fx, policy).caseType === 'other', 'no caseType keeps the old behaviour; unknown type -> other');
ok(B.CASE_TYPES.some(c => c.id === 'compensation') && B.CASE_TYPES.every(c => c.id && c.label && c.desc) && B.CASE_TYPES.length >= 8, 'case types listed with id, label, desc');
// the renamed type: order_issue is read as order_investigation everywhere
ok(B.CASE_ALIAS.order_issue === 'order_investigation' && B.caseTypeId('order_issue') === 'order_investigation' && B.caseTypeId('Order-Investigation') === 'order_investigation', 'old order_issue reads as order_investigation');
ok(B.caseTypeId('') === '' && B.caseTypeId(null) === '' && B.caseTypeId('weird') === 'other' && B.caseTypeLabel('order_issue') === 'Order-taking investigation' && B.caseTypeLabel('contact_customer') === 'Call the customer', 'caseTypeId and labels');
ok(B.cleanChatAnalysis({ caseType: 'order_issue' }, Fx, policy).caseType === 'order_investigation', 'an old order_issue reply cleans to order_investigation');
const ap = B.chatAnalysisPrompt({ chat: { sa: 'Ivo Lark', msgs: [] }, orders: [], calls: [] }, Fx, policy, [], []);
ok(/order_investigation \(Order-taking investigation\)/.test(ap) && !/order_issue/.test(ap) && /contact_customer \(Call the customer\)/.test(ap), 'analysis prompt lists the new ids with labels');
// the call brain mirrors the list: same ids and labels, in order
ok(JSON.stringify(B.CASE_TYPES.map(t => [t.id, t.label])) === JSON.stringify(C.CALL_CASE_TYPES.map(t => [t.id, t.label])) && JSON.stringify(B.CASE_ALIAS) === JSON.stringify(C.CALL_CASE_ALIAS), 'chat and call case types: identical ids, labels and aliases');
// N/A rows: fault and amount can be N/A, with the condition printed in the grade prompt
ok(['fa', 'amt', 'fr', 'expl', 'esc'].every(id => B.CHAT_RUBRIC.find(r => r.id === id).na && B.CHAT_RUBRIC.find(r => r.id === id).naWhen), 'na rows carry naWhen');
const gp = B.chatGradePrompt({ chat }, { timeline: [], claims: [], promises: [] }, Object.assign({}, nonComp), B.compFor(nonComp, [], policy), { amount: null }, []);
ok(/N\/A when nothing went wrong/.test(gp) && /not a compensation case \(menu_setup\)/.test(gp) && /fa is "na"/.test(gp) && !/COMPENSATION MATH/.test(gp), 'grade prompt: N/A conditions, no comp math on a non-comp case');
ok(/Score each flaw once/.test(gp) && /3 right · 2 right with a small gap/.test(gp), 'grade prompt: score once, mark anchors');
// grade replies: reason-first criteria, N/A spellings
const g2 = B.cleanChatGrade({ criteria: { fr: { why: 'ok', score: 2 }, amt: { why: 'none given', score: 'N/A' }, esc: { why: 'not needed', score: 'n/a' }, ev: { why: 'x', score: 3 } } });
ok(g2.scores.fr === 2 && g2.scores.amt === 'na' && g2.scores.esc === 'na' && g2.scores.ev === 3 && g2.reasons.amt === 'none given', 'criteria {why, score} map to scores and reasons; N/A spellings');
ok(B.cleanChatGrade({ scores: { esc: 'N/A' } }).scores.esc === 'na', 'old shape still read, N/A is not 0');
const g3 = B.cleanChatGrade({ criteria: { fr: { why: 'a', score: 1 }, route: { facts: { mark: 'wrong', why: 'w' } }, wentWell: ['x'], nextTime: [{ what: 'q', do: 'd' }], verdictWhy: 'v' } });
ok(g3.scores.fr === 1 && g3.route.facts.mark === 'wrong' && g3.wentWell.length === 1 && g3.nextTime.length === 1 && g3.verdictWhy === 'v', 'unclosed criteria: route and coaching lifted back up');

// prompts carry the route and no real restaurant names baked into code
const src = fs.readFileSync(path.join(__dirname, '..', 'src/chat.js'), 'utf8');
ok([chat.clientName, String(chat.restaurant || '').split(' ')[0], chat.sid, tasks[0].sid].filter(Boolean).every(w => !src.includes(w)), 'no case data in the source');
const k = { chat, tasks, orders: linked, calls: fx.callRows.map(B.callRow), slack: [], notFound: [] };
const fp = B.chatFactsPrompt(k);
ok(/CHECK THE SA'S CLAIMS/.test(fp) && /O1 · ticket 65/.test(fp) && /\[internal note, inferred\]/.test(fp), 'facts prompt has claims check, orders and internal notes');
ok(new RegExp(`TASK ${tasks[0].sid} \\(child of this chat\\)`).test(fp) && /may be wrong/.test(fp) && /does not match this chat/.test(fp), 'facts prompt: child task labelled, auto links flagged as possibly wrong');
const fp2 = B.chatFactsPrompt(Object.assign({}, k, { tasks: [Object.assign({}, tasks[0], { parent: 'other' })] }));
ok(/may be another case/.test(fp2), "the SA's other tasks are labelled as possibly another case");
// ---- end to end: the same runner the page uses, on the saved case with the saved Claude replies (run r2) ----
(async () => {
  ok(B.chatWeek('2026-10-12T19:48:00') === '2026-10-12' && B.chatWeek('2026-10-18T23:59:00') === '2026-10-12' && B.chatWeek('2026-10-11T09:00:00') === '2026-10-05', 'Monday-start weeks');
  const titles = [];
  const query = async (cfg, title) => { titles.push(title);
    if (/ · tasks$/.test(title)) return fx.relRows;
    if (/ · states$/.test(title)) return fx.stateRows || [];
    if (/ · orders$/.test(title)) return fx.orderRows;
    if (/ · order recordings$/.test(title)) return fx.callRows.filter(r => cfg.filters.dimensions.includes(r.calls_conversation_id));
    if (/ · same caller$/.test(title)) return fx.callRows.filter(r => cfg.filters.dimensions.includes(r.calls_call_phone_detail));
    throw new Error('unexpected query ' + title); };
  const out = p => JSON.parse(fs.readFileSync(path.join(D, `cases/1831362.r2.${p}.out.json`), 'utf8'));
  const asked = [];
  const prompts = {};
  const ask = async (prompt, pass, o) => { asked.push(pass + (o && o.fresh ? '*' : '')); prompts[pass] = prompt; return pass === 'refs' ? { amounts: [17.73], orderType: 'pickup' } : out(pass); };
  const steps = [];
  const deps = { query, ask, policy, cal: JSON.parse(fs.readFileSync(path.join(D, 'calibration.json'), 'utf8')), step: (id, st, note) => steps.push(`${id}:${st}${note ? ':' + note : ''}`) };
  const k2 = await B.chatContext(chat, deps);
  ok(k2.tasks.length === 1 && k2.orders.length === 1 && k2.orders[0].ticket === '65' && k2.orders[0].label === 'O1', 'context links the child task and ticket 65');
  ok(k2.calls.length === 2 && k2.calls[0].at < k2.calls[1].at && k2.calls.every(l => l.orders === 'O1 (ticket 65)'), 'both recordings of the order, in time order');
  ok(titles.some(t => / · same caller$/.test(t)), 'looks for the same caller');
  ok(!k2.notFound.length, 'nothing missing');
  const R = await B.gradeChat(k2, deps);
  ok(asked.join(',') === 'refs,facts,analysis,grade', 'passes in route order; one grade read (the QA lead\'s choice, Oct 15)');
  ok(!R.G.runs, 'one read: no merged runs');
  // the QA lead's standing decisions reach the analysis and grade passes
  ok(/clean handoff/.test(prompts.analysis) && /clean handoff/.test(prompts.grade), 'shared chat: grade the SA\'s own messages, credit a handoff');
  ok(/recorded nowhere is a failed Resolution accuracy/.test(prompts.grade) && /internal note or a WIRA ticket/.test(prompts.grade), 'comp amount checked wherever recorded; nowhere = 0');
  ok(/promise an earlier Tarro agent made/.test(prompts.grade), 'an earlier agent\'s promise: judge the decision and the handling');
  ok(/\$59\.10/.test(prompts.facts) && !/mu usd/.test(prompts.facts), 'WIRA minor-unit amounts read as dollars');
  // two reads that differ: half marks, N/A only when both reads say so
  const m = B.mergeGrades({ scores: { fr: 1, ev: 3, rs: 3, fa: 3, path: 3, amt: 1, expl: 1, esc: 2, tone: 2 } }, { scores: { fr: 2, ev: 3, rs: 2, fa: 'na', path: 3, amt: 1, expl: 'na', esc: 3, tone: 2 } });
  ok(m.scores.fr === 1.5 && m.scores.fa === 3 && m.scores.esc === 2.5 && m.scores.expl === 1 && m.runPcts.length === 2 && m.spread > 0, 'reads averaged per mark');
  ok(B.mergeGrades({ scores: { fr: 'na' } }, { scores: { fr: 'na' } }).scores.fr === 'na', 'N/A when both reads agree');
  // a second read that fails keeps the first; a stop error still stops
  let n2 = 0; const quiet = Object.assign({}, deps, { step: () => {} }); const k4 = await B.chatContext(chat, quiet);
  const R2 = await B.gradeChat(k4, Object.assign({}, quiet, { gradeRuns: 2, ask: async (p, pass, o) => { if (o && o.fresh) { n2++; throw { code: 'upstream_error' }; } return pass === 'refs' ? {} : out(pass); }, isStop: e => e.code === 'rate_limited' }));
  ok(n2 === 1 && R2.pct === 74.2 && !R2.G.runs, 'a failed second read keeps the first');
  let stopped = null; try { await B.gradeChat(k4, Object.assign({}, quiet, { gradeRuns: 2, ask: async (p, pass, o) => { if (o && o.fresh) throw { code: 'rate_limited' }; return out(pass); }, isStop: e => e.code === 'rate_limited' })); } catch (e) { stopped = e.code; }
  ok(stopped === 'rate_limited', 'a stop error on the second read stops the batch');
  ok(B.CHAT_RUBRIC.find(r => r.id === 'amt').naWhen === 'no compensation, credit, refund or fee was given, promised or due', 'amount is N/A only when nothing was due');
  ok(R.comp.amount === 16.42 && R.offer.match === 'wrong_base', 'money from code');
  ok(R.verdict.id === 'okay' && R.pct === 74.2, `end-to-end verdict Okay 74.2 (got ${R.verdict && R.verdict.id} ${R.pct})`);
  ok(steps.includes('grade:done:Okay 74.2%') && steps.filter(x => /:run$/.test(x)).length === 7, 'steps reported (no Slack hook)');
  const doc = B.chatAuditDoc(k2, R, { by: 'u_test' }), tx = B.chatTxDoc(k2), qd = B.chatQueueDoc(chat, true);
  const js = JSON.stringify(doc);
  ok(js.length < 60000 && !/\d{10}/.test(JSON.stringify(doc.calls)) && doc.calls[0].phone4.length === 4, `audit doc is small (${js.length} bytes) with no full phone numbers`);
  ok(doc.verdict === 'okay' && doc.week === '2026-10-12' && doc.orders[0].items === 54.72 && doc.grade.nextTime.length > 0, 'audit doc carries the result');
  ok(tx.calls.length === 2 && tx.calls.every(c => c.text.length > 100), 'transcripts kept apart');
  ok(qd.picked && qd.gradable && qd.msgs.length === 13 && qd.week === '2026-10-12', 'queue doc');
  // reviewer overrides the order: none
  const k3 = await B.chatContext(chat, Object.assign({}, deps, { orderIds: [] }));
  ok(!k3.orders.length && !k3.calls.length && k3.notFound.length === 1, 'reviewer can unlink the order');
  // picks: N per SA, stable, gradable only
  const mk = (sid, sa, sa_msg) => ({ sid, sa, msgs: sa_msg ? [{ role: 'sa' }] : [{ role: 'client' }] });
  const pool = [...Array(9)].map((_, i) => mk('A' + i, 'Ann', i !== 3)).concat([...Array(3)].map((_, i) => mk('B' + i, 'Bo', true)));
  const p1 = B.chatPicks(pool, 5), p2 = B.chatPicks(pool.slice().reverse(), 5);
  ok(p1.filter(x => x[0] === 'A').length === 5 && p1.filter(x => x[0] === 'B').length === 3 && !p1.includes('A3') && p1.slice().sort().join() === p2.slice().sort().join(), 'picks: 5 per SA, stable, only chats the SA replied in');
  // the week pull splits a full reply
  let calls = 0;
  const rows = await B.pullChatWeek('2026-10-05', ['Christ Aragon'], async cfg => { calls++; const m = cfg.filters.dimensions.match(/inBetween=(\S+),(\S+)/);
    return m[1] === m[2] ? [fx.chatRow] : Array(C.PULL.cap).fill(fx.chatRow); }, { roster: C.ROSTER_DEFAULT });
  ok(calls === 13 && rows.length === 1, `full replies split down to days, duplicates dropped (${calls} queries)`);
  // a reply cut short is repaired from its text, without asking Claude again
  ok(JSON.stringify(B.repairJson('Sure: {"a":1,"b":[1,{"c":"x}"}]} done')) === '{"a":1,"b":[1,{"c":"x}"}]}' && B.repairJson('{"x":{"y":1},"z":"cut') .x.y === 1 && B.repairJson('nothing') === null, 'JSON repair');
  let calls2 = 0;
  const v = await B.askPass({ ask: async () => { calls2++; throw { code: 'invalid_json', text: '{"timeline":[{"what":"a"}],"claims":[{"claim":"b"' }; } }, 'p', 'facts');
  ok(calls2 === 1 && v.timeline.length === 1, 'askPass repairs invalid_json once, no second call');
  let threw = null; try { await B.askPass({ ask: async () => { throw { code: 'rate_limited' }; } }, 'p', 'facts'); } catch (e) { threw = e.code; }
  ok(threw === 'rate_limited', 'other errors pass through');
  ok(doc.dayOrders.length === Math.min(150, fx.orderRows.length) && doc.dayOrders[0].at >= doc.dayOrders[doc.dayOrders.length - 1].at && JSON.stringify(doc).length < 80000, `same-day orders kept for the reviewer (${doc.dayOrders.length})`);
  // ---- the compensation check: what was due, what the SA gave, how it went wrong (all from order data) ----
  const kc = { chat, orders: linked, allOrders: orders }, cbase = { caseType: 'compensation', bucket: { id: 'made_twice_one_paid' }, affectedOrder: 'O1', fault: { who: 'tarro' } };
  const cc = (so, ex) => B.compCheck(Object.assign({}, cbase, { saOffer: so }, ex || {}), kc, policy);
  let c1 = cc({ amount: 17.73 });
  ok(c1.status === 'wrong' && c1.score === 1 && c1.errors.map(e => e.code).join() === 'tax' && /30% × \$59\.10 \(items \$54\.72 \+ tax \$4\.38\)/.test(c1.computed) && c1.diff === 1.31, 'tax in the base found and shown');
  ok(cc({ amount: 16.42 }).status === 'right' && cc({ amount: 16.42 }).score === 3, 'exact amount is right');
  ok(cc({ amount: 16.5 }).status === 'minor' && cc({ amount: 16.5 }).score === 2 && cc({ amount: 16.5 }).errors[0].code === 'rounding', 'rounding is flagged (to the cent)');
  c1 = cc({ amount: 54.72 }); ok(c1.errors.map(e => e.code).join() === 'pct' && c1.flags[0].code === 'over_limit', '100% instead of 30%, over the limit without approval');
  ok(cc({ amount: 54.72 }, { approval: { approved: true } }).flags.length === 0, 'an approved amount over the limit is not flagged');
  ok(cc({ given: true, amount: null }).status === 'not_recorded' && cc({ given: true, amount: null }).score === 0, 'amount recorded nowhere = 0');
  ok(cc({}).status === 'missing' && cc({}).score === 0, 'due but not given = 0');
  ok(cc({}, { fault: { who: 'shared_tarro' } }).status === 'held' && cc({}, { fault: { who: 'shared_tarro' } }).score === 'na', 'shared fault, nothing offered: held (N/A)');
  ok(cc({ amount: 16.42 }, { fault: { who: "shared_tarro" } }).flags[0].code === "shared", 'shared fault, offered without approval');
  ok(cc({ amount: 5 }, { bucket: { id: 'none' } }).status === 'not_due' && cc({}, { bucket: { id: 'none' } }).score === 'na', 'not due: given = 0, nothing given = N/A');
  ok(cc({ amount: 5 }).errors[0].code === 'math', 'an amount no formula explains is a math error');
  ok(!B.compCheck({ caseType: 'menu_setup' }, kc, policy).applies, 'non-compensation chats are not checked');
  // ---- the QA ticket: findings by impact, quotes checked against the source ----
  ok(B.quoteCheck(k2, 'M1', 'We made her order twice').ok === true && B.quoteCheck(k2, 'M1', 'something never said').ok === false && B.quoteCheck(k2, 'M1', 'something never said').text.length > 20, 'chat quotes verified; a wrong quote is swapped for the message');
  ok(B.quoteCheck(k2, 'Call 2', 'why am I being charged extra').ok === true, 'call quotes verified against the transcript');
  const Gf = B.finishGrade(B.cleanChatGrade({ criteria: { fr: { score: 1, why: 'F31' }, ev: { score: 3 }, rs: { score: 3 }, fa: { score: 1 }, path: { score: 3 }, amt: { score: 3 }, expl: { score: 2 }, esc: { score: 0 }, tone: { score: 2 } },
    findings: [{ criterion: 'fr', type: 'Defended before checking', what: 'x', evidence: [{ src: 'M1', quote: 'We made her order twice' }, { src: 'M3', quote: 'made up words' }], should: 'y', model: 'z' }] }), null,
    Object.assign({}, cbase, { saOffer: { amount: 17.73 } }), B.compCheck(Object.assign({}, cbase, { saOffer: { amount: 17.73 } }), kc, policy), k2, R.F);
  const P = Object.fromEntries(Gf.findings.map(f => [f.id, f.priority]));
  ok(Gf.scores.amt === 1 && Gf.amtBy === 'system' && P.amt === 'P1' && P.fa === 'P1' && P.esc === 'P1' && P.fr === 'P2' && P.expl === 'P3' && P.tone === 'P3' && Gf.findings[0].priority === 'P1', 'the check sets amt; priority by impact');
  const ff = Gf.findings.find(f => f.id === 'fr');
  ok(ff.evidence[0].ok === true && ff.evidence[1].swapped === true && ff.type === 'Defended before checking', 'finding evidence verified or swapped');
  ok(Gf.findings.find(f => f.id === 'amt').type === 'Taxes included' && Gf.nextTime.length > 0, 'the amount finding carries the check');
  const gpt = B.chatGradePrompt(k2, R.F, R.A, R.comp, R.offer, [], R.check, [{ crit: 'fr', label: 'First response', type: 'Defended before checking', what: 'said the call was fine', note: 'checking took a minute' }]);
  ok(/COMPENSATION CHECK \(system, final\): wrong/.test(gpt) && /score it 1/.test(gpt) && /not a mistake: checking took a minute/.test(gpt) && /"findings"/.test(gpt), 'grade prompt carries the check, the lead\'s corrections and asks for findings');
  ok(R.check.applies && doc.check && doc.priority === 'P1', 'the audit doc keeps the check and the ticket priority');
  /* order status: voided and refunded orders are named; a plain submitted order says nothing */
  const OA = 'greendot_orders_analytics_aggregate_';
  const vo = B.orderRow({ [OA + 'order_id']: 'W1', [OA + 'order_status']: 'voided', [OA + 'list_void_reason_type']: 'no_pick_up', [OA + 'total_sales_amount']: 20 });
  ok(B.orderState(vo) === 'VOIDED (no_pick_up)', 'a voided order shows its status and reason');
  const rf = B.orderRow({ [OA + 'order_id']: 'W2', [OA + 'order_status']: 'submitted', [OA + 'payment_state']: 'payment_state_fully_refunded', [OA + 'payment_refunded_amount']: 41.35, [OA + 'refund_type']: 'full' });
  ok(B.orderState(rf) === 'refunded $41.35 full' && rf.pay === 'fully_refunded', 'a refunded order shows the amount');
  ok(B.orderState(B.orderRow({ [OA + 'order_status']: 'submitted' })) === '', 'a submitted order shows no status');
  /* reinforce: right mark, corrected reasoning */
  const rl = B.lessonLines([{ kind: 'reinforce', crit: 'fr', label: 'First response', from: '2/2', to: '2/2', what: 'replied fast', reason: 'the reply named the order and the fix' }]);
  ok(/mark is right, but the reasoning was off/.test(rl) && /The right reason: the reply named the order/.test(rl), 'a reinforce lesson keeps the mark and teaches the reason');
  console.log(`chat brain: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
