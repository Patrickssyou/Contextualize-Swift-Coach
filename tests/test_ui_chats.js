// Chats area: Queue → Audit → Brain, on the real case (data/chats/cases/1831362.json, git-ignored) plus invented chats from tests/mock.js.
// Storage is by week (chatWeeks/<week>/{chats,audits,tx,reviews}); an invented, already-graded week before the case week covers week switching,
// case types, bot lines, request fields and the game layer's history.
// No names or chat text from the real case are written here: the SA, restaurant and messages are read from the fixture at run time.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), assert = require('assert');
const { openPage, chatWorld, DIR } = require('./mock.js');
const B = require('../src/chat.js');
const SH = path.join(DIR, 'shots'); fs.mkdirSync(SH, { recursive: true });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('ok -', m) };
const SID = '1831362', W = chatWorld(SID);
if (!W) { console.log('ui chats: skipped (no data/chats fixture)'); process.exit(0) }
const WEEK = B.chatWeek(W.fx.chatRow.wira_project_tasks_created_at_est), addD = (d, k) => new Date(Date.parse(d + 'T00:00:00Z') + k * 864e5).toISOString().slice(0, 10);
const NOW = addD(WEEK, 8) + 'T16:00:00Z';                                   // a week later, so the page opens on the case's week
const PW = addD(WEEK, -7);                                                  // the invented, already-graded week before it
const P = (k, w) => `chatWeeks/${w || WEEK}/${k}`;
const SA0 = W.realSA.name, first = SA0.split(' ')[0];
const cal = Object.assign({}, W.calibration[0], { sid: '9900999', id: undefined });   // an older calibration case, not one of this week's chats
const seed = [['settings/chatPolicy', W.policy], ['chatCalib/9900999', cal], ['settings/staff', { map: { 'dana.lowe': { name: 'Dana Lowe', role: 'ae' } } }],
  ['meta/roster', { agents: W.SA.map((s, i) => ({ name: s.name, logins: ['zzsa' + i] })) }]].concat(W.sideWeek(PW));
// the parked call queue (real Sep 28 week) so Calls › Snapshot has something to show
const callSeed = [['pulls/2026-09-28', { status: 'done', week: '2026-09-28', at: '2026-10-05T19:33:25.065Z', added: 30 }]];
for (const f of fs.readdirSync(path.join(DIR, 'data/live4/queue'))) { const q = JSON.parse(fs.readFileSync(path.join(DIR, 'data/live4/queue', f))); if (q.week !== '2026-09-28') continue;
  Object.assign(q, JSON.parse(fs.readFileSync(path.join(DIR, 'data/backfill2', f)))); delete q.version; callSeed.push(['queue/' + f.replace('.json', ''), q]) }
const slack = { search: { '"Harbor Crust"': '# Search Results\n\n### Result 1 of 1\nChannel: #pizza-support-ops (ID: C0TEST1)\nFrom: Sam Ortiz <sam.ortiz@example.test>\nMessage_ts: 1760360000.000100\nReply count: 1\nPermalink: [link](https://slack.example.test/archives/C0TEST1/p1760360000000100)\nText: Harbor Crust printer offline again, can someone check?\n---' },
  threads: { '1760360000.000100': 'THREAD: Harbor Crust printer offline again, can someone check? [Sam Ortiz <sam.ortiz@example.test>]\n\n> Mara Quill <mara.quill@example.test>: On it, reconnecting now.' } };
const more = { chat: W.chat, now: NOW, slack };
// docs directly in a (possibly nested) collection
const docs = (page, c) => page.evaluate(c => Object.entries(window.__data).filter(([p]) => p.startsWith(c + '/') && p.split('/').length === c.split('/').length + 1).map(([p, d]) => Object.assign({ _id: p.split('/').pop() }, d)), c);
const count = (page, c) => page.evaluate(c => Object.keys(window.__data).filter(p => p.startsWith(c + '/') && p.split('/').length === c.split('/').length + 1).length, c);
const nIn = c => `Object.keys(window.__data).filter(p => p.startsWith('${c}/') && p.split('/').length === ${c.split('/').length + 1}).length`;
// live subscriptions on week paths, and how many were ever opened
const weekSubs = page => page.evaluate(() => window.__subs.filter(s => s.on && s.path.startsWith('chatWeeks/')).map(s => s.path).sort().join(' '));
const weekSubN = page => page.evaluate(() => window.__subs.filter(s => s.path.startsWith('chatWeeks/')).length);
const wantSubs = w => ['audits', 'chats', 'reviews'].map(k => `chatWeeks/${w}/${k}`).join(' ');
const caches = (page, from) => page.evaluate(n => window.__prompts.slice(n).map(p => p.cache), from);
const nPrompts = page => page.evaluate(() => window.__prompts.length);
const sel = page => page.locator('[role=tab][aria-selected="true"]').getAttribute('data-tab');
const width = page => page.evaluate(() => document.documentElement.scrollWidth);
const txt = (page, s) => page.locator(s).innerText();
const shot = async (page, name, full) => { await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; window.scrollTo(0, 0) }); await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(SH, name), fullPage: !!full }) };

