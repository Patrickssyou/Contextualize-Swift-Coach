// Chat timing: WIRA keeps no time per message, so timing is the chat's own times plus its status changes (wira_tasks_state).
// Part 1 runs on made-up chats. Part 2 reads real fixtures from data/chats (git-ignored) and is skipped when they are absent.
const fs = require('fs'), path = require('path'), assert = require('assert');
const B = require('../src/chat.js'), C = require('../src/core.js');
const D = path.join(__dirname, '..', 'data/chats');
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, m); n++; };
const roster = [{ name: 'Marianne Kowalski' }];
const W = 'Wid(0,1,2,0,555)';
const st = (at, status, sub) => ({ wira_tasks_state_task_id: W, wira_tasks_state_created_at_est: at + '.123Z', wira_tasks_state_task_status: status, wira_tasks_state_task_sub_status: sub || null });
const chatOf = (o) => B.chatRow(Object.assign({ wira_project_tasks_wira_id: W, wira_project_tasks_short_wira_id: '555', wira_project_tasks_created_at_est: '2026-10-12T10:00:00.000Z',
  wira_project_tasks_assigned_user: 'Marianne Kowalski', wira_project_tasks_conversation_direction: 'inbound',
  wira_project_tasks_task_comments: 'Where is my order ## On it ## Thanks', wira_project_tasks_task_commentors: 'client-+15550001111 ## marianne.kowalski@x.test ## client-+15550001111' }, o || {}), { roster });

/* ---------- 1. The query ---------- */
{ const c = B.chatStatesConfig(W);
  eq(c.exploreName, 'wira_tasks_state', 'the status explore');
  ok(c.filters.dimensions === 'wira_tasks_state_task_id equals="Wid(0,1,2,0,555)"', 'the wid is quoted: ' + c.filters.dimensions);
  ok(c.dimensions.includes('wira_tasks_state_created_at_est') && c.dimensions.includes('wira_tasks_state_task_status') && c.dimensions.includes('wira_tasks_state_task_sub_status'), 'status, sub status and time');
  ok(!/_day inBetween/.test(c.filters.dimensions), 'no day window: a close can come days later');
  ok(B.chatStatesConfig(['Wid(1)', 'Wid(2)']).filters.dimensions === 'wira_tasks_state_task_id equals="Wid(1)","Wid(2)"', 'a list of wids for a whole week'); }

/* ---------- 2. The timing model ---------- */
{ /* a chat: Support's turn, then the client's, a handoff, then closed the next day */
  const c = chatOf({ wira_project_tasks_first_client_message_time_est: '2026-10-12T10:00:00.000Z', wira_project_tasks_first_agent_reply_time_est: '2026-10-12T10:06:30.000Z',
    wira_project_tasks_first_response_time_minutes: '6.5', wira_project_tasks_closed_at_est: '2026-10-13T09:00:00.000Z', wira_project_tasks_status: 'closed' });
  ok(c.timing && c.timing.perMessage === false && c.timing.states.length === 0 && c.timing.waitingOnSupportMin === null, 'chatRow carries the timing known from the row; no status rows yet');
  eq([c.timing.opened, c.timing.firstClientAt, c.timing.firstReplyAt, c.timing.firstReplyMin], ['2026-10-12T10:00:00', '2026-10-12T10:00:00', '2026-10-12T10:06:30', 6.5], 'row times');
  ok(c.msgs.every(m => !('at' in m) && !('replyMin' in m)), 'messages carry no time');
  const t = B.chatTiming(c, [st('2026-10-13T09:00:00', 'closed'), st('2026-10-12T10:06:30', 'blocked', 'waiting_on_client'), st('2026-10-12T10:00:00', 'open', 'pending_reply'), st('2026-10-12T12:00:00', 'in_progress', 'pending_internal_handoff')]);
  eq(t.states.map(s => [s.status, s.on, s.min]), [['open', 'support', 6.5], ['blocked', 'client', 113.5], ['in_progress', 'handoff', 1260], ['closed', 'closed', null]], 'sorted by time; minutes to the next change; whose turn');
  ok(t.states.every(s => !s.ongoing), 'a closed chat has no ongoing status');
  eq([t.waitingOnSupportMin, t.waitingOnClientMin, t.waitingOnHandoffMin], [6.5, 113.5, 1260], 'sums by whose turn');
  eq([t.closedAt, t.handleMin], ['2026-10-13T09:00:00', 1380], 'opened to closed');
  eq(t.slowFirstReply, false, '6.5 min is not slow'); }
{ /* an open chat: the last status is ongoing and has no minutes; handleMin is empty */
  const c = chatOf({ wira_project_tasks_first_client_message_time_est: '2026-10-12T10:00:00.000Z', wira_project_tasks_first_agent_reply_time_est: '2026-10-12T10:20:00.000Z' });
  const t = B.chatTiming(c, [st('2026-10-12T10:00:00', 'open', 'pending_reply'), st('2026-10-12T10:20:00', 'blocked', 'waiting_on_client')]);
  const last = t.states[1];
  ok(last.ongoing === true && last.min === null, 'the current status is ongoing, minutes unknown');
  eq([t.handleMin, t.closedAt, t.waitingOnSupportMin, t.waitingOnClientMin], [null, '', 20, 0], 'open chat: no handle time; the client side counts only finished statuses');
  eq([t.firstReplyMin, t.slowFirstReply], [20, true], 'first reply computed from the two times when the row has no minutes; over 15 min is slow'); }
{ /* closed time falls back to the closed status row */
  const t = B.chatTiming(chatOf(), [st('2026-10-12T10:00:00', 'open', 'pending_reply'), st('2026-10-12T10:30:00', 'closed')]);
  eq([t.closedAt, t.handleMin], ['2026-10-12T10:30:00', 30], 'closed from the status row'); }
{ /* rows for another task are ignored; no rows leaves the sums empty, not zero */
  const other = Object.assign(st('2026-10-12T10:00:00', 'open', 'pending_reply'), { wira_tasks_state_task_id: 'Wid(9)' });
  const t = B.chatTiming(chatOf(), [other]);
  eq([t.states.length, t.waitingOnSupportMin, t.waitingOnClientMin], [0, null, null], 'another task\'s rows are ignored; unknown is null, not 0'); }
{ /* an AE-created chat has no client message and no first reply minutes */
  const t = B.chatTiming(chatOf({ wira_project_tasks_conversation_direction: 'outbound', wira_project_tasks_created_by_title: 'Account Executive' }), []);
  eq([t.firstReplyMin, t.slowFirstReply], [null, false], 'no first reply time to show'); }

