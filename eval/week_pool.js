// Offline answers for the page's Lightdash queries, from a saved pool of real rows (data/chats/week_<monday>/pool/, git-ignored).
//   const { poolQuery } = require('./week_pool.js');            // week 2026-10-05 by default
//   const k = await chatContext(chat, { query: poolQuery, ask });  // poolQuery(cfg, title) -> rows, same shape as run_metric_query
//   poolQuery.misses()      -> [{title, kind, reason, filters}]  every query the pool could not answer with confidence (answered with [])
//   poolQuery.reset()       -> clear the misses and the query log
//   poolQuery.log()         -> [{title, kind, rows}] every query answered so far
//   poolQuery.strict = true -> throw on a miss instead of answering []
//   node eval/week_pool.js build [monday]   -> merge pool/raw/*.json into pool/{tasks,orders,calls,saout,states}.json
//   saout: the 6 SAs' outbound calls (no transcripts), raw files saout_*.json = {logins, from, to, rows}; answers the SA-outbound query (login list + outbound + day range)
//
// How a config is answered: the config's own filter string is parsed (`field op=values` clauses joined by AND; values may be quoted),
// the pool rows are filtered the way Lightdash would (restaurant code equals-list, day inBetween, id/phone/wid equals-lists), sorted by
// the config's sorts, cut at its limit, and each row is cut down to exactly the config's dimensions and metrics.
// A query is answered only when the pool provably covers it: every requested (restaurant, day) must be in the pool's coverage, and every
// requested id is either found or known to be absent (see below). Anything else is a miss.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const OA = 'greendot_orders_analytics_aggregate_';
const DAY = { tasks: 'wira_project_tasks_created_at_est', orders: OA + 'order_created_at_est', calls: 'calls_call_started_at_est' };
const day = v => String(v == null ? '' : v).slice(0, 10);
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const dayList = (a, b) => { const o = []; for (let d = a; d <= b; d = new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10)) { o.push(d); if (o.length > 800) break; } return o; };
const poolDir = monday => path.join(ROOT, 'data/chats', 'week_' + monday, 'pool');

