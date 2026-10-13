// Who wrote each WIRA chat message, and which tasks, orders and calls belong to the chat.
// Part 1 runs on made-up chats (no real data). Part 2 reads real fixtures from data/chats (git-ignored) and is skipped when they are absent.
const fs = require('fs'), path = require('path'), assert = require('assert');
const B = require('../src/chat.js'), C = require('../src/core.js');
const D = path.join(__dirname, '..', 'data/chats');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const OA = 'greendot_orders_analytics_aggregate_';
const roster = [{ name: 'Marianne Kowalski' }, { name: 'Tomas Reyes' }, { name: 'Lee Park' }];

/* ---------- 1. Pairing: an empty first comment must not shift the authors ---------- */
const A1 = 'marianne.kowalski@x.test', A2 = 'client-+15550001111';
eq(B.pairComments(' ## Need help ## Sure', `${A1} ## ${A2} ## ${A1}`).map(p => [p.who, p.raw]), [[A1, ''], [A2, 'Need help'], [A1, 'Sure']], 'raw split keeps the empty first comment');
eq(B.pairComments('## Need help ## Sure', `${A1} ## ${A2} ## ${A1}`).map(p => p.raw), ['', 'Need help', 'Sure'], 'a string a pipeline trimmed pairs the same way');
eq(B.pairComments('Hello ## ', `${A2} ## ${A1}`).map(p => p.raw), ['Hello', ''], 'an empty last comment');
{ const m = B.chatMessages(' ## Need help ## Sure, checking', `${A1} ## ${A2} ## ${A1}`, { sa: 'Marianne Kowalski', roster });
  eq(m.map(x => x.role), ['client', 'sa'], 'blank dropped, then client and SA');
  eq(m.map(x => x.n), [1, 2], 'numbers are consecutive'); ok(m[0].blankBefore === 1, 'the dropped blank is counted on the next message'); }

/* ---------- 2. Roster matching, not the alias ---------- */
ok(B.rosterOf('marianne.kowalsky', roster).name === 'Marianne Kowalski', 'last name with one typo');
ok(B.rosterOf('marianne.kowalski', roster).name === 'Marianne Kowalski', 'first.last');
ok(B.rosterOf('Tomas Reyes', roster).name === 'Tomas Reyes', 'full name');
ok(B.rosterOf('tomas.reyez', roster).name === 'Tomas Reyes', 'short last name needs the same length ±1 and first name');
ok(!B.rosterOf('marcus.kowalski', roster), 'same last name, other first name is not the SA');
ok(!B.rosterOf('lee.parker', roster), 'a different person is not matched on a short last name');
ok(!B.rosterOf('howard.ho', roster), 'staff outside the roster');
{ const mk = (who, text, ctx) => B.chatMessages(`Hi there ## ${text}`, `${A2} ## ${who}`, Object.assign({ sa: 'Marianne Kowalski', roster }, ctx))[1];
  const alias = mk('marianne.kowalsky@x.test', 'On it');
  ok(alias.role === 'sa' && alias.name === 'Marianne Kowalski', 'the audited SA under a misspelt alias');
  const other = mk('tomas.reyes@x.test', 'I can take this');
  ok(other.role === 'sa_other' && other.name === 'Tomas Reyes', 'another roster SA');
  const stranger = mk('someone.else@x.test', 'FYI');
  ok(stranger.role === 'staff', 'a stranger is staff');
  const mapped = mk('someone.else@x.test', 'Here', { staff: { 'someone.else': { name: 'Someone Else', role: 'sa' } } });
  ok(mapped.role === 'sa_other', 'staff override with role sa is another SA');
  const mappedMe = mk('mk.alias@x.test', 'Here', { staff: { 'mk.alias': { name: 'Marianne Kowalski', role: 'sa' } } });
  ok(mappedMe.role === 'sa', 'staff override that names the audited SA is the SA');
  const ae = mk('someone.else@x.test', 'Here', { staff: { 'someone.else': { name: 'Someone Else', role: 'ae' } } });
  ok(ae.role === 'ae', 'staff override role'); }
