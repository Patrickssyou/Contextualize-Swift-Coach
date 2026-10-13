// Build a chat case fixture (data/chats/cases/<sid>.json) from Lightdash rows pulled with the page's own query configs.
//   node eval/chat_fixture.js init <monday> <sid>          -> chatRow from data/chats/week_<monday>/base_full.json; prints the tasks and orders configs
//   node eval/chat_fixture.js set <sid> <key> <rows.json>  -> key = relRows | orderRows | callRows (callRows are merged by conversation id)
//   node eval/chat_fixture.js calls <sid> [--tag=<t>]      -> runs chatContext on the fixture (refs from <sid>.<t>.refs.out.json if present) and prints the calls configs
// Fixtures are real data: they stay in data/ (git-ignored).
const fs = require('fs'), path = require('path');
const B = require('../src/chat.js'), C = require('../src/core.js');
const ROOT = path.join(__dirname, '..'), DIR = path.join(ROOT, 'data/chats/cases');
const [cmd, a1, a2, a3] = process.argv.slice(2);
const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => a.replace(/^--/, '').split('=')));
const rj = f => JSON.parse(fs.readFileSync(f, 'utf8')), fx = sid => path.join(DIR, sid + '.json');
const show = (label, cfg) => console.log(`\n${label}\n${JSON.stringify(cfg)}`);
if (cmd === 'init') {
  const rows = rj(path.join(ROOT, 'data/chats', 'week_' + a1, 'base_full.json')), x = rows.find(r => String(r.wira_project_tasks_short_wira_id) === a2);
  if (!x) throw new Error('no such chat in the week: ' + a2);
  const chatRow = Object.fromEntries(B.CHAT_DIMS.map(k => [k, x[k] === undefined ? null : x[k]]));
  const doc = fs.existsSync(fx(a2)) ? rj(fx(a2)) : { relRows: [], orderRows: [], callRows: [], slack: [], notFound: [], review: null };
  fs.writeFileSync(fx(a2), JSON.stringify(Object.assign({ chatRow }, doc, { chatRow }), null, 1));
  const c = B.chatRow(chatRow, { roster: C.ROSTER_DEFAULT }), day = c.at.slice(0, 10), from = C.addDaysU(day, -1);
  console.log(`wrote ${fx(a2)} · ${c.sid} · ${c.sa} · ${c.code} · ${c.at}`);
  show('TASKS (relatedTasksConfig)', B.relatedTasksConfig(c.code, from, C.addDaysU(day, 2)));
  show('ORDERS (orderConfig)', B.orderConfig(c.code, from, day));
}
if (cmd === 'set') {
  const doc = rj(fx(a1)), rows = rj(a3);
  if (a2 === 'callRows') { const m = new Map((doc.callRows || []).map(r => [r.calls_conversation_id, r])); rows.forEach(r => m.set(r.calls_conversation_id, r)); doc.callRows = [...m.values()]; }
  else doc[a2] = rows;
  fs.writeFileSync(fx(a1), JSON.stringify(doc, null, 1)); console.log(`${a1}: ${a2} = ${doc[a2].length} rows`);
}
if (cmd === 'calls') (async () => {
  const doc = rj(fx(a1)), tag = opt.tag || 'b1', refsF = path.join(DIR, `${a1}.${tag}.refs.out.json`), cfgs = [];
  const chat = B.chatRow(doc.chatRow, { roster: C.ROSTER_DEFAULT });
  const query = async (cfg, title) => { cfgs.push([title, cfg]);
    if (/ · tasks$/.test(title)) return doc.relRows || []; if (/ · orders$/.test(title)) return doc.orderRows || [];
    if (/ · order recordings$/.test(title)) return (doc.callRows || []).filter(r => cfg.filters.dimensions.includes(r.calls_conversation_id));
    if (/ · same caller$/.test(title)) return (doc.callRows || []).filter(r => cfg.filters.dimensions.includes(r.calls_call_phone_detail));
    return []; };
  const k = await B.chatContext(chat, { query, ask: async () => fs.existsSync(refsF) ? rj(refsF) : {}, orderIds: doc.orderIds });
  console.log('refs', JSON.stringify(k.refs));
  console.log('ranked', k.ranked.map(r => `${r.order.ticket}:${r.score} ${r.order.type} ${r.order.at} ${r.why.join('; ')}`).join(' | '));
  console.log('linked', k.orders.map(o => `${o.label} ticket ${o.ticket} ${o.at} calls ${o.callIds.join(',')}`), 'orderNote', k.orderNote);
  console.log('tasks', k.tasks.map(t => `${t.sid} ${t.project} ${t.title.slice(0, 60)}`));
  console.log('calls in fixture used', k.calls.map(l => `${l.id.slice(0, 8)} ${l.at} ${l.dir} ${l.agent} ${l.text.length}ch`));
  cfgs.filter(([t]) => / · (order recordings|same caller)$/.test(t)).forEach(([t, cfg]) => show(t, cfg));
  const ids = [...new Set(k.orders.flatMap(o => o.callIds))];
  if (ids.length) show('ORDER RECORDINGS to fetch (callsByIdsConfig)', B.callsByIdsConfig(ids, C.addDaysU(chat.at.slice(0, 10), -1), chat.at.slice(0, 10)));
})().catch(e => { console.error(e); process.exit(1); });