(async () => {
  const b = await chromium.launch(); const allErrors = [];
  // ===== 1. landing, nav, the parked Calls area
  let { page, ctx, errors } = await openPage(b, seed.concat(callSeed), { viewer: true, sampleMs: 30 }, { width: 1280, height: 900 }, more);
  await page.goto('http://qa.test/'); await page.waitForTimeout(400);
  ok(await sel(page) === 'chats' && await page.locator('#view-chats').isVisible() && await page.locator('[data-area="chats"][aria-current="page"]').count() === 1, 'lands on Chats › Queue');
  ok((await page.locator('.weekpick small').textContent()) === 'Week' && (await txt(page, '#wkLabel')).startsWith('Oct 12'), 'week picker says Week and opens on the case week');
  const subs = (await page.locator('#sub-chats [role=tab]').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  ok(subs.length === 3 && ['Queue', 'Audit', 'Brain'].every((x, i) => subs[i].includes(x)), 'Chats steps: Queue, Audit, Brain');
  ok(/Not pulled yet/.test(await txt(page, '#chatStatus')) && await page.locator('#chatPull').isEnabled(), 'empty week: Pull chats ready');
  ok(await page.locator('#chatBtns button').count() === 1 && await page.locator('#chatQuest').isHidden() && await page.locator('#chatGroups > *').count() === 0, 'a week with no pull shows the Pull button only');

  // ----- 1b. storage by week: one week's collections live, other weeks' reviews read once for the game layer
  await page.waitForFunction(() => gameStats().xp === 15, null, { timeout: 5000 });
  ok((await txt(page, '#xpNum')) === '15 XP' && await page.evaluate(w => window.__gets.includes(`chatWeeks/${w}/reviews`) && window.__gets.includes('chatWeeks'), PW), "XP counts last week's review (+10, +5 calibration), read once with get()");
  ok(await weekSubs(page) === wantSubs(WEEK), 'live: only the selected week, chats + audits + reviews');
  const n0 = await weekSubN(page);
  await page.click('#wkPrev');
  await page.waitForFunction(() => document.querySelectorAll('.crow').length === 2, null, { timeout: 5000 });
  ok(await weekSubs(page) === wantSubs(PW) && await weekSubN(page) - n0 === 3, 'week change: the old week unsubscribed, the new week subscribed once');
  ok((await txt(page, '#chatGroups')).includes('Birch Lane Pizza') && await page.locator('.crow', { hasText: 'Fern Street Slice' }).locator('.pill', { hasText: 'No SA reply' }).count() === 1 && await page.locator('.crow[data-open="9900902"] .cpick:disabled').count() === 1, "the other week's chats show; gradable:false gets No SA reply");
  ok(await page.locator('#chatBtns button').count() === 3 && await page.locator('#chatQuest').isVisible() && await page.evaluate(() => gameStats().xp) === 15, 'a pulled week shows its buttons and quest; XP unchanged');
  await page.click('.crow[data-open="9900901"] .clink'); await page.waitForTimeout(300);
  ok(await sel(page) === 'chat' && await page.evaluate(() => location.hash) === `#chat/${PW}/9900901`, 'the chat link carries its week');
  ok((await txt(page, '#cvWord')) === 'Great' && (await txt(page, '#cvCase')).includes('MENU SETUP') && (await txt(page, '#cvCase')).includes('Correct two menu prices shown online'), 'verdict card: case type label and request');
  const dts = (await page.locator('#cs-an .adl dt').allInnerTexts()).map(t => t.trim().toLowerCase());
  ok(dts[0] === 'case type' && dts[1] === 'request' && (await page.locator('#cs-an .adl dd').first().innerText()).trim() === 'Menu setup', 'Analysis opens with the case type and the request');
  ok((await txt(page, '#cs-an .aline')) === 'Not a compensation case' && await page.locator('#cs-an .cline').count() === 0 && !dts.includes('policy'), 'not compensation: one plain line instead of Policy and Compensation');
  ok((await page.locator('#cs-an .adl .pill').first().innerText()) === 'No fault' && (await txt(page, '#cs-an .qans')) === 'Menu setup · No fault', 'fault none shows as No fault');
  ok(await page.locator('#cs-chat .sysline').count() === 1 && /system/i.test(await txt(page, '#cm-2.sysline')) && (await txt(page, '#cm-2')).includes('Menu change request created') && await page.locator('#cs-chat .bub').count() === 5, 'bot message renders as a system line, not a bubble');
  ok(await page.locator('#cs-chat .bub.other').count() === 1 && (await txt(page, '#cs-chat .bub.other .bwho')).includes('trainer'), 'unknown role: neutral bubble labelled with the role');
  const rf = await txt(page, '#cxFields');
  ok(/request fields/i.test(rf) && rf.includes('Large Margherita') && /new price/i.test(rf) && rf.includes('16.99') && /not linked yet/i.test(await txt(page, '#cs-ctx')) === false, 'Context shows the request fields');
  ok(JSON.stringify(await page.evaluate(() => [chFieldList({ a_b: 'x', n: null }), chFieldList([{ name: 'Item', value: 'Pie' }, 'loose']), chFieldList('not json'), chFieldList('{}')]))
    === JSON.stringify([[['A b', 'x']], [['Item', 'Pie'], ['', 'loose']], [['', 'not json']], []]), 'request fields read objects, name/value lists and raw strings');
  await shot(page, 'chats-audit-case.png'); await shot(page, 'chats-audit-case-full.png', true);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(100); await shot(page, 'chats-audit-case-dark.png'); await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
  ok(await width(page) <= 390, `390px case audit: no horizontal overflow (${await width(page)})`);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('#wkNext'); await page.click('[data-tab="chats"]'); await page.waitForTimeout(250);
  ok(await weekSubs(page) === wantSubs(WEEK) && await weekSubN(page) - n0 === 6 && await page.locator('.crow').count() === 0 && /Not pulled yet/.test(await txt(page, '#chatStatus')), 'back to the case week: resubscribed once, empty again');
  await page.click('[data-area="calls"]'); await page.waitForTimeout(150);
  ok(await sel(page) === 'queue' && await page.locator('#view-queue').isVisible() && await page.locator('#pullBtn').isVisible() && await page.evaluate(() => location.hash) === '#queue', 'Calls opens Snapshot (#queue)');
  await page.click('#wkPrev'); await page.click('#wkPrev'); await page.waitForTimeout(200);
  ok(await page.locator('#view-queue .qcard').count() >= 6 && /of 30 audited/.test(await txt(page, '#quest')), 'Snapshot still lists the call picks and the week quest');
  await shot(page, 'calls-parked.png');
  await page.click('[data-tab="calls"]'); await page.waitForTimeout(100);
  ok(await sel(page) === 'calls' && await page.locator('#view-calls').isVisible(), 'Calls › Calls still opens');
  await page.click('[data-tab="results"]'); await page.waitForTimeout(100);
  ok(await page.locator('#view-results').isVisible() && await page.locator('#sub-calls').isVisible() && await page.locator('[data-area="results"][aria-current="page"]').count() === 1, 'Results keeps the call steps in reach');
  await page.click('#wkNext'); await page.click('#wkNext'); await page.click('[data-area="chats"]'); await page.waitForTimeout(150);
  ok(await sel(page) === 'chats', 'Chats area returns to Queue');

  // ===== 2. pull: chatWeeks/<week>/chats docs with 5 picks per SA (or all if fewer)
  const nSub = await weekSubN(page);
  await page.click('#chatPull');
  await page.waitForFunction(`${nIn(P('chats'))} >= 11 && !document.querySelector('#chatStatus .spin') && document.querySelectorAll('.crow').length === 11`, null, { timeout: 15000 });
  let C = await docs(page, P('chats'));
  const by = sa => C.filter(c => c.sa === sa);
  ok(C.length === 11 && C.every(c => c.week === WEEK && Array.isArray(c.msgs)), `pull writes 11 chats to chatWeeks/${WEEK}/chats`);
  ok(await page.evaluate(w => { const d = window.__data['chatWeeks/' + w]; return !!d && d.chats === 11 && d.week === w }, WEEK) && await count(page, 'chats') === 0, 'the week index doc is written; nothing at the old top-level path');
  ok(by(SA0).filter(c => c.picked).length === 2 && by('Mara Quill').filter(c => c.picked).length === 5 && by('Theo Brandt').filter(c => c.picked).length === 2, 'picks: 5 per SA, or all when an SA has fewer');
  const noReply = C.find(c => !c.gradable); ok(noReply && !noReply.picked && by('Mara Quill').filter(c => c.gradable).length === 6, 'the chat with no SA reply is not gradable and not picked');
  const aeChat = C.find(c => c.initiator === 'ae'); ok(aeChat && aeChat.msgs[0].role === 'ae' && aeChat.msgs[0].name === 'Dana Lowe', 'AE-created chat: AE named from the staff directory');
  ok(await page.locator('.sacard').count() === 3 && await page.locator('.crow').count() === 11, 'SA strip has 3 cards; 11 rows grouped by SA');
  ok(await page.locator('.crow .pill', { hasText: 'No SA reply' }).count() === 1 && await page.locator('.crow .itag.ae').count() === 1 && await page.locator('.crow .cpick:disabled').count() === 1, 'rows show No SA reply, the AE tag and a locked pick');
  ok((await page.locator('.crow', { hasText: 'Oak Street Pies' }).first().innerText()).includes('Reply'), 'rows show the first reply time');
  // re-pull keeps the picks already made
  const unpick = by('Mara Quill').find(c => c.picked)._id;
  await page.click(`.cpick[data-pick="${unpick}"]`); await page.waitForTimeout(150);
  ok((await docs(page, P('chats'))).find(c => c._id === unpick).picked === false, 'pick toggle writes the chat doc');
  await page.click('#chatPull'); await page.waitForFunction(() => !document.querySelector('#chatStatus .spin'), null, { timeout: 15000 }); await page.waitForTimeout(150);
  C = await docs(page, P('chats'));
  ok(C.find(c => c._id === unpick).picked === false && C.filter(c => c.picked).length === 8, 're-pulling keeps the picks (8 after one unpick)');
  await page.click(`.cpick[data-pick="${unpick}"]`); await page.waitForTimeout(150);

  // ===== 3. grade picks: audits + transcripts, one at a time
  ok((await page.locator('#chatGradePicks').innerText()).includes('9'), 'Grade picks shows 9');
  await page.click('#chatGradePicks');
  await page.waitForFunction(() => document.querySelector('#chatStatus') && /Grading \d+ of 9 · /.test(document.querySelector('#chatStatus').textContent), null, { timeout: 5000 });
  ok(true, 'progress line: Grading N of 9 · SA · restaurant · step');
  await page.waitForFunction(`${nIn(P('audits'))} === 9 && !document.querySelector('#chatStatus .spin') && [...document.querySelectorAll('.crow .pill')].filter(p => /^Graded/.test(p.textContent)).length === 9`, null, { timeout: 60000 });
  ok(await count(page, P('audits')) === 9 && await count(page, P('tx')) === 9, "Grade picks writes the week's audits and tx for the 9 picks");
  ok(await page.evaluate(() => window.__prompts.length >= 36 && window.__prompts.every(p => p.cache === undefined)), 'first grades use the default sample cache');
  ok(await weekSubN(page) === nSub, 'pulling and grading open no new subscriptions');
  ok(/Graded 9 chats/.test(await txt(page, '#chatStatus')) && await page.locator('.crow .pill', { hasText: 'Graded' }).count() === 9, 'queue shows Graded pills and the summary');
  const realA = await page.evaluate(p => window.__data[p], P('audits/' + SID));
  ok(realA.verdict === 'okay' && realA.pct === 74.2 && realA.orders[0].ticket === '65', 'real case graded Okay 74.2 on ticket 65');
  await shot(page, 'chats-queue.png');

  // ===== 4. the real case in Audit
  await page.click(`.crow[data-open="${SID}"] .clink`); await page.waitForTimeout(300);
  ok(await sel(page) === 'chat' && await page.evaluate(() => location.hash) === `#chat/${WEEK}/${SID}`, 'row opens Audit at #chat/<week>/<sid>');
  ok((await txt(page, '#cvWord')) === 'Okay' && (await txt(page, '#cvPct')) === '74.2%', 'verdict card: Okay 74.2%');
  await shot(page, 'chats-audit-top.png'); await shot(page, 'chats-audit-full.png', true);
  ok(await page.locator('#cvRoute .rm').count() === 4 && (await txt(page, '#cvEsc')) === 'Level 2', 'route marks with escalation Level 2');
  ok(await page.locator('#cvCase').count() === 0 && (await page.locator('#cs-an .adl dt').allInnerTexts()).map(t => t.toLowerCase()).includes('policy') && await page.locator('#cs-an .aline').count() === 0, 'an older audit with no case type keeps Policy and Compensation');
  const meta = await txt(page, '.vmeta');
  ok(meta.includes(SA0) && meta.includes(W.code) && meta.includes('2.3 min') && meta.includes('Client'), 'chat meta: SA, restaurant code, first reply, started by');
  const ord = await txt(page, '.ordcard');
  ok(/Ticket 65/.test(ord) && ord.includes('$54.72') && ord.includes('$4.38') && ord.includes('$59.10'), 'money card: ticket 65, items $54.72, tax $4.38, total $59.10');
  ok((await txt(page, '.cline.right')) === 'Right: 30% × $54.72 items = $16.42', 'comp line: Right: 30% × $54.72 items = $16.42');
  ok((await txt(page, '.cline.off')) === `${first} offered $17.73: 30% of the full bill $59.10 (tax included) instead of $54.72 items`, 'offer line: offered $17.73 on the full bill');
  const ints = await page.locator('.bub.internal').allInnerTexts();
  ok(ints.length === 3 && ints.every(t => t.includes('internal · inferred')), '3 internal notes tagged internal · inferred');
  ok(await page.locator('.bub.cl').count() > 0 && await page.locator('.bub.me').count() > 0, 'client bubbles left, audited SA bubbles marked');
  ok(await page.locator('#cs-ctx .txcall').count() === 2 && await page.locator('#cs-ctx .txcall a', { hasText: 'Rec' }).count() === 2 && await page.locator('#cs-ctx .txsum li').count() > 4, 'two call cards with recordings and Claude bullets');
  await page.locator('#cs-ctx details.txd summary').first().click();
  await page.waitForFunction(() => { const t = document.querySelector('#cs-ctx details.txd .txtext'); return t && t.textContent.length > 100 }, null, { timeout: 5000 });
  ok(true, 'transcript loads from chatTx');
  ok(await page.locator('#cs-ctx .task').count() === 1 && await page.locator('#cs-ctx .task .ttag', { hasText: 'From this chat' }).count() === 1, 'linked task from this chat');
  ok(await page.locator('.cfacts .fact').count() === realA.facts.timeline.length && await page.locator('.claim').count() === realA.facts.claims.length, `case facts: ${realA.facts.timeline.length} facts, ${realA.facts.claims.length} claims`);
  ok(await page.locator('.claim.contradicted').count() === realA.facts.claims.filter(c => c.check === 'contradicted').length, 'contradicted claims flagged');
  ok(await page.locator('.ccrit').count() === 9 && await page.locator('[data-cm="esc"]').count() === 6 && await page.locator('[data-cm="ev"][data-v="na"]').count() === 0, 'scorecard: 9 criteria, esc 0–4 + N/A, N/A only where allowed');
  ok((await page.locator('#coachText').inputValue()).startsWith(`Chat ${SID} · `) && /— Okay \(74\.2%\)/.test(await page.locator('#coachText').inputValue()), 'coaching note starts with the chat line and the verdict');
  // cite links jump without touching the route
  await page.locator('#cs-an .cite').first().click(); await page.waitForTimeout(200);
  ok(await page.evaluate(() => location.hash) === `#chat/${WEEK}/${SID}`, 'cites scroll to the fact and keep the route');

  // ===== 5. change a mark: % and verdict recompute live
  const marks = Object.assign({}, realA.grade.scores, { amt: 3 });
  const want = await page.evaluate(s => { const p = chatScore(s); return { p: fmt(p), v: chatVerdict(p).label } }, marks);
  await page.click('[data-cm="amt"][data-v="3"]'); await page.waitForTimeout(100);
  ok((await txt(page, '#cvPct')) === want.p + '%' && (await txt(page, '#cvWord')) === want.v && (await txt(page, '#csScoreAns')) === `${want.v} · ${want.p}%`, `one mark changes the score to ${want.v} ${want.p}%`);
  ok(await page.locator('#was-amt').isVisible() && (await txt(page, '#was-amt')) === 'Claude 1' && await page.locator('#cvClaude').isVisible(), "Claude's original mark shown when changed");
  ok((await page.locator('#coachText').inputValue()).includes(`— ${want.v} (${want.p}%)`), 'coaching note follows the marks');

  // ===== 6. save review: chatReviews + XP
  const xp0 = await page.evaluate(() => gameStats().xp);
  await page.fill('#chatReviewer', 'QA lead');
  await page.click('#chatSave'); await page.waitForTimeout(300);
  const rv = await page.evaluate(p => window.__data[p], P('reviews/' + SID));
  ok(rv && rv.scores.amt === 3 && fmt(rv.pct) === want.p && rv.verdict === B.chatVerdict(rv.pct).id && rv.week === WEEK && rv.sa === SA0 && rv.reviewer === 'QA lead' && rv.by === 'u_test' && rv.coaching.startsWith('Chat ' + SID), 'Save review writes chatReviews/<sid>');
  const xp1 = await page.evaluate(() => gameStats().xp);
  ok(xp1 - xp0 === 10, `review adds 10 XP (${xp0} → ${xp1})`);
  ok(/Saved .* · \+10 XP · 1 of 9/.test(await txt(page, '#toast')) && await page.locator('#toast .tact', { hasText: 'Next chat' }).count() === 1, 'toast: +10 XP · 1 of 9, offers Next chat');
  ok(await page.locator('#cs-score.done').count() === 1 && await page.locator('.vhead .pill', { hasText: 'Reviewed' }).count() === 1, 'reviewed state shown');
  function fmt(p) { return (Math.round(p * 10) / 10).toFixed(1) }

  // ===== 7. save as calibration case
  await page.click('#calOpen'); await page.click('[data-calv="okay"]');
  await page.fill('#calLessons', 'Base is the item subtotal, not the bill\n- Own the miss before explaining the policy');
  await page.click('#calSave'); await page.waitForTimeout(250);
  const cc = await page.evaluate(s => window.__data['chatCalib/' + s], SID);
  ok(cc && cc.verdict === 'okay' && cc.lessons.length === 2 && cc.lessons[1] === 'Own the miss before explaining the policy' && cc.scores.amt === 3 && cc.agent === SA0 && cc.date === W.fx.chatRow.wira_project_tasks_created_at_est.slice(0, 10), 'Save as calibration case writes chatCalib/<sid>');
  ok(await page.evaluate(() => gameStats().xp) - xp1 === 5, 'calibration case adds 5 XP on a reviewed chat');

  // ===== 8. change order: ranked matches, then the whole day (searchable), then No order; every pick re-grades fresh
  await page.click('#ordChange'); await page.waitForTimeout(100);
  const cids = new Set(realA.candidates.map(x => x.id)), rest = realA.dayOrders.filter(o => !cids.has(o.id)), c65 = realA.candidates.find(x => x.ticket === '65');
  ok(realA.dayOrders.length === 101 && await page.locator('.opick .ocand').count() === realA.candidates.length && (await page.locator('.opick .ocand', { hasText: 'Ticket 65' }).innerText()).includes(c65.why[0]), `Change order: ${realA.candidates.length} ranked matches first, with their reasons`);
  ok(await page.locator('#ordList .orow').count() === rest.length && (await txt(page, '#ordN')) === String(rest.length) && await page.locator('#ordPick [data-oid=""]', { hasText: 'No order' }).count() === 1, `then the other ${rest.length} orders of the day, then No order`);
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.mouse.move(0, 0);
  await page.locator('#cs-ctx').screenshot({ path: path.join(SH, 'chats-change-order.png') });
  const vis = () => page.evaluate(() => [...document.querySelectorAll('#ordList .orow')].filter(r => !r.hidden).map(r => r.dataset.q));
  const tgt = rest.find(o => o.ticket && rest.filter(x => x.total === o.total).length === 1 && rest.filter(x => x.ticket === o.ticket).length === 1);
  await page.fill('#ordQ', '$' + tgt.total.toFixed(2)); let v = await vis();
  ok(v.length >= 1 && v.includes([tgt.ticket, tgt.total.toFixed(2), tgt.items.toFixed(2)].join(' ')) && v.every(q => q.split(' ').some(k => k.includes(tgt.total.toFixed(2)))) && (await txt(page, '#ordN')) === `${v.length} of ${rest.length}`, `search by amount ($${tgt.total.toFixed(2)}: ${v.length} shown)`);
  await page.fill('#ordQ', '#' + tgt.ticket); v = await vis();
  ok(v.length >= 1 && v.every(q => q.split(' ').some(k => k.includes(tgt.ticket))) && v.some(q => q.split(' ')[0] === tgt.ticket), `search by ticket (#${tgt.ticket}: ${v.length} shown)`);
  await page.fill('#ordQ', 'zzz');
  ok((await vis()).length === 0 && await page.locator('#ordNone').isVisible(), 'no match says so');
  await page.fill('#ordQ', ''); ok((await vis()).length === rest.length, 'clearing the search shows every order');
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
  ok(await width(page) <= 390, `390px order picker: no horizontal overflow (${await width(page)})`);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(100);
  let pq = await nPrompts(page);
  await page.click(`#ordList .orow[data-oid="${tgt.id}"]`);
  await page.waitForFunction(([p, id]) => { const a = window.__data[p]; return a && a.orderPick === 'reviewer' && a.orders.length === 1 && a.orders[0].id === id && !document.querySelector('#chatSteps') }, [P('audits/' + SID), tgt.id], { timeout: 20000 }); await page.waitForTimeout(150);
  let cs = await caches(page, pq);
  ok(cs.length === 4 && cs.every(c => c === false), 'picking an order re-grades with cache:false on every pass (refs, facts, analysis, grade)');
  ok((await txt(page, '.ordcard')).includes('Ticket ' + tgt.ticket) && await page.locator('#cs-ctx .ttag', { hasText: 'Your pick' }).count() === 1, 'the picked order is linked as your pick');
  // → No order: re-grade without the order, money card gone
  await page.click('#ordChange'); await page.waitForTimeout(100);
  pq = await nPrompts(page);
  await page.evaluate(() => { window.__opts.sampleMs = 250 });
  await page.click('.opick [data-oid=""]');
  await page.waitForFunction(() => document.querySelector('#chatSteps .cst.done'), null, { timeout: 5000 });
  const steps = await page.locator('#chatSteps .cst').allInnerTexts();
  ok(steps.length === 8 && steps[0].includes('Linked tasks') && await page.locator('#cvStop').isVisible() && await page.locator('#cvGrade').count() === 0, 'grading shows the 8-step checklist and Stop');
  await page.evaluate(() => { window.__opts.sampleMs = 30 });
  await page.waitForFunction(p => { const a = window.__data[p]; return a && a.orderPick === 'reviewer' && !a.orders.length && !document.querySelector('#chatSteps') }, P('audits/' + SID), { timeout: 20000 }); await page.waitForTimeout(150);
  ok(await page.locator('.ordcard').count() === 0 && (await txt(page, '#cs-ctx')).includes('No order linked') && await page.locator('#cs-ctx .ttag', { hasText: 'Your pick' }).count() === 1, 'No order: re-graded, the money card is gone');
  cs = await caches(page, pq); ok(cs.length === 4 && cs.every(c => c === false), 'No order re-grades with cache:false');
  ok(await page.locator('#cs-ctx .txcall').count() === 0, 'no order, no recordings');

  // ===== 9. next chat, dark, phone widths
  await page.click('#cvNext'); await page.waitForTimeout(200);
  const nextSid = await page.evaluate(() => chatSel);
  ok(nextSid && nextSid !== SID && await page.evaluate(() => location.hash) === `#chat/${WEEK}/${nextSid}` && (await txt(page, '#cvWord')).length > 0, 'Next chat opens the next unreviewed pick');
  ok((await txt(page, '#cvGrade')) === 'Re-grade', 'a graded chat offers Re-grade');
  pq = await nPrompts(page);
  await page.click('#cvGrade');
  await page.waitForFunction(n => window.__prompts.length >= n + 4 && !chatRun && !document.querySelector('#chatSteps'), pq, { timeout: 20000 }); await page.waitForTimeout(100);
  cs = await caches(page, pq); ok(cs.length === 4 && cs.every(c => c === false), 'Re-grade asks Claude fresh (cache:false)');
  await page.click('#coachCopy'); await page.waitForTimeout(150);
  ok(/Copied|Couldn't copy/.test(await txt(page, '#toast')), 'Copy gives feedback');
  const harbor = await page.evaluate(() => (Object.values(window.__data).find(d => d.restaurant === 'Harbor Crust' && d.grade) || {}).sid);
  await page.evaluate(s => openChat(s), harbor); await page.waitForTimeout(200);
  const hs = await page.evaluate(p => window.__data[p].slack, P('audits/' + harbor));
  ok(hs.length === 1 && hs[0].channel === 'pizza-support-ops' && hs[0].replies.length === 1 && await page.locator('#cs-ctx .task', { hasText: 'printer offline' }).count() === 1, 'Slack threads about the restaurant are linked and shown');
  ok(await page.evaluate(() => window.__slack.some(x => x.tool === 'slack_search_public' && x.input.keywords[0] === '"Harbor Crust"' && Number(x.input.before) > Number(x.input.after))), 'Slack search: restaurant name, day before to day after');
  await page.evaluate(p => window.claude.use('db').then(db => db.doc(p).get().then(d => { const a = d.data(); a.analysis.caseNotes = { kind: 'repeat', count: 2 }; return db.doc(p).set(a) })), P('audits/' + SID));
  await page.evaluate(s => openChat(s), SID); await page.waitForTimeout(250);
  const an = await txt(page, '#cs-an');
  ok(/case notes/i.test(an) && an.includes('repeat'), 'unknown analysis fields are shown, not dropped');
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(150);
  await shot(page, 'chats-audit-dark.png');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(200);
  ok(await width(page) <= 390, `390px audit: no horizontal overflow (${await width(page)})`);
  await shot(page, 'chats-audit-390.png');
  await page.click('[data-tab="chats"]'); await page.waitForTimeout(200);
  ok(await width(page) <= 390, `390px queue: no horizontal overflow (${await width(page)})`);
  await shot(page, 'chats-queue-390.png');
  await page.click('[data-tab="brain"]'); await page.waitForTimeout(200);
  ok(await width(page) <= 390, `390px brain: no horizontal overflow (${await width(page)})`);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(150);

  // ===== 10. Brain: policy, calibration cases, staff, rubric
  ok(await sel(page) === 'brain' && (await page.locator('#polText').inputValue()).length > 200 && await page.locator('#brRubric .rbr:not(.rbh)').count() === 9, 'Brain shows the policy text and the 9-row rubric');
  ok(await page.locator('#brCal .calitem').count() === 3 && await page.locator('#brStaff .srow:not(.srh)').count() === 4, 'Brain lists 3 calibration cases and the staff directory');
  await shot(page, 'chats-brain.png');
  const bi = W.policy.comp.buckets.findIndex(x => x.id === 'made_twice_one_paid');
  await page.fill(`[data-bpct="${bi}"]`, '35'); await page.fill('#polLimit', '30');
  ok(await page.locator('#polSave').isEnabled() && await page.locator('#polUndo').isVisible(), 'editing the policy arms Save');
  await page.click('#polSave'); await page.waitForTimeout(200);
  const pol = await page.evaluate(() => window.__data['settings/chatPolicy']);
  ok(pol.comp.buckets[bi].pct === 35 && pol.comp.approvalLimit === 30 && pol.text === W.policy.text && pol.comp.buckets.length === W.policy.comp.buckets.length, 'Save policy writes settings/chatPolicy');
  await page.click('#staffAdd'); const sr = page.locator('#staffRows .srow').last();
  await sr.locator('[data-sp]').fill('sam.ortiz@wondersco.com'); await sr.locator('[data-sn]').fill('Sam Ortiz'); await sr.locator('[data-sr]').selectOption('lead');
  await page.click('#staffSave'); await page.waitForTimeout(200);
  const staff = await page.evaluate(() => window.__data['settings/staff'].map);
  ok(staff['sam.ortiz'] && staff['sam.ortiz'].role === 'lead' && staff['dana.lowe'].role === 'ae', 'Save staff writes settings/staff');
  const del = page.locator('#brCal [data-caldel="9900999"]');
  await del.click(); await del.click(); await page.waitForTimeout(200);
  ok(!(await page.evaluate(() => window.__data['chatCalib/9900999'])) && await page.locator('#brCal .calitem').count() === 2, 'delete removes a calibration case (with confirm)');
  await page.click('#brCal [data-open="9900901"]'); await page.waitForTimeout(300);
  ok(await sel(page) === 'chat' && (await txt(page, '#cvWord')) === 'Great' && await page.evaluate(() => location.hash) === `#chat/${PW}/9900901` && (await txt(page, '#wkLabel')).startsWith('Oct 5') && await weekSubs(page) === wantSubs(PW), "a calibration case from another week opens on that week");
  ok(!errors.length, 'no console errors ' + JSON.stringify(errors));
  const dump = await page.evaluate(() => JSON.parse(JSON.stringify(window.__data)));
  await ctx.close();

  // ===== 11. routes on load, from stored data
  for (const [h, t, view] of [['#chats', 'chats', '#view-chats'], ['#brain', 'brain', '#view-brain'], ['#chat/' + SID, 'chat', '#view-chat'], [`#chat/${WEEK}/${SID}`, 'chat', '#view-chat'], [`#chat/${PW}/9900901`, 'chat', '#view-chat'], ['#chat', 'chat', '#view-chat'], ['#queue', 'queue', '#view-queue'], ['#calls', 'calls', '#view-calls'],
    ['#facts', 'facts', '#view-facts'], ['#score', 'calls', '#view-calls'], ['#results', 'results', '#view-results'], ['#data', 'data', '#view-data']]) {
    ({ page, ctx, errors } = await openPage(b, Object.entries(dump), { viewer: true }, { width: 1280, height: 900 }, more));
    await page.goto('http://qa.test/' + h); await page.waitForTimeout(300);
    let good = (['results', 'data'].includes(t) ? await page.locator(`[data-area="${t}"][aria-current="page"]`).count() === 1 && !(await page.locator('[role=tab][aria-selected="true"]').count()) : await sel(page) === t) && await page.locator(view).isVisible();
    if (h.endsWith('/' + SID)) good = good && (await txt(page, '#cvWord')).length > 0 && await page.locator('.vhead .pill', { hasText: 'Reviewed' }).count() === 1;
    if (h.endsWith('/9900901')) good = good && (await txt(page, '#cvWord')) === 'Great' && (await txt(page, '#wkLabel')).startsWith('Oct 5') && await weekSubs(page) === wantSubs(PW);
    if (h === '#chat') good = good && /No chat open/.test(await txt(page, '#view-chat'));
    ok(good && !errors.length, `${h} opens ${t}`); allErrors.push(...errors); await ctx.close() }

  // ===== 12. Stop halts a batch; access errors stop with the connector wording; other errors mark the chat and move on
  ({ page, ctx, errors } = await openPage(b, seed, { viewer: true, sampleMs: 220 }, { width: 1280, height: 900 }, more));
  await page.goto('http://qa.test/'); await page.waitForTimeout(400);
  await page.waitForFunction(() => !document.querySelector('#chatPull:disabled'), null, { timeout: 5000 });
  await page.click('#chatPull'); await page.waitForFunction(`${nIn(P('chats'))} === 11 && !document.querySelector('#chatStatus .spin')`, null, { timeout: 15000 });
  await page.click('#chatGradeAll');
  await page.waitForFunction(`${nIn(P('audits'))} > 0`, null, { timeout: 20000 });
  await page.click('#chatStop');
  await page.waitForFunction(() => !document.querySelector('#chatStop'), null, { timeout: 10000 }); await page.waitForTimeout(150);
  const p0 = await page.evaluate(() => window.__prompts.length), a0 = await count(page, P('audits')); await page.waitForTimeout(900);
  ok(a0 >= 1 && a0 < 10 && await page.evaluate(() => window.__prompts.length) === p0 && /^Stopped · \d+ graded$/.test(await txt(page, '#chatStatus')), `Stop halts the batch (${a0} of 10 graded)`);
  ok((await docs(page, P('chats'))).every(c => !c.gradeError), 'a stopped chat is not marked as an error');
  await page.evaluate(() => { window.__opts.fail = 'server_not_connected' }); const l0 = await page.evaluate(() => window.__ld.length);
  await page.click('#chatGradePicks'); await page.waitForFunction(() => !document.querySelector('#chatStop'), null, { timeout: 10000 }); await page.waitForTimeout(150);
  ok((await txt(page, '#chatStatus')) === 'Add the Lightdash connector in claude.ai Settings → Connectors, then try again.' && await page.locator('#chatStatus.err').count() === 1, 'Lightdash access error stops the batch with the connector wording');
  ok(await page.evaluate(() => window.__ld.length) - l0 === 1 && await count(page, P('audits')) === a0 && (await docs(page, P('chats'))).every(c => !c.gradeError), 'one failed query, nothing written, no chat marked');
  await page.evaluate(() => { window.__opts.fail = null; window.__opts.sampleFail = 'not_granted' });
  await page.click('#chatGradePicks'); await page.waitForFunction(() => !document.querySelector('#chatStop'), null, { timeout: 10000 }); await page.waitForTimeout(150);
  ok((await txt(page, '#chatStatus')) === "Claude can't read chats in this view." && await count(page, P('audits')) === a0, 'Claude access error stops the batch');
  await page.evaluate(() => { window.__opts.sampleFail = 'upstream_error'; window.__opts.sampleMs = 20 });
  const left = await page.evaluate(() => chGradeList('picks').length);
  await page.click('#chatGradePicks'); await page.waitForFunction(() => !document.querySelector('#chatStop'), null, { timeout: 20000 }); await page.waitForTimeout(200);
  const marked = (await docs(page, P('chats'))).filter(c => c.gradeError);
  ok(left > 1 && marked.length === left && marked.every(c => c.gradeError === "Claude didn't finish. Try again.") && (await txt(page, '#chatStatus')) === `Graded 0 chats · ${left} couldn't be graded`, `other errors mark each chat and the batch goes on (${left} marked)`);
  ok(await page.locator('.crow .pill.bad', { hasText: 'Error' }).count() === left && await page.locator('.crow .cerr').count() === left, 'marked chats show the error in the queue');
  await page.evaluate(() => { window.__opts.sampleFail = null }); pq = await nPrompts(page);
  await page.click('#chatGradePicks'); await page.waitForFunction(() => !document.querySelector('#chatStop'), null, { timeout: 20000 }); await page.waitForTimeout(200);
  ok((await docs(page, P('chats'))).every(c => !c.gradeError) && await count(page, P('audits')) === a0 + left, 'grading again clears the marks');
  cs = await caches(page, pq); ok(cs.length === 4 * left && cs.every(c => c === false), 'a chat that failed is asked fresh (cache:false)');
  ok(!errors.length, 'no console errors (batches) ' + JSON.stringify(errors));
  await ctx.close();
  ok(!allErrors.length, 'no console errors (routes) ' + JSON.stringify(allErrors));
  await b.close(); console.log(`ui chats: ${n} checks passed`);
})().catch(e => { console.error('TEST FAILED', e); process.exit(1) });
