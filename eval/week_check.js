// Run chatContext (the page's own code) for every base chat of a saved week, answering its Lightdash queries from the pool.
//   node eval/week_check.js [monday] [--json=<file>]
// Pass 1: ask returns {} (no Claude refs). Pass 2: ask returns what a generous Claude pass could add: every ticket-like number in the chat text,
// every phone in it, and a date a week back plus others in between (so the widest order window and call window are exercised).
// Reports: misses, per-chat counts of tasks / linked orders / calls, the tie types, and how often the two passes link different orders.
const fs = require('fs'), path = require('path');
const B = require('../src/chat.js'), C = require('../src/core.js');
const { poolQuery } = require('./week_pool.js');
const ROOT = path.join(__dirname, '..');
const monday = process.argv.slice(2).find(a => /^\d{4}-\d{2}-\d{2}$/.test(a)) || '2026-10-05';
const opt = Object.fromEntries(process.argv.slice(2).filter(a => a.startsWith('--')).map(a => a.replace(/^--/, '').split('=')));
poolQuery.use(monday);

const base = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chats', 'week_' + monday, 'base_full.json'), 'utf8'));
const chats = () => base.map(x => B.chatRow(x, { roster: C.ROSTER_DEFAULT })).filter(c => c.wid && B.isBaseChat(c));

/* what a generous refs pass could say about this chat */
function generousAsk(c) {
  const text = c.msgs.map(m => m.text).join('\n'), day = c.at.slice(0, 10);
  const tickets = [...new Set((text.match(/(?<![\d.$])\d{1,4}(?![\d.])/g) || []).filter(n => Number(n) > 0))].slice(0, 10);
  const phones = [...new Set((text.match(/\b\d{3}[-. ]?\d{3}[-. ]?\d{4}\b/g) || []).map(p => p.replace(/\D/g, '')))].slice(0, 6);
  const times = [7, 6, 4, 3, 2].map(n => { const d = C.addDaysU(day, -n); return `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}`; });
  return { tickets, phones, times, amounts: [], customerNames: [], items: [], orderType: '' };
}

async function run(pass) {
  poolQuery.reset();
  const rows = [];
  for (const c of chats()) {
    const t0 = Date.now(); let k, err = '';
    try { k = await B.chatContext(c, { query: poolQuery, ask: pass === 1 ? async () => ({}) : async () => generousAsk(c) }); }
    catch (e) { err = String(e && e.message || e); }
    rows.push(k ? { sid: c.sid, code: c.code, day: c.at.slice(0, 10), tasks: k.tasks.length, allOrders: k.allOrders.length, linked: k.orders.length, ties: k.orders.map(o => o.tie).join('+'), tickets: k.orders.map(o => o.ticket).join(','),
      calls: k.calls.length, talk: k.calls.filter(l => l.talk === 'talk').length, orderCalls: k.orders.flatMap(o => o.callIds).length, note: k.orderNote ? 'possible' : '', notFound: k.notFound.join('; '), ms: Date.now() - t0 }
      : { sid: c.sid, code: c.code, day: c.at.slice(0, 10), error: err });
  }
  return { rows, misses: poolQuery.misses(), queries: poolQuery.log().length };
}
const dist = (rows, f) => { const m = {}; rows.forEach(r => { const k = f(r); m[k] = (m[k] || 0) + 1; }); return Object.entries(m).sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([k, v]) => `${k}:${v}`).join('  '); };

(async () => {
  const res = {};
  for (const pass of [1, 2]) {
    const r = res[pass] = await run(pass);
    console.log(`\n===== PASS ${pass} (${pass === 1 ? 'ask returns {}' : 'ask returns tickets, phones and dates from the text'}) · ${r.rows.length} chats · ${r.queries} queries answered · ${r.misses.length} misses · ${r.rows.filter(x => x.error).length} errors`);
    r.misses.forEach(m => console.log('  MISS', m.kind, m.title, '|', m.reason));
    r.rows.filter(x => x.error).forEach(x => console.log('  ERROR', x.sid, x.error));
    const ok = r.rows.filter(x => !x.error);
    console.log('  tasks linked    ', dist(ok, x => x.tasks));
    console.log('  orders in window', `min ${Math.min(...ok.map(x => x.allOrders))} max ${Math.max(...ok.map(x => x.allOrders))}`);
    console.log('  linked orders   ', dist(ok, x => x.linked));
    console.log('  tie types       ', dist(ok.filter(x => x.linked), x => x.ties));
    console.log('  calls kept      ', dist(ok, x => x.calls), ' | with talk', dist(ok, x => x.talk));
    console.log('  linked, no call ', ok.filter(x => x.linked && !x.orderCalls).length, ' | "possible order" notes', ok.filter(x => x.note).length);
  }
  const a = Object.fromEntries(res[1].rows.map(x => [x.sid, x])), diff = res[2].rows.filter(x => a[x.sid] && !a[x.sid].error && !x.error && a[x.sid].tickets !== x.tickets);
  console.log(`\nchats whose linked orders differ between the passes: ${diff.length} (expected: the generous pass names many numbers)`);
  console.log('\nper chat (pass 1): sid code day tasks orders-in-window linked(ties) tickets calls(talk)');
  res[1].rows.forEach(x => console.log(x.error ? `  ${x.sid} ${x.code} ${x.day} ERROR ${x.error}` : `  ${x.sid} ${x.code} ${x.day} tasks ${x.tasks} · pool orders ${x.allOrders} · linked ${x.linked}${x.ties ? ' (' + x.ties + ')' : ''} ${x.tickets ? 'ticket ' + x.tickets : ''} · calls ${x.calls} (${x.talk} talk)${x.notFound ? ' · notFound: ' + x.notFound : ''}`));
  if (opt.json) fs.writeFileSync(opt.json, JSON.stringify(res, null, 1));
  const total = res[1].misses.length + res[2].misses.length;
  console.log(`\nTOTAL MISSES ${total}`);
  process.exit(total ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