/* a roster SA is the audited SA by assignment, whatever agent_alias says */
{ const m = B.chatMessages('Hi ## Hello', `${A2} ## tomas.reyes@x.test`, { sa: 'Tomas Reyes', saEmail: 'marianne.kowalski@x.test', roster });
  ok(m[1].role === 'sa', 'assigned SA wins over a wrong agent_alias'); }

/* ---------- 3. POS authors are the client, bots are System ---------- */
{ const m = B.chatMessages('Order is wrong ## Checking ## Done', 'cma-pin-user-1234 ## marianne.kowalski@x.test ## sa-wira-workflow', { sa: 'Marianne Kowalski', roster });
  ok(m[0].role === 'client' && m[0].via === 'pos' && !m[0].internal, 'POS author is the client');
  ok(m[2].role === 'bot' && m[2].name === 'Automation' && !m[2].internal && B.ROLE_L.bot === 'System', 'bot is System and never internal');
  ok(B.chatGradable({ msgs: m }), 'the SA message makes the chat gradable');
  const w = B.chatMessages('Hello ## Hi', 'client-+15550001111 ## sa-wonka', { sa: 'Marianne Kowalski', roster });
  ok(w[1].role === 'bot' && !w[1].internal, 'a second bot name'); }
ok(B.POS_RE.test('cma-pin-user-abc') && B.POS_RE.test('pos-user-9') && !B.POS_RE.test('marianne.kowalski@x.test'), 'POS pattern');
ok(B.BOT_RE.test('sa-wira-workflow') && B.BOT_RE.test('sa-wonka') && !B.BOT_RE.test('sam.wong'), 'bot pattern');

/* ---------- 4. Greeting or the client's name beats the third-person pattern ---------- */
{ const m = B.chatMessages('Please fix it. This is Sam ## Hi Sam! The client said it was fine, so I fixed it ## @Tomas the client called', `${A2} ## marianne.kowalski@x.test ## marianne.kowalski@x.test`, { sa: 'Marianne Kowalski', roster });
  ok(!m[1].internal, 'greeting the client by name is client-visible');
  ok(m[2].internal && m[2].inferred, 'an @mention stays internal'); }
{ const m = B.chatMessages('Hi ## Hi Tomas, can you check the printer? ## Sure ## Hi Lee, thanks for waiting', `${A2} ## marianne.kowalski@x.test ## tomas.reyes@x.test ## marianne.kowalski@x.test`, { sa: 'Marianne Kowalski', roster });
  ok(m[1].internal, 'SA greeting a colleague by name is internal');
  ok(m[3].internal, 'SA greeting any roster first name is internal; a client is only safe when named by the client'); }
{ const m = B.chatMessages('Hi ## Cx wants a refund, can you advise? ## Sure thing', `${A2} ## marianne.kowalski@x.test ## marianne.kowalski@x.test`, { sa: 'Marianne Kowalski', roster });
  ok(m[1].internal && !m[2].internal, 'CX / CL wording marks an SA note to staff; a plain reply stays visible'); }

/* ---------- 5. Shape fields and associated order ids ---------- */
eq(B.parseFields('{"message_source":"pos","request_type":"x","nested":{"a":1}}'), { message_source: 'pos', request_type: 'x' }, 'shape fields keep scalars');
eq(B.parseFields('not json'), {}, 'bad JSON'); eq(B.parseFields(null), {}, 'null fields');
eq(B.parseWids(['Wid(0,1,2,0,3)', 'Wid(0, 1, 2, 0, 4)', 'Wid(0,1,2,0,3)']), ['Wid(0,1,2,0,3)', 'Wid(0,1,2,0,4)'], 'order wids, spaces removed, no duplicates');
eq(B.fieldClues({ ticket_number: 'T-0042', customer_phone: '(555) 123-4567', order_id: 'Wid(0,1,2,0,3)', note: 'x' }), { tickets: ['42'], phones: ['5551234567'], wids: ['Wid(0,1,2,0,3)'], dates: [] }, 'field clues by field name');
ok(B.chatRow({ wira_project_tasks_task_comments: 'a', wira_project_tasks_shape_fields: '{"message_source":"cma"}', wira_project_tasks_order2_root_wids_array: ['Wid(0,1,2,0,3)'] }).orderWids[0] === 'Wid(0,1,2,0,3)', 'chatRow keeps the associated order');