/* ---- build: raw Lightdash result files -> one file per dataset, with the restaurant/day coverage each raw query proves ---- */
function build(monday) {
  const dir = poolDir(monday), raw = path.join(dir, 'raw'), out = {};
  const files = fs.readdirSync(raw).filter(f => f.endsWith('.json')).sort();
  for (const kind of ['tasks', 'orders', 'calls']) {
    const rows = new Map(), cover = {}, extraIds = {};  // extraIds: code -> Set(ids) fetched by id (authoritative for those ids)
    let skipped = [];
    for (const f of files.filter(f => f.startsWith(kind + '_'))) {
      const j = rj(path.join(raw, f));
      if (j.capped) { skipped.push(f + ' (hit the 1000-row cap, not counted)'); continue; }
      const hasCode = j.rows.length && 'restaurants_unique_code' in j.rows[0];
      if (!hasCode && j.codes.length !== 1) { skipped.push(f + ' (several restaurants and no code column)'); continue; }
      for (const r of j.rows) {
        const row = hasCode ? r : Object.assign({ restaurants_unique_code: j.codes[0] }, r);
        const k = JSON.stringify(row); if (!rows.has(k)) rows.set(k, row);
      }
      for (const c of j.codes) { cover[c] = cover[c] || new Set(); dayList(j.from, j.to).forEach(d => cover[c].add(d)); }
    }
    const list = [...rows.values()].sort((a, b) => String(a[DAY[kind]]).localeCompare(String(b[DAY[kind]])));
    out[kind] = { kind, fields: Object.keys(list[0] || {}), coverage: Object.fromEntries(Object.entries(cover).map(([c, s]) => [c, [...s].sort()])), rows: list, skipped };
  }
  /* orders fetched by id (older than the window), and calls fetched by id: raw files orderids_*.json / callids_*.json = {codes, ids, from, to, rows} */
  for (const [kind, pre] of [['orders', 'orderids_'], ['calls', 'callids_']]) {
    const ex = {}, seen = new Set(out[kind].rows.map(r => JSON.stringify(r)));
    for (const f of files.filter(f => f.startsWith(pre))) {
      const j = rj(path.join(raw, f));
      for (const r of j.rows) { const row = 'restaurants_unique_code' in r ? r : Object.assign({ restaurants_unique_code: j.codes[0] }, r); const k = JSON.stringify(row); if (!seen.has(k)) { seen.add(k); out[kind].rows.push(row); } }
      for (const c of j.codes) { ex[c] = ex[c] || {}; for (const id of j.ids) ex[c][id] = { from: j.from, to: j.to }; }
    }
    out[kind].rows.sort((a, b) => String(a[DAY[kind]]).localeCompare(String(b[DAY[kind]])));
    out[kind].idsFetched = ex;
  }
  /* same-caller calls fetched by phone for a wider range: raw files phonecalls_*.json = {codes, phones, from, to, rows}; absent calls in that range are then known absent */
  { const ph = {}, seen = new Set(out.calls.rows.map(r => JSON.stringify(r)));
    for (const f of files.filter(f => f.startsWith('phonecalls_'))) {
      const j = rj(path.join(raw, f));
      for (const r of j.rows) { const k = JSON.stringify(r); if (!seen.has(k)) { seen.add(k); out.calls.rows.push(r); } }
      for (const c of j.codes) { ph[c] = ph[c] || {}; for (const p of j.phones) ph[c][p] = { from: j.from, to: j.to }; } }
    out.calls.rows.sort((a, b) => String(a[DAY.calls]).localeCompare(String(b[DAY.calls])));
    out.calls.phonesFetched = ph; }
  /* the SAs' outbound calls (no transcripts), fetched per SA over a day range: a login is covered for every day of its raw file */
  { const rows = [], seen = new Set(), cover = {};
    for (const f of files.filter(f => f.startsWith('saout_'))) {
      const j = rj(path.join(raw, f));
      if (j.capped) { out.calls.skipped.push(f + ' (hit the 1000-row cap, not counted)'); continue; }
      for (const r of j.rows) if (!seen.has(r.calls_conversation_id)) { seen.add(r.calls_conversation_id); rows.push(r); }
      for (const l of j.logins) { cover[l] = cover[l] || new Set(); dayList(j.from, j.to).forEach(d => cover[l].add(d)); } }
    rows.sort((a, b) => String(a[DAY.calls]).localeCompare(String(b[DAY.calls])));
    if (rows.length) out.saout = { kind: 'saout', fields: Object.keys(rows[0]), coverage: Object.fromEntries(Object.entries(cover).map(([l, s]) => [l, [...s].sort()])), rows }; }
  /* states: the week's states.json (status changes of every chat of the week, keyed by wid) */
  const st = rj(path.join(ROOT, 'data/chats', 'week_' + monday, 'states.json'));
  const wids = new Set(st.map(r => r.wira_tasks_state_task_id));
  const base = rj(path.join(ROOT, 'data/chats', 'week_' + monday, 'base_full.json')).map(r => r.wira_project_tasks_wira_id);
  out.states = { kind: 'states', fields: ['wira_tasks_state_task_id', 'wira_tasks_state_task_status', 'wira_tasks_state_task_sub_status', 'wira_tasks_state_created_at_est'], coverage: [...new Set(base.concat([...wids]))].sort(), rows: st };
  for (const k of Object.keys(out)) fs.writeFileSync(path.join(dir, k + '.json'), JSON.stringify(out[k]));
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { rows: v.rows.length, skipped: v.skipped }]));
}

/* ---- parse a Lightdash filter string: `field op=a,b,"c,d" AND field op=...` ---- */
function splitAnd(s) { const out = []; let cur = '', q = false; for (let i = 0; i < s.length; i++) { const ch = s[i];
  if (ch === '"' && s[i - 1] !== '\\') q = !q;
  if (!q && s.slice(i, i + 5) === ' AND ') { out.push(cur); cur = ''; i += 4; continue; } cur += ch; } out.push(cur); return out; }
