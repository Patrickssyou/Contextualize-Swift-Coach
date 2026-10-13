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

// prompts carry the route and no real restaurant names baked into code
const src = fs.readFileSync(path.join(__dirname, '..', 'src/chat.js'), 'utf8');
ok([chat.clientName, String(chat.restaurant || '').split(' ')[0], chat.sid].filter(Boolean).every(w => !src.includes(w)), 'no case data in the source');
const k = { chat, tasks, orders: linked, calls: fx.callRows.map(B.callRow), slack: [], notFound: [] };
const fp = B.chatFactsPrompt(k);
ok(/CHECK THE SA'S CLAIMS/.test(fp) && /O1 · ticket 65/.test(fp) && /\[internal note, inferred\]/.test(fp), 'facts prompt has claims check, orders and internal notes');
console.log(`chat brain: ${n} checks passed`);