/* ---------- 6. Order ranking ---------- */
const ord = (id, ticket, at, items, total, extra) => Object.assign({ id, ticket: String(ticket), at, source: '', type: 'delivery', coupon: '', callIds: [], items, tax: 0, tip: 0, total, other: 0 }, extra || {});
const refs = (o) => Object.assign({ amounts: [], tickets: [], phones: [], names: [], items: [], orderType: '', wids: [], yesterday: false, dates: [], comp: false }, o);
const CHAT_AT = '2026-10-10T12:00:00';
{ // a ticket number repeats every day: the chat's own day wins
  const O = [ord('Y', 4, '2026-10-09T11:00:00', 15.99, 17.79), ord('T', 4, '2026-10-10T11:00:00', 7.75, 11.32)];
  eq(B.linkedOrders(B.rankOrders(O, refs({ tickets: ['4'] }), CHAT_AT)).map(o => o.id), ['T'], 'same-day ticket beats the day before');
  eq(B.linkedOrders(B.rankOrders(O, refs({ tickets: ['4'], yesterday: true }), CHAT_AT)).map(o => o.id), ['Y'], 'unless the chat says yesterday');
  eq(B.linkedOrders(B.rankOrders(O, refs({ tickets: ['4'], dates: ['10-09'] }), CHAT_AT)).map(o => o.id), ['Y'], 'or names the date');
  eq(B.linkedOrders(B.rankOrders([ord('Y', 4, '2026-10-09T11:00:00', 15.99, 17.79)], refs({ tickets: ['4'] }), CHAT_AT)).map(o => o.id), ['Y'], 'the day before links when nothing else has the ticket');
  eq(B.linkedOrders(B.rankOrders([ord('Z', 4, '2026-10-07T11:00:00', 15.99, 17.79)], refs({ tickets: ['4'] }), CHAT_AT)), [], 'a ticket three days back is not linked unless the chat names the date');
  eq(B.linkedOrders(B.rankOrders([ord('Z', 4, '2026-10-07T11:00:00', 15.99, 17.79)], refs({ tickets: ['4'], dates: ['10-07'] }), CHAT_AT)).map(o => o.id), ['Z'], 'a ticket on a named date links'); }
{ // WIRA's own tie is authoritative and may sit on an older day
  const O = [ord('A', 7, '2026-10-10T11:00:00', 10, 12), ord('W', 9, '2026-10-09T09:00:00', 20, 24)];
  eq(B.linkedOrders(B.rankOrders(O, refs({ wids: ['W'] }), CHAT_AT)).map(o => o.id), ['W'], 'an associated order links without any text clue, and the nearer order is not added');
  eq(B.linkedOrders(B.rankOrders(O, refs({ wids: ['W', 'A'] }), CHAT_AT)).map(o => o.id).sort(), ['A', 'W'], 'both associated orders link');
  eq(B.linkedOrders(B.rankOrders(O, refs({ tickets: ['7'], wids: ['W'] }), CHAT_AT)).map(o => o.id), ['W', 'A'], 'an order the chat names by ticket that WIRA did not tie is linked after it (a wrong bag, a swap)');
  const Y = [ord('Y', 4, '2026-10-09T11:00:00', 15.99, 17.79), ord('T', 4, '2026-10-10T11:00:00', 7.75, 11.32)];
  eq(B.linkedOrders(B.rankOrders(Y, refs({ tickets: ['4'], wids: ['T'] }), CHAT_AT)).map(o => o.id), ['T'], 'a ticket that only matches another day is not added next to WIRA\'s tie'); }
{ // amounts
  const O = [ord('F', 1, '2026-10-10T11:00:00', 0, 2), ord('X', 2, '2026-10-10T11:30:00', 16, 19.28)];
  eq(B.linkedOrders(B.rankOrders(O, refs({ amounts: [2], tickets: ['2'] }), CHAT_AT)).map(o => o.id), ['X'], 'a $2 fee is not an order total; the ticket decides');
  eq(B.rankOrders(O, refs({ amounts: [2] }), CHAT_AT).every(r => r.score < 3), true, 'amounts of $5 or less give no score');
  const P = [ord('P', 3, '2026-10-10T10:00:00', 54.72, 59.1), ord('Q', 4, '2026-10-10T10:30:00', 20, 24)];
  eq(B.linkedOrders(B.rankOrders(P, refs({ amounts: [17.73, 59.1], comp: true }), CHAT_AT)).map(o => o.id), ['P'], 'a unique total plus its 30% on a money chat links');
  eq(B.linkedOrders(B.rankOrders(P, refs({ amounts: [17.73, 59.1], comp: false }), CHAT_AT)).map(o => o.id), ['P'], 'a unique total just before the chat links on its own');
  ok(B.rankOrders([ord('R', 5, '2026-10-10T10:00:00', 20, 24)], refs({ amounts: [7.2], comp: true }), CHAT_AT).some(r => /30%/.test(r.why.join())), '30% of the subtotal counts on a money chat');
  ok(!B.rankOrders([ord('R', 5, '2026-10-10T10:00:00', 20, 24)], refs({ amounts: [7.2], comp: false }), CHAT_AT).some(r => /30%/.test(r.why.join())), '...and not otherwise');
  // a menu price equals the subtotal of a one-item order: never enough alone
  eq(B.linkedOrders(B.rankOrders([ord('M', 6, '2026-10-10T10:00:00', 12.5, 18.36)], refs({ amounts: [12.5, 7.5] }), CHAT_AT)), [], 'a price that equals one order\'s subtotal is not a link');
  // two orders with the same total that day: unsure, so nothing
  eq(B.linkedOrders(B.rankOrders([ord('S1', 8, '2026-10-10T09:00:00', 30, 33), ord('S2', 9, '2026-10-10T10:00:00', 30, 33)], refs({ amounts: [33] }), CHAT_AT)), [], 'the same total twice leaves it open');
  eq(B.linkedOrders(B.rankOrders([ord('N', 8, '2026-10-10T09:00:00', 30, 33.17)], refs({ amounts: [33] }), CHAT_AT)), [], 'a round dollar amount is weak'); }
