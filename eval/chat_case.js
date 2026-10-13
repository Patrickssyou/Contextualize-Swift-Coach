// Run the chat brain on one saved case, pass by pass, the same way the page does.
//   node eval/chat_case.js <sid> refs      -> writes the refs prompt
//   node eval/chat_case.js <sid> facts     -> links orders/calls, writes the facts prompt
//   node eval/chat_case.js <sid> analysis  -> needs facts.out.json; writes the analysis prompt
//   node eval/chat_case.js <sid> grade     -> needs analysis.out.json; writes the grade prompt
//   node eval/chat_case.js <sid> report    -> needs grade.out.json; prints the audit
// Options: --calib=none|all (default all, minus the case itself), --tag=<name> (output prefix, default "run")
// Case fixtures and outputs live in data/chats/cases/ (git-ignored real data).
const fs = require('fs'), path = require('path');
const B = require('../src/chat.js');
const ROOT = path.join(__dirname, '..'), DIR = path.join(ROOT, 'data/chats/cases');
const [sid, step] = process.argv.slice(2);
const opt = Object.fromEntries(process.argv.slice(4).map(a => a.replace(/^--/, '').split('=')));
const tag = opt.tag || 'run', F = s => path.join(DIR, `${sid}.${tag}.${s}`);
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const policy = rj(path.join(ROOT, 'data/chats/policy_pack.json'));
const calAll = fs.existsSync(path.join(ROOT, 'data/chats/calibration.json')) ? rj(path.join(ROOT, 'data/chats/calibration.json')) : [];
const cal = opt.calib === 'none' ? [] : calAll.filter(c => c.sid !== sid);

function assemble() {
  const fx = rj(path.join(DIR, sid + '.json'));
  const roster = (B.ROSTER_DEFAULT || require('../src/core.js').ROSTER_DEFAULT);
  const chat = B.chatRow(fx.chatRow, { roster });
  const tasks = B.pickRelated(chat, fx.relRows || []);
  const orders = (fx.orderRows || []).map(B.orderRow);
  const texts = chat.msgs.map(m => m.text).concat(tasks.flatMap(t => [t.title, t.desc]));
  let refs = B.textRefs(texts);
  if (fs.existsSync(F('refs.out.json'))) refs = B.mergeRefs(refs, B.cleanChatRefs(rj(F('refs.out.json'))));
  else refs = B.mergeRefs(refs, {});
  const ranked = B.rankOrders(orders, refs, chat.at), linked = B.linkedOrders(ranked);
  linked.forEach((o, i) => o.label = 'O' + (i + 1));
  const ids = new Set(linked.flatMap(o => o.callIds));
  const calls = (fx.callRows || []).map(B.callRow).filter(c => ids.has(c.id) || linked.length).sort((a, b) => a.at.localeCompare(b.at));
  calls.forEach(c => { const o = linked.find(x => x.callIds.includes(c.id)); if (o) c.orders = `${o.label} (ticket ${o.ticket})`; });
  return { chat, tasks, orders: linked, ranked, refs, calls, slack: fx.slack || [], notFound: fx.notFound || [], review: fx.review };
}

const k = assemble();
if (step === 'refs') { fs.writeFileSync(F('refs.txt'), B.chatRefsPrompt(k)); console.log('wrote', F('refs.txt')); }
if (step === 'facts') {
  console.log('refs', JSON.stringify(k.refs));
  console.log('ranked', k.ranked.map(r => `${r.order.ticket}:${r.score} ${r.why.join('; ')}`).join(' | '));
  console.log('linked', k.orders.map(o => `${o.label} ticket ${o.ticket} items ${o.items} tax ${o.tax} total ${o.total} calls ${o.callIds.length}`));
  console.log('tasks', k.tasks.map(t => t.sid), 'calls', k.calls.map(c => c.id.slice(0, 8)));
  console.log('messages', k.chat.msgs.map(m => `M${m.n}:${m.role}${m.internal ? '(internal)' : ''}:${m.name}`).join(' '));
  fs.writeFileSync(F('facts.txt'), B.chatFactsPrompt(k)); console.log('wrote', F('facts.txt'), fs.statSync(F('facts.txt')).size, 'bytes');
}
let Fx, A, comp, offer;
if (['analysis', 'grade', 'report'].includes(step)) {
  Fx = B.cleanChatFacts(rj(F('facts.out.json')), k.calls); if (!Fx) throw new Error('facts did not clean');
}
if (step === 'analysis') { fs.writeFileSync(F('analysis.txt'), B.chatAnalysisPrompt(k, Fx, policy, cal)); console.log('wrote', F('analysis.txt'), 'calibration cases', cal.length); }
if (['grade', 'report'].includes(step)) {
  A = B.cleanChatAnalysis(rj(F('analysis.out.json')), Fx, policy); if (!A) throw new Error('analysis did not clean');
  comp = B.compFor(A, k.orders, policy); offer = B.offerCheck(A.saOffer, comp, k.orders);
}
if (step === 'grade') { fs.writeFileSync(F('grade.txt'), B.chatGradePrompt(k, Fx, A, comp, offer, cal)); console.log('comp', comp, 'offer', offer); console.log('wrote', F('grade.txt')); }
if (step === 'report') {
  const G = B.cleanChatGrade(rj(F('grade.out.json'))), pct = B.chatScore(G.scores), v = B.chatVerdict(pct);
  const out = { sid, verdict: v, pct, reviewer: k.review, fault: A.fault, bucket: A.bucket, comp, offer, saPath: A.saPath, ae: A.aeInvolvement, firstResponse: A.firstResponse, ideal: A.ideal,
    claims: Fx.claims, scores: G.scores, reasons: G.reasons, route: G.route, wentWell: G.wentWell, nextTime: G.nextTime, verdictWhy: G.verdictWhy };
  fs.writeFileSync(F('audit.json'), JSON.stringify(out, null, 1));
  console.log(`VERDICT ${v && v.label} ${pct}%  (reviewer: ${k.review && k.review.verdict})`);
  console.log('fault', A.fault.who, '|', A.fault.why); console.log('bucket', A.bucket.id, '|', comp.formula, '| SA offered', offer.amount, offer.match, offer.note);
  console.log('path', A.saPath.match, A.saPath.why); console.log('AE', A.aeInvolvement.kind, A.aeInvolvement.saCouldPrevent, A.aeInvolvement.why);
  console.log('first response', A.firstResponse.concludedBeforeEvidence, A.firstResponse.why);
  console.log('claims', Fx.claims.map(c => `${c.id} ${c.check}: ${c.claim}`).join('\n  '));
  B.CHAT_RUBRIC.forEach(r => console.log(`  ${r.id.padEnd(5)} ${String(G.scores[r.id]).padEnd(3)}/${r.max}  ${G.reasons[r.id]}`));
  Object.entries(G.route).forEach(([k2, v2]) => console.log(`  route ${k2}: ${v2.mark} — ${v2.why}`));
  console.log('went well', G.wentWell); G.nextTime.forEach(n => console.log('NEXT:', n.what, '\n   why:', n.why, '\n   do:', n.do, '\n   model:', n.model));
}
