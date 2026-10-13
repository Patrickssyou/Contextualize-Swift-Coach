// Summarise a saved week of base chats (data/chats/week_<monday>/base_full.json, the rows chatBaseConfig returns):
//   node eval/chat_week.js <monday> [sid...]   -> one line per base chat: sid, SA, initiator, message count by role, first client words
const fs = require('fs'), path = require('path');
const B = require('../src/chat.js'), C = require('../src/core.js');
const [wk, ...sids] = process.argv.slice(2);
const rows = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data/chats', 'week_' + wk, 'base_full.json'), 'utf8'));
const seen = new Set();
const chats = rows.map(x => B.chatRow(x, { roster: C.ROSTER_DEFAULT })).filter(c => c.wid && !seen.has(c.wid) && seen.add(c.wid) && B.isBaseChat(c));
const pick = sids.length ? chats.filter(c => sids.includes(c.sid)) : chats;
pick.forEach(c => {
  const n = r => c.msgs.filter(m => m.role === r).length;
  const roles = ['client', 'sa', 'sa_other', 'ae', 'lead', 'staff'].map(r => n(r) ? r + n(r) : '').filter(Boolean).join(' ');
  const len = c.msgs.reduce((s, m) => s + m.text.length, 0);
  if (sids.length) { console.log(`\n=== ${c.sid} · ${c.sa} · ${c.initiator} · ${c.at} · ${c.code} · ${c.status}/${c.sub} · frt ${c.frt}`); c.msgs.forEach(m => console.log(`M${m.n} ${m.role}${m.internal ? '(int)' : ''} ${m.name}: ${m.text.replace(/\s+/g, ' ').slice(0, 400)}`)); }
  else console.log(`${c.sid} | ${c.sa.split(' ')[0].padEnd(7)} | ${c.initiator.padEnd(6)} | ${roles.padEnd(28)} | ${String(len).padStart(5)} | ${(c.msgs[0] || { text: '' }).text.replace(/\s+/g, ' ').slice(0, 110)}`);
});
if (!sids.length) console.log(`${chats.length} base chats (${chats.filter(c => c.initiator === 'client').length} client, ${chats.filter(c => c.initiator === 'ae').length} AE); gradable ${chats.filter(B.chatGradable).length}`);
