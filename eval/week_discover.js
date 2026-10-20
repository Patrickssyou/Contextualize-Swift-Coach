// List the Lightdash queries a week's chats still need from the offline pool (data/chats/week_<monday>/pool/raw/).
//   node eval/week_discover.js <monday> [--conc=8] [--json=out.json]
// Runs chatContext for every base chat against the pool with a recording query. The refs pass uses the Claude CLI and is cached in
// data/checkpoints/refs/<sid>.json, the same file eval/checkpoint.js reads, so the later grading links the same evidence.
// Prints the misses grouped by dataset (tasks, orders, calls by id, calls by phone, SA outbound) with the exact config of each query.
const fs = require('fs'), path = require('path');
const B = require('../src/chat.js'), C = require('../src/core.js');
const { poolQuery, build, poolDir } = require('./week_pool.js');
const { claude } = require('./claude_cli.js');
const ROOT = path.join(__dirname, '..');
const week = process.argv[2], opt = Object.fromEntries(process.argv.slice(3).map(a => a.replace(/^--/, '').split('=')));
if (!week) throw new Error('usage: node eval/week_discover.js <monday>');
const REFS = path.join(ROOT, 'data/checkpoints/refs'); fs.mkdirSync(REFS, { recursive: true });
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8'));
poolQuery.use(week);
build(week);                                   // pick up the raw files fetched so far
const rows = rj(path.join(ROOT, 'data/chats', 'week_' + week, 'base_full.json'));
let chats = rows.map(x => B.chatRow(x, { roster: C.ROSTER_DEFAULT })).filter(B.isBaseChat);
const seen = new Set(); chats = chats.filter(c => c.wid && !seen.has(c.wid) && seen.add(c.wid));
const UNTIL = new Date(Date.parse(week + 'T00:00:00Z') + 8 * 864e5).toISOString().slice(0, 10) + 'T00:00:00';
const needs = [];
async function one(c) {
  const refsFile = path.join(REFS, c.sid + '.json');
  const deps = {
    query: async (cfg, title) => { const n = poolQuery.misses().length; const r = poolQuery(cfg, title);
      if (poolQuery.misses().length > n) needs.push({ sid: c.sid, title, reason: poolQuery.misses().pop().reason, cfg }); return r; },
    ask: async (prompt, pass) => {
      if (fs.existsSync(refsFile)) return rj(refsFile);
      let txt; try { txt = await claude(prompt) } catch (e) { txt = await claude(prompt) }
      const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); let j;
      try { j = JSON.parse(txt.slice(a, b + 1)) } catch (e) { throw { code: 'invalid_json', text: txt } }
      fs.writeFileSync(refsFile, JSON.stringify(j, null, 1)); return j;
    },
    policy: {}, cal: [], lessons: [], siblings: chats, until: UNTIL,
  };
  return B.chatContext(JSON.parse(JSON.stringify(c)), deps);
}
(async () => {
  let i = 0; const conc = Number(opt.conc || 8), fail = [];
  await Promise.all(Array.from({ length: conc }, async () => { while (i < chats.length) { const c = chats[i++];
    try { await one(c) } catch (e) { fail.push(c.sid); console.log('FAIL', c.sid, e.code || '', String(e.message || e).slice(0, 150)) } } }));
  const kind = n => n.cfg.exploreName === 'wira_project_tasks' ? 'tasks' : n.cfg.exploreName === 'wira_tasks_state' ? 'states' : n.cfg.exploreName === 'greendot_orders_analytics_aggregate' ? (n.cfg.filters.dimensions.includes('order_id equals') ? 'orders-by-id' : 'orders')
    : n.cfg.filters.dimensions.includes('internal_users_user_login_name') ? 'saout' : n.cfg.filters.dimensions.includes('calls_call_phone_detail') ? 'phone-calls' : 'call-ids';
  needs.forEach(n => n.kind = kind(n));
  const by = {}; needs.forEach(n => (by[n.kind] = by[n.kind] || []).push(n));
  console.log(`${chats.length} chats, ${fail.length} failed, ${needs.length} queries the pool cannot answer:`, Object.fromEntries(Object.entries(by).map(([k, v]) => [k, v.length])));
  if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(needs, null, 1));
  needs.slice(0, 5).forEach(n => console.log(n.kind, n.sid, n.reason));
})();