ok(B.linkedOrders([{ score: 5, order: { id: 'a' } }, { score: 4, order: { id: 'b' } }]).length === 0, 'a close second leaves it open');

/* ---------- 7. Text references ---------- */
{ const r = B.textRefs(['Ticket #42 on 10/9, refunded $12.50 yesterday, cx 555-123-4567', 'the compensation is 30% of it']);
  eq(r.tickets, ['42'], 'ticket'); ok(r.yesterday && r.comp, 'yesterday and money flags'); eq(r.dates, ['10-09'], 'a date the chat names'); eq(r.phones, ['5551234567'], 'phone');
  ok(r.amounts.includes(12.5), 'amount');
  eq(B.textRefs(['it was sept 3rd']).dates, ['09-03'], 'month name date');
  ok(!B.textRefs(['we ordered 10 pizzas, 2 of them late']).comp, 'a plain order chat is not a money chat'); }
{ const m = B.mergeRefs(B.textRefs(['t #5']), { times: ['yesterday at 5pm'], customerNames: ['Sam'] });
  ok(m.yesterday && m.names[0] === 'Sam' && Array.isArray(m.wids), 'merged refs carry the flags'); }

/* ---------- 8. Related tasks ---------- */
{ const chat = { wid: 'W1', sid: '100', at: '2026-10-10T12:00:00', sa: 'Marianne Kowalski', msgs: [{ text: 'Customer Greta says ticket #44 was cold' }], orderWids: ['Wid(0,1,2,0,9)'] };
  const row = (o) => { const r = {}; Object.keys(o).forEach(k => { r['wira_project_tasks_' + k] = o[k]; }); return r; };
  const base = { project_name: 'live-support', created_at_est: '2026-10-10T12:30:00', created_by: 'Marianne Kowalski', assigned_user: 'Marianne Kowalski', task_title: 'Something', description: '', status: 'open' };
  const rows = [
    row(Object.assign({}, base, { wira_id: 'C1', short_wira_id: '101', parent_wid: 'W1', created_by: 'Tomas Reyes', assigned_user: 'Lee Park' })),
    row(Object.assign({}, base, { wira_id: 'N1', short_wira_id: '102', task_title: 'Another restaurant question' })),
    row(Object.assign({}, base, { wira_id: 'T1', short_wira_id: '103', task_title: 'C44 follow up' })),
    row(Object.assign({}, base, { wira_id: 'P1', short_wira_id: '104', description: 'Customer Greta wants a call back' })),
    row(Object.assign({}, base, { wira_id: 'S1', short_wira_id: '105', description: 'Mentions chat 100 directly' })),
    row(Object.assign({}, base, { wira_id: 'O1', short_wira_id: '106', task_title: 'C44 follow up', created_by: 'Tomas Reyes', assigned_user: 'Tomas Reyes' })),
    row(Object.assign({}, base, { wira_id: 'A1', short_wira_id: '107', order2_root_wids_array: ['Wid(0,1,2,0,9)'] })),
    row(Object.assign({}, base, { wira_id: 'L1', short_wira_id: '108', task_title: 'C44 follow up', created_at_est: '2026-10-12T12:30:00' })),
    row(Object.assign({}, base, { wira_id: 'X1', short_wira_id: '109', task_title: 'C44 follow up', project_name: 'customer-feedback' }))];
  const got = B.pickRelated(chat, rows).map(t => t.sid);
  eq(got, ['101', '103', '104', '105', '107'], 'child always; the SA\'s other tasks only when they point at this chat (ticket, customer, sid, associated order); not another SA, not too late, not skipped projects');
  ok(!got.includes('102'), 'an unrelated task by the same SA is dropped'); }

