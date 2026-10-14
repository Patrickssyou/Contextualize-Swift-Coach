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

  /* chatContext through the pool: pinned chats */
  const pins = [['1813176', '112', 2], ['1813792', '57', 3], ['1812153', '1', 2]];
  for (const [sid, ticket, calls] of pins) {
    poolQuery.reset();
    const k = await B.chatContext(chat(sid), { query: poolQuery, ask: async () => ({}) });
    eq(k.orders.map(o => String(o.ticket)), [ticket], sid + ' linked ticket');
    eq(k.calls.length, calls, sid + ' calls');
    eq(poolQuery.misses().length, 0, sid + ' no misses');
  }

  /* older WIRA-tied order (outside the pool window) answered from the by-id fetch */
  poolQuery.reset();
  const k = await B.chatContext(chat('1815772'), { query: poolQuery, ask: async () => ({}) });
  ok(k.orders.length >= 1, '1815772 linked an older order');
  eq(poolQuery.misses().length, 0, '1815772 no misses');

  /* every base chat, no misses */
  poolQuery.reset();
  for (const c of chats) await B.chatContext(c, { query: poolQuery, ask: async () => ({}) });
  eq(poolQuery.misses().length, 0, 'all 85 chats answered with no misses');
  console.log(`test_week_pool: ${n} checks passed`);
})().catch(e => { console.error(e); process.exit(1); });