function splitVals(s) { const out = []; let cur = '', q = false; for (let i = 0; i < s.length; i++) { const ch = s[i];
  if (ch === '"' && s[i - 1] !== '\\') { q = !q; continue; } if (ch === '\\' && q && i + 1 < s.length) { cur += s[++i]; continue; }
  if (!q && ch === ',') { out.push(cur); cur = ''; continue; } cur += ch; } out.push(cur); return out; }
function parseFilters(f) { const o = {}, bad = [];
  const dims = typeof f === 'string' ? f : (f && f.dimensions) || '';
  if (f && typeof f === 'object' && (f.metrics || f.tableCalculations)) bad.push('metric/table-calculation filters');
  splitAnd(dims).filter(x => x.trim()).forEach(cl => { const m = cl.trim().match(/^(\S+)\s+(equals|inBetween)=(.*)$/s);
    if (!m) { bad.push(cl.slice(0, 60)); return; } if (o[m[1] + ' ' + m[2]]) bad.push('repeated ' + m[1]); o[m[1] + ' ' + m[2]] = splitVals(m[3]); });
  return { f: o, bad }; }

const cache = {};
function load(monday) { if (cache[monday]) return cache[monday];
  const dir = poolDir(monday); if (!fs.existsSync(path.join(dir, 'orders.json'))) build(monday);
  const P = {}; for (const k of ['tasks', 'orders', 'calls', 'states']) P[k] = rj(path.join(dir, k + '.json'));
  if (!fs.existsSync(path.join(dir, 'saout.json')) && fs.existsSync(path.join(dir, 'raw')) && fs.readdirSync(path.join(dir, 'raw')).some(f => f.startsWith('saout_'))) build(monday);
  if (fs.existsSync(path.join(dir, 'saout.json'))) P.saout = rj(path.join(dir, 'saout.json'));
  P.cover = {}; for (const k of ['tasks', 'orders', 'calls']) P.cover[k] = Object.fromEntries(Object.entries(P[k].coverage).map(([c, d]) => [c, new Set(d)]));
  if (P.saout) P.saoutCover = Object.fromEntries(Object.entries(P.saout.coverage).map(([l, d]) => [l, new Set(d)]));
  P.stateWids = new Set(P.states.coverage);
  P.byWid = new Map(); P.states.rows.forEach(r => { const w = r.wira_tasks_state_task_id; if (!P.byWid.has(w)) P.byWid.set(w, []); P.byWid.get(w).push(r); });
  P.callIdx = new Map(P.calls.rows.map(r => [r.calls_conversation_id, r]));
  /* which restaurant (and day) an id belongs to, from the order rows that carry it, so an absent call can be told from an uncovered one */
  P.callOwner = new Map(); P.orders.rows.forEach(o => { const ids = [o[OA + 'call_id']].concat(o[OA + 'list_call_ids'] || []).filter(Boolean); ids.forEach(i => { if (!P.callOwner.has(i)) P.callOwner.set(i, o.restaurants_unique_code); }); });
  return cache[monday] = P; }

const state = { misses: [], log: [], strict: false, monday: '2026-10-05' };
function covered(P, kind, code, a, b) { const c = P.cover[kind][code]; if (!c) return false; return dayList(a, b).every(d => c.has(d)); }
function shape(cfg, rows, kind) {
  const keys = (cfg.dimensions || []).concat(cfg.metrics || []);
  const sorts = cfg.sorts || [];
  const out = rows.slice();
  sorts.slice().reverse().forEach(s => { out.sort((x, y) => { const a = x[s.fieldId], b = y[s.fieldId]; const c = a == null && b == null ? 0 : a == null ? 1 : b == null ? -1 : typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b)); return s.descending ? -c : c; }); });
  return out.slice(0, cfg.limit || 1000).map(r => Object.fromEntries(keys.map(k => [k, r[k] === undefined ? null : r[k]])));
}
function miss(title, kind, reason, cfg) { const m = { title, kind, reason, filters: cfg && cfg.filters && (cfg.filters.dimensions || cfg.filters) }; state.misses.push(m);
  console.warn(`[week_pool] MISS ${kind} · ${title || ''} · ${reason}`); if (state.strict) throw new Error('week_pool miss: ' + reason); return []; }