/* ---------- 9. Calls: silent and voicemail legs do not take talked slots ---------- */
{ const T = 'x'.repeat(200), VM = 'please leave a message after the tone. the person you are calling is not available. ' + 'x'.repeat(20);
  const calls = []; for (let i = 0; i < 9; i++) calls.push({ id: 'c' + i, min: i, text: T }); for (let i = 0; i < 3; i++) calls.push({ id: 's' + i, min: 20 + i, text: '' }); calls.push({ id: 'v0', min: 30, text: VM });
  const orderRow = { [OA + 'order_id']: 'O1', [OA + 'order_ticket_number']: 7, [OA + 'order_created_at_est']: '2026-10-10T11:00:00', [OA + 'order_type']: 'delivery', [OA + 'call_id']: 'c0', [OA + 'list_call_ids']: '',
    [OA + 'total_sub_total_sales']: 10, [OA + 'total_tax_amount']: 1, [OA + 'total_tip_amount']: 0, [OA + 'total_sales_amount']: 11 };
  const callRow = c => ({ calls_conversation_id: c.id, calls_call_started_at_est: `2026-10-10T11:${String(10 + c.min % 40).padStart(2, '0')}:00.000Z`, calls_call_duration_in_seconds: 60, internal_users_full_name: 'Agent One', internal_users_user_login_name: 'a1',
    calls_call_type: 'inbound_call', calls_call_phone_detail: '5550001111', asr_transcript_call_transcript: c.text });
  const query = async (cfg, title) => / · orders$/.test(title) ? [orderRow] : / · tasks$/.test(title) ? [] : / · order recordings$/.test(title) ? [callRow(calls[0])] : / · same caller$/.test(title) ? calls.map(callRow) : [];
  const chat = B.chatRow({ wira_project_tasks_wira_id: 'Wid(1)', wira_project_tasks_short_wira_id: '1', wira_project_tasks_created_at_est: '2026-10-10T12:00:00', wira_project_tasks_assigned_user: 'Marianne Kowalski',
    wira_project_tasks_task_comments: 'Where is order #7 ## Looking', wira_project_tasks_task_commentors: 'client-+15559998888 ## marianne.kowalski@x.test', restaurants_unique_code: 'R1' }, { roster });
  B.chatContext(chat, { query }).then(k => {
    const talk = k.calls.filter(l => l.talk === 'talk'), quiet = k.calls.filter(l => l.talk !== 'talk');
    ok(talk.length === B.CHAT.maxCalls, 'talked calls fill every slot even with many quiet legs: ' + talk.length);
    ok(quiet.length === 2, 'at most 2 quiet legs: ' + quiet.length);
    ok(k.calls.indexOf(quiet[0]) >= talk.length && k.calls.slice(0, talk.length).every(l => l.talk === 'talk'), 'quiet legs are listed after the talked ones');
    ok(k.calls.some(l => l.id === 'c0' && l.orders), 'the order\'s own call is kept and labelled');
    ok(k.orders[0].tie === 'ticket', 'the order says how it was linked');
    part2();
  }).catch(e => { console.error(e); process.exit(1); });
}

