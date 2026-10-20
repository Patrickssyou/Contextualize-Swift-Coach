// Write the chat queue docs of a week, the way the page's pullChats stores them (chatWeeks/<week>/chats/<sid> and the week doc).
//   node eval/week_docs.js <cpId> [--week=2026-10-05]
// Reads data/chats/week_<week>/base_full.json. Writes data/checkpoints/<cpId>/chats/<sid>.json and data/checkpoints/<cpId>/week.json.
const fs = require('fs'), path = require('path');
const B = require('../src/chat.js'), C = require('../src/core.js');
const ROOT = path.join(__dirname, '..');
const [cp] = process.argv.slice(2);
const opt = Object.fromEntries(process.argv.slice(3).map(a => a.replace(/^--/, '').split('=')));
if (!cp) throw new Error('usage: node eval/week_docs.js <cpId> [--week=...]');
const week = opt.week || '2026-10-05', OUT = path.join(ROOT, 'data/checkpoints', cp);
fs.mkdirSync(path.join(OUT, 'chats'), { recursive: true });
const rows = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/chats', 'week_' + week, 'base_full.json'), 'utf8'));
const inputs = JSON.parse(fs.readFileSync(path.join(OUT, 'inputs.json'), 'utf8')), staff = (inputs.staff && inputs.staff.map) || {};
const seen = new Set();
const list = rows.map(x => B.chatRow(x, { roster: C.ROSTER_DEFAULT.map(a => ({ name: a.name })), staff })).filter(c => c.wid && !seen.has(c.wid) && seen.add(c.wid) && B.isBaseChat(c))
  .sort((a, b) => String(a.at).localeCompare(String(b.at)));
const picks = new Set(B.chatPicks(list, B.CHAT.perSA)), per = new Map();
const docs = list.map(c => { let p = picks.has(c.sid) && (per.get(c.sa) || 0) < B.CHAT.perSA; if (p) per.set(c.sa, (per.get(c.sa) || 0) + 1); return [String(c.sid), B.chatQueueDoc(c, p)]; });
docs.forEach(([sid, d]) => fs.writeFileSync(path.join(OUT, 'chats', sid + '.json'), JSON.stringify(d, null, 1)));
const np = docs.filter(d => d[1].picked).length;
fs.writeFileSync(path.join(OUT, 'week.json'), JSON.stringify({ week, chats: docs.length, picked: np, at: new Date().toISOString(), by: null }, null, 1));
const bySA = {}; docs.forEach(([, d]) => { bySA[d.sa] = bySA[d.sa] || { chats: 0, gradable: 0, picked: 0 }; bySA[d.sa].chats++; if (d.gradable) bySA[d.sa].gradable++; if (d.picked) bySA[d.sa].picked++; });
console.log(week, docs.length, 'chats,', np, 'picked'); console.log(JSON.stringify(bySA));