function saoutQuery(P, cfg, f, title) {
  const kind = 'saout', D = P.saout;
  if (!D) return miss(title, kind, 'no saout dataset in the pool (raw/saout_*.json)', cfg);
  const want = (cfg.dimensions || []).concat(cfg.metrics || []), absent = want.filter(k => !D.fields.includes(k));
  if (absent.length) return miss(title, kind, 'pool lacks fields ' + absent.join(','), cfg);
  const extra = Object.keys(f).filter(k => !['internal_users_user_login_name equals', 'calls_call_type equals', DAY.calls + '_day inBetween'].includes(k));
  if (extra.length) return miss(title, kind, 'filter the pool does not model: ' + extra.join(', '), cfg);
  const types = f['calls_call_type equals'], rg = f[DAY.calls + '_day inBetween'], logins = f['internal_users_user_login_name equals'];
  if (!types || types.length !== 1 || types[0] !== 'outbound_call') return miss(title, kind, 'SA query without call type outbound_call', cfg);
  if (!rg || rg.length !== 2) return miss(title, kind, 'no day range', cfg);
  const [a, b] = rg;
  for (const l of logins) { const c = P.saoutCover[l]; if (!c || !dayList(a, b).every(d => c.has(d))) return miss(title, kind, `pool does not cover logins ${l} for ${a}..${b}`, cfg); }
  const rows = D.rows.filter(r => logins.includes(r.internal_users_user_login_name) && day(r[DAY.calls]) >= a && day(r[DAY.calls]) <= b && r.calls_call_type === 'outbound_call');
  const res = shape(cfg, rows, kind);
  state.log.push({ title, kind, rows: res.length });
  return res;
}