/* ---------- Part 2: real fixtures ---------- */
function part2() {
  if (!fs.existsSync(path.join(D, 'cases/1831362.json')) || !fs.existsSync(path.join(D, 'week_2026-10-05/base_full.json'))) { console.log(`chat linking: ${n} checks passed (real-data checks skipped, no data/chats)`); return; }
  const rj = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
  const rows = rj('week_2026-10-05/base_full.json'), RO = C.ROSTER_DEFAULT;
  /* the week: every base chat can be graded, authors line up, POS and bots are not staff */
  const week = rows.map(r => B.chatRow(r, { roster: RO })).filter(B.isBaseChat);
  ok(week.length > 0 && week.every(B.chatGradable), 'every base chat of the week has a message from the audited SA (' + week.length + ')');
  rows.forEach(r => { const c = B.chatRow(r, { roster: RO }), kept = B.pairComments(r.wira_project_tasks_task_comments, r.wira_project_tasks_task_commentors).filter(p => p.raw.trim());
    ok(c.msgs.length === kept.length, 'one message per non-empty comment');
    ok(c.msgs.every((m, i) => m.author === kept[i].who), 'each message keeps its own author');
    c.msgs.forEach(m => { if (POS(m.author)) ok(m.role === 'client' && !m.internal, 'POS author is the client'); if (BOT(m.author)) ok(m.role === 'bot' && !m.internal, 'bot is never graded or internal');
      ok(!(m.role === 'client' && m.internal), 'client text is never internal'); }); });
  const staffLeft = new Set(); week.forEach(c => c.msgs.filter(m => m.role === 'staff').forEach(m => staffLeft.add(String(m.author).split('@')[0].replace(/[0-9]+/g, '#'))));
  ok(![...staffLeft].some(p => /^(cma|pos)-/.test(p) || /^(sa|bot)-/.test(p)), 'no POS or bot author is left as staff');
  /* a roster SA who is not the assigned SA is sa_other, and the audited SA is only ever the assigned one */
  week.forEach(c => { const names = new Set(c.msgs.filter(m => m.role === 'sa').map(m => m.name)); ok(names.size <= 1, 'one audited SA per chat'); });
  /* a greeting that uses the client's name is client-visible */
  week.forEach(c => { if (!c.clientName) return; c.msgs.filter(m => m.role === 'sa' && new RegExp('^\\s*(hi|hello|hey)\\s+' + c.clientName + '\\b', 'i').test(m.text) && !/@/.test(m.text)).forEach(m => ok(!m.internal, 'greeting the client by name is not internal')); });

  /* the 7 fixtures, with the context the page builds */
  const run = async sid => { const fx = rj(`cases/${sid}.json`), chat = B.chatRow(fx.chatRow, { roster: RO });
    const query = async (cfg, title) => / · tasks$/.test(title) ? fx.relRows || [] : / · orders$/.test(title) ? fx.orderRows || [] : / · order recordings$/.test(title) ? (fx.callRows || []).filter(r => cfg.filters.dimensions.includes(r.calls_conversation_id))
      : / · same caller$/.test(title) ? (fx.callRows || []).filter(r => cfg.filters.dimensions.includes(r.calls_call_phone_detail)) : [];
    return { fx, chat, k: await B.chatContext(chat, { query }) }; };
  const have = sid => fs.existsSync(path.join(D, `cases/${sid}.json`));
  const kids = (k, chat) => k.tasks.every(t => t.parent === chat.wid);
  const tail = (async () => {
    for (const sid of ['1831362', '1825197', '1829490', '1828040', '1819400', '1813744', '1815293']) {
      if (!have(sid)) continue; const { chat, k } = await run(sid);
      const quietAfter = (() => { const i = k.calls.findIndex(l => l.talk !== 'talk'); return i < 0 || k.calls.slice(i).every(l => l.talk !== 'talk'); })();
      ok(quietAfter && k.calls.filter(l => l.talk !== 'talk').length <= B.CHAT.quietCalls && k.calls.filter(l => l.talk === 'talk').length <= B.CHAT.maxCalls, sid + ': call slots');
      ok(k.orders.every(o => o.tie), sid + ': linked orders say how');
      if (chat.orderWids.length) { const tied = k.orders.filter(o => chat.orderWids.includes(o.id)); ok(k.orders.length > 0 && tied.length === k.orders.length && k.orders.every(o => o.tie === 'wira'), sid + ': the order WIRA tied to the chat is the one linked'); }
      if (sid === '1831362') { ok(k.orders.length === 1 && k.orders[0].ticket === '65' && k.calls.length === 2, 'the compensation case still links ticket 65 and 2 calls'); ok(kids(k, chat) && k.tasks.length === 1, 'only the child task'); }
      if (sid === '1825197' || sid === '1829490') { const o = k.orders[0], day = chat.at.slice(0, 10); ok(o && o.at.slice(0, 10) === day, sid + ': the ticket on the chat\'s own day, not the day before'); }
      if (sid === '1828040') { ok(k.orders.length === 1 && k.refs.tickets.includes(k.orders[0].ticket), 'ticket in the text links the order'); ok(!k.ranked.some(r => r.why.some(w => /\$2\.00/.test(w))), 'the $2 fee is not matched to orders'); ok(kids(k, chat), 'only child tasks'); }
      if (sid === '1819400') { ok(k.orders.length === 0 && k.calls.length === 0 && kids(k, chat), 'a printer chat links nothing but its child task'); ok(chat.msgs.some(m => m.via === 'pos' && m.role === 'client'), 'the POS author is the client'); }
      if (sid === '1813744') { ok(k.orders.length === 1 && k.orders[0].tie === 'wira', 'the associated order is linked'); ok(kids(k, chat), 'the SA\'s other tasks about another chat are dropped'); ok(!k.orders.some(o => o.ticket === k.refs.tickets[0] && !chat.orderWids.includes(o.id)), 'the ticket in the text is not preferred over WIRA\'s tie'); }
      if (sid === '1815293') { ok(k.orders.length === 0 && kids(k, chat), 'a menu chat links no order and no other task'); }
    }
    console.log(`chat linking: ${n} checks passed`);
  })();
  tail.catch(e => { console.error(e); process.exit(1); });
  function POS(a) { return !/@/.test(a) && B.POS_RE.test(a); } function BOT(a) { return !/@/.test(a) && B.BOT_RE.test(a); }
}