/* ---------- 3. chatContext, evidence, docs ---------- */
(async () => {
  const c0 = chatOf({ wira_project_tasks_first_client_message_time_est: '2026-10-12T10:00:00.000Z', wira_project_tasks_first_agent_reply_time_est: '2026-10-12T10:02:20.000Z', wira_project_tasks_first_response_time_minutes: '2.33',
    wira_project_tasks_status: 'blocked', wira_project_tasks_sub_status: 'waiting_on_client', restaurants_unique_code: 'R1', restaurants_english_name: 'Test Pizza' });
  const asked = [];
  const query = async (cfg, title) => { asked.push(cfg.exploreName); return cfg.exploreName === 'wira_tasks_state' ? [st('2026-10-12T10:00:00', 'open', 'pending_reply'), st('2026-10-12T10:02:20', 'blocked', 'waiting_on_client')] : []; };
  const k = await B.chatContext(JSON.parse(JSON.stringify(c0)), { query });
  ok(asked.includes('wira_tasks_state'), 'chatContext asks for the status rows');
  eq(k.timing.states.map(s => s.on), ['support', 'client'], 'k.timing has the states');
  ok(k.timing === k.chat.timing, 'the same timing is on the chat');
  ok(k.timing.firstReplyMin === 2.3 && k.timing.waitingOnSupportMin === 2.3, 'first reply 2.3 min');
  const ev = B.chatEvidence(k);
  ok(/TIMING \(WIRA status times/.test(ev) && /first Support reply 10:02 \(2\.3 min after the first client message\)/.test(ev), 'evidence prints the timing block');
  ok(/open\/pending_reply at 10:00 \(2\.3 min\), Support's turn → blocked\/waiting_on_client at 10:02 \(still the status/.test(ev), 'evidence prints the status changes');
  ok(/WIRA keeps no per-message times/.test(ev) && /do not work out how long any reply after the first took/.test(ev), 'evidence says plainly there are no message times');
  ok(!/^M\d+ · \d/m.test(ev), 'transcript lines carry no invented time');
  const doc = B.chatAuditDoc(k, { F: null, A: null, comp: null, offer: null, check: null, G: null, pct: null, verdict: null }, {});
  eq(doc.timing.states.length, 2, 'the audit doc keeps the timing');
  const q = B.chatQueueDoc(k.chat, true);
  ok(q.timing && q.timing.firstReplyMin === 2.3 && q.frt === 2.33, 'the queue doc keeps the timing and the old fields');
  /* a status query that fails leaves the row's times and says so; a stop is not swallowed */
  const k2 = await B.chatContext(JSON.parse(JSON.stringify(c0)), { query: async (cfg) => { if (cfg.exploreName === 'wira_tasks_state') throw { code: 'tool_error' }; return []; } });
  ok(k2.timing.states.length === 0 && k2.timing.firstReplyMin === 2.3 && k2.notFound.some(x => /status times/.test(x)), 'a failed status query is noted, the chat still runs');
  let stopped = false;
  try { await B.chatContext(JSON.parse(JSON.stringify(c0)), { query: async (cfg) => { if (cfg.exploreName === 'wira_tasks_state') throw { code: 'cancelled' }; return []; }, isStop: e => e.code === 'cancelled' }); } catch (e) { stopped = e.code === 'cancelled'; }
  ok(stopped, 'a cancel is passed on');
  part2();
})().catch(e => { console.error(e); process.exit(1); });

/* ---------- Part 2: real fixtures ---------- */
function part2() {
  const rj = f => JSON.parse(fs.readFileSync(path.join(D, f), 'utf8'));
  if (!fs.existsSync(path.join(D, 'cases/1831362.json')) || !fs.existsSync(path.join(D, 'week_2026-10-05/states.json')) || !fs.existsSync(path.join(D, 'week_2026-10-05/base_full.json'))) {
    console.log(`chat timing: ${n} checks passed (real-data checks skipped, no data/chats states)`); return; }
  const RO = C.ROSTER_DEFAULT, rows = rj('week_2026-10-05/base_full.json'), states = rj('week_2026-10-05/states.json');
  const week = rows.map(r => B.chatRow(r, { roster: RO })).filter(B.isBaseChat);
  const frtOff = []; let frtTotal = 0; let withStates = 0, closed = 0, firstMatch = 0, firstTotal = 0;
  week.forEach(c => {
    const mine = states.filter(s => s.wira_tasks_state_task_id === c.wid), t = B.chatTiming(c, mine);
    ok(t.states.length === mine.length, c.sid + ': one state per row');
    ok(t.states.every((s, i) => i === 0 || s.at >= t.states[i - 1].at), c.sid + ': states in time order');
    if (!mine.length) return;
    withStates++;
    const inbound = c.direction === 'inbound';
    if (inbound) ok(t.states[0].at.slice(0, 16) === c.at.slice(0, 16), c.sid + ': on a client chat the first status is the chat opening');
    else ok(t.states[0].at >= c.at, c.sid + ': on a chat Tarro started the first status can come minutes after it was created');
    ok(t.states.filter(s => s.sub === 'pending_reply').length <= 1, c.sid + ': WIRA never flips back to pending_reply, so status times are not message times');
    const fin = t.states.filter(s => s.min != null).reduce((a, s) => a + s.min, 0);
    if (t.states[t.states.length - 1].on === 'closed') { closed++; if (inbound) ok(t.handleMin != null && Math.abs(t.handleMin - fin) < 0.15 * t.states.length + 0.01, c.sid + ': statuses add up to the open time: ' + fin + ' vs ' + t.handleMin); else ok(t.handleMin != null && t.handleMin >= fin, c.sid + ': open time covers the statuses'); }
    else ok(t.handleMin == null || c.closedAt, c.sid + ': an open chat has no handle time');
    if (c.firstReplyAt) { firstTotal++; if (t.states.some(s => s.at === c.firstReplyAt)) firstMatch++; }
    if (c.initiator === 'ae') { const r = B.aeFirstReply(c.at, t.states); ok(t.firstReplyFrom === 'ae' && t.firstReplyMin === (r ? r.min : null) && (!r || t.firstReplyAt === r.at), c.sid + ': an AE-started chat times the first reply from the AE opening to the first status change'); }
    else if (c.firstClientAt && c.firstReplyAt) { ok(t.firstReplyMin === minBetween(c.firstClientAt, c.firstReplyAt), c.sid + ': first reply minutes come from the two times');
      if (c.frt != null) { frtTotal++; if (Math.abs(t.wiraFirstReplyMin - t.firstReplyMin) >= 0.2) frtOff.push(c.sid); } }
  });
  ok(frtOff.length <= 2 && frtTotal >= 70, 'WIRA\'s own first-response minutes disagree with the times on ' + frtOff.join(',') + ' of ' + frtTotal);
  if (frtOff.includes('1814251')) { const c = week.find(x => x.sid === '1814251'), t = B.chatTiming(c, states.filter(s => s.wira_tasks_state_task_id === c.wid));
    eq([t.firstReplyMin, t.wiraFirstReplyMin], [23.2, 2.1], '1814251: the times (and the status change at the reply) say 23.2 min, WIRA\'s figure 2.1');
    ok(/WIRA's own first-response figure says 2\.1 min/.test(B.chatEvidence({ chat: c, timing: t, tasks: [], orders: [], calls: [], slack: [], notFound: [], orderNote: '' })), 'the evidence flags the disagreement'); }
  function minBetween(a, b) { return B.minBetween(a, b); }
  ok(withStates >= 80 && closed > 20, 'most chats of the week have status rows (' + withStates + ', closed ' + closed + ')');
  ok(firstMatch / firstTotal > 0.85, 'the first Support reply is a status change for most chats (' + firstMatch + '/' + firstTotal + ')');
  /* 1831362, the compensation chat */
  const fx = rj('cases/1831362.json'), chat = B.chatRow(fx.chatRow, { roster: RO });
  const t = B.chatTiming(chat, fx.stateRows);
  eq(t.states.map(s => [s.sub, s.min, !!s.ongoing]), [['pending_reply', 2.3, false], ['waiting_on_client', null, true]], '1831362: Support\'s turn 2.3 min, then waiting on the client');
  eq([t.firstReplyMin, t.slowFirstReply, t.waitingOnSupportMin, t.closedAt, t.handleMin], [2.3, false, 2.3, '', null], '1831362 timing');
  ok(chat.msgs.length >= 10 && chat.msgs.every(m => !('at' in m)), '1831362 has ' + chat.msgs.length + ' messages and no message time');
  console.log(`chat timing: ${n} checks passed`);
}