function poolQuery(cfg, title) {
  const P = load(state.monday), ex = cfg.exploreName, { f, bad } = parseFilters(cfg.filters);
  const kind = ex === 'wira_project_tasks' ? 'tasks' : ex === 'greendot_orders_analytics_aggregate' ? 'orders' : ex === 'calls' ? 'calls' : ex === 'wira_tasks_state' ? 'states' : '';
  if (!kind) return miss(title, ex, 'no pool for explore ' + ex, cfg);
  if (bad.length) return miss(title, kind, 'filter not understood: ' + bad.join('; '), cfg);
  if (kind === 'calls' && f['internal_users_user_login_name equals']) return saoutQuery(P, cfg, f, title);
  const D = P[kind], want = (cfg.dimensions || []).concat(cfg.metrics || []);
  const absent = want.filter(k => !D.fields.includes(k)); if (absent.length) return miss(title, kind, 'pool lacks fields ' + absent.join(','), cfg);
  const eq = k => f[k + ' equals'], bt = k => f[k + ' inBetween'];
  const extra = Object.keys(f).filter(k => ![
    'restaurants_unique_code equals', DAY[kind] + '_day inBetween', OA + 'order_id equals', 'calls_conversation_id equals', 'calls_call_phone_detail equals', 'wira_tasks_state_task_id equals'].includes(k));
  if (extra.length) return miss(title, kind, 'filter the pool does not model: ' + extra.join(', '), cfg);
  let rows, note = '';
  if (kind === 'states') {
    const wids = eq('wira_tasks_state_task_id'); if (!wids) return miss(title, kind, 'states without a task id list', cfg);
    const unknown = wids.filter(w => !P.stateWids.has(w)); if (unknown.length) return miss(title, kind, `${unknown.length} chat id(s) not in the week: ${unknown[0]}`, cfg);
    rows = wids.flatMap(w => P.byWid.get(w) || []);
  } else {
    const codes = eq('restaurants_unique_code'), rg = bt(DAY[kind] + '_day');
    if (!rg || rg.length !== 2) return miss(title, kind, 'no day range', cfg);
    const [a, b] = rg;
    if (kind === 'tasks' || kind === 'orders') {
      if (!codes) return miss(title, kind, 'no restaurant filter', cfg);
      const idl = kind === 'orders' ? eq(OA + 'order_id') : null;
      const fetched = c => (D.idsFetched || {})[c] || {};
      const unc = codes.filter(c => !covered(P, kind, c, a, b));
      rows = D.rows.filter(r => codes.includes(r.restaurants_unique_code) && day(r[DAY[kind]]) >= a && day(r[DAY[kind]]) <= b);
      if (idl) {
        /* a restaurant whose days are not all in the pool can still answer an id query when each id was fetched by id over the whole range */
        for (const c of unc) for (const id of idl) { const fe = fetched(c)[id]; if (D.rows.some(r => r.restaurants_unique_code === c && r[OA + 'order_id'] === id && day(r[DAY[kind]]) >= a && day(r[DAY[kind]]) <= b)) continue; /* an order id is unique: a row found in the pool settles it */ if (!fe || fe.from > a || fe.to < b) return miss(title, kind, `order ${id} at ${c}: ${a}..${b} not covered and the id was not fetched`, cfg); }
        rows = rows.filter(r => idl.includes(r[OA + 'order_id']));
      } else if (unc.length) return miss(title, kind, `pool does not cover ${unc[0]} for ${a}..${b}`, cfg);
    } else { /* calls */
      const ids = eq('calls_conversation_id'), phones = eq('calls_call_phone_detail');
      if (ids && phones) return miss(title, kind, 'ids and phones in one query', cfg);
      if (ids) {
        const found = ids.map(i => P.callIdx.get(i)).filter(Boolean);
        for (const i of ids) { if (P.callIdx.has(i)) continue;
          const own = P.callOwner.get(i), fe = Object.values(D.idsFetched || {}).some(m => m[i]);
          if (fe) continue;  /* fetched by id: absent for sure */
          if (own && covered(P, 'calls', own, a, b)) continue;  /* its order's restaurant is covered for the whole range, so it is not there */
          return miss(title, kind, `call ${i} is not in the pool and cannot be shown absent (${own ? 'owner ' + own + ' not covered for ' + a + '..' + b : 'no order in the pool carries it'})`, cfg); }
        rows = D.rows.filter(r => ids.includes(r.calls_conversation_id) && day(r[DAY.calls]) >= a && day(r[DAY.calls]) <= b);
        if (codes) rows = rows.filter(r => codes.includes(r.restaurants_unique_code));
      } else if (phones) {
        if (!codes) return miss(title, kind, 'phone query without a restaurant', cfg);
        const unc = codes.filter(c => !covered(P, 'calls', c, a, b));
        for (const c of unc) for (const ph of phones) { const fe = ((D.phonesFetched || {})[c] || {})[ph]; if (!fe || fe.from > a || fe.to < b) return miss(title, kind, `pool does not cover calls of ${c} for ${a}..${b} and phone ${ph} was not fetched`, cfg); }
        rows = D.rows.filter(r => codes.includes(r.restaurants_unique_code) && phones.includes(String(r.calls_call_phone_detail)) && day(r[DAY.calls]) >= a && day(r[DAY.calls]) <= b);
      } else return miss(title, kind, 'calls without an id or phone list', cfg);
    }
  }
  const res = shape(cfg, rows, kind);
  state.log.push({ title, kind, rows: res.length });
  return res;
}
poolQuery.misses = () => state.misses.slice();
poolQuery.reset = () => { state.misses.length = 0; state.log.length = 0; };
poolQuery.log = () => state.log.slice();
poolQuery.use = monday => { state.monday = monday; };
Object.defineProperty(poolQuery, 'strict', { get: () => state.strict, set: v => { state.strict = !!v; } });
poolQuery.pool = () => load(state.monday);

module.exports = { poolQuery, build, parseFilters, poolDir };
if (require.main === module && process.argv[2] === 'build') console.log(JSON.stringify(build(process.argv[3] || '2026-10-05'), null, 1));
