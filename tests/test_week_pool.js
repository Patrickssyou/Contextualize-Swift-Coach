// Week pool: poolQuery answers the chat brain's Lightdash queries offline from saved real rows (data/chats/week_<monday>/pool, git-ignored).
// Skipped when the pool is absent. Wadsworth chat 1831362 is not in the Oct 5-11 week, so the chatContext check pins week chats instead.
const fs = require('fs'), path = require('path'), assert = require('assert');
const ROOT = path.join(__dirname, '..'), WEEK = '2026-10-05', PD = path.join(ROOT, 'data/chats/week_' + WEEK);
if (!fs.existsSync(path.join(PD, 'pool', 'orders.json')) || !fs.existsSync(path.join(PD, 'base_full.json'))) { console.log('test_week_pool: week pool absent, skipped'); process.exit(0); }
const B = require('../src/chat.js'), C = require('../src/core.js');
const { poolQuery, parseFilters } = require('../eval/week_pool.js');
poolQuery.use(WEEK);
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };

(async () => {
  const base = JSON.parse(fs.readFileSync(path.join(PD, 'base_full.json'), 'utf8'));
  const chats = base.map(x => B.chatRow(x, { roster: C.ROSTER_DEFAULT })).filter(c => c.wid && B.isBaseChat(c));
  eq(chats.length, 85, '85 base chats');
  const chat = sid => chats.find(c => c.sid === sid);
  /* the page passes the pull's other chats (to tell two open chats of one SA and restaurant apart) and the pull's end (an open chat's window stops there) */
  const D0 = { query: poolQuery, ask: async () => ({}), until: '2026-10-11T23:59:59', siblings: chats };

  /* parseFilters: AND split, equals lists, quoted commas, inBetween */
  const f = parseFilters('a_day inBetween=2026-10-01,2026-10-05 AND b equals=x,"y,z" AND c equals=R1');
  eq(f.bad, [], 'all clauses understood'); eq(f.f['b equals'], ['x', 'y,z'], 'quoted comma kept'); eq(f.f['a_day inBetween'], ['2026-10-01', '2026-10-05'], 'range');

  /* tasks and orders: exact keys, day and restaurant filter */
  const c1 = chat('1813176');
  poolQuery.reset();
  const tcfg = B.relatedTasksConfig(c1.code, '2026-10-04', '2026-10-07');
  const tr = poolQuery(tcfg, 't');
  ok(Array.isArray(tr), 'tasks rows');
  tr.forEach(r => eq(Object.keys(r).sort(), tcfg.dimensions.concat(tcfg.metrics || []).sort(), 'task row keys are the config fields'));
  const ocfg = B.orderConfig(c1.code, '2026-10-04', '2026-10-05');
  const orr = poolQuery(ocfg, 'o');
  ok(orr.length > 0 && orr.length <= ocfg.limit, 'orders rows');
  orr.forEach(r => eq(Object.keys(r).sort(), ocfg.dimensions.concat(ocfg.metrics || []).sort(), 'order row keys'));
  eq(poolQuery.misses().length, 0, 'no misses so far');

  /* a chat outside the pool is a miss, returned empty and recorded */
  poolQuery.reset();
  eq(poolQuery(B.orderConfig('R00000', '2026-10-04', '2026-10-05'), 'unknown restaurant'), [], 'miss returns []');
  eq(poolQuery.misses().length, 1, 'miss recorded');
  eq(poolQuery(B.orderConfig(c1.code, '2026-01-01', '2026-01-02'), 'outside window'), [], 'uncovered days are a miss');
  eq(poolQuery.misses().length, 2, 'second miss recorded');

  /* the SA-outbound query: the SA's logins, outbound only, a day range; a login or day the pool never fetched is a miss */
  poolQuery.reset();
  const scfg = B.saOutboundConfig(['bestropegd', 'zzbestrope'], '2026-10-05', '2026-10-06'), sr = poolQuery(scfg, 'sa outbound');
  ok(sr.length > 0 && sr.length <= scfg.limit, 'SA outbound rows');
  sr.forEach(r => eq(Object.keys(r).sort(), scfg.dimensions.slice().sort(), 'SA outbound row keys are the config fields'));
  ok(sr.every(r => r.calls_call_type === 'outbound_call' && ['bestropegd', 'zzbestrope'].includes(r.internal_users_user_login_name) && r.calls_call_started_at_est >= '2026-10-05' && r.calls_call_started_at_est < '2026-10-07'), 'only the SA\'s outbound calls in the days asked');
  ok(sr.every((r, i) => !i || sr[i - 1].calls_call_started_at_est <= r.calls_call_started_at_est), 'sorted by start time');
  eq(poolQuery.misses().length, 0, 'SA outbound answered');
  eq(poolQuery(B.saOutboundConfig(['nobody'], '2026-10-05', '2026-10-06'), 'unknown login'), [], 'a login the pool never fetched is a miss');
  eq(poolQuery(B.saOutboundConfig(['bestropegd'], '2026-10-01', '2026-10-06'), 'outside days'), [], 'days the pool never fetched are a miss');
  eq(poolQuery.misses().length, 2, 'both recorded');

  /* chatContext through the pool: pinned chats */
  const pins = [['1813176', '112', 4], ['1813792', '57', 5], ['1812153', '1', 2]];
  for (const [sid, ticket, calls] of pins) {
    poolQuery.reset();
    const k = await B.chatContext(chat(sid), D0);
    eq(k.orders.map(o => String(o.ticket)), [ticket], sid + ' linked ticket');
    eq(k.calls.length, calls, sid + ' calls');
    eq(poolQuery.misses().length, 0, sid + ' no misses');
  }

  /* older WIRA-tied order (outside the pool window) answered from the by-id fetch */
  poolQuery.reset();
  const k = await B.chatContext(chat('1815772'), D0);
  ok(k.orders.length >= 1, '1815772 linked an older order');
  eq(poolQuery.misses().length, 0, '1815772 no misses');

  /* every base chat, no misses */
  poolQuery.reset();
  for (const c of chats) await B.chatContext(c, D0);
  eq(poolQuery.misses().length, 0, 'all 85 chats answered with no misses');
  /* week 2026-10-12 (built from by-id and by-phone fetches): every base chat answers with no misses, using the refs saved by the checkpoint */
  const W2 = '2026-10-12', PD2 = path.join(ROOT, 'data/chats/week_' + W2);
  if (fs.existsSync(path.join(PD2, 'pool', 'orders.json'))) {
    poolQuery.use(W2); poolQuery.reset();
    const chats2 = JSON.parse(fs.readFileSync(path.join(PD2, 'base_full.json'), 'utf8')).map(x => B.chatRow(x, { roster: C.ROSTER_DEFAULT })).filter(c => c.wid && B.isBaseChat(c));
    const seen2 = new Set(), list2 = chats2.filter(c => !seen2.has(c.wid) && seen2.add(c.wid));
    const REFS = path.join(ROOT, 'data/checkpoints/refs'); let ran = 0;
    for (const c of list2) { const rf = path.join(REFS, c.sid + '.json'); if (!fs.existsSync(rf)) continue;
      await B.chatContext(c, { query: poolQuery, ask: async () => JSON.parse(fs.readFileSync(rf, 'utf8')), until: '2026-10-20T00:00:00', siblings: list2 }); ran++; }
    ok(ran > 0, 'week 2026-10-12 chats ran');
    eq(poolQuery.misses().length, 0, `week ${W2}: ${ran} chats answered with no misses`);
    poolQuery.use(WEEK);
  }
  console.log(`test_week_pool: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
