// Chats area: Queue → Audit → Brain, on the real case (data/chats/cases/1831362.json, git-ignored) plus invented chats from tests/mock.js.
// Storage is by week (chatWeeks/<week>/{chats,audits,tx,reviews}); an invented, already-graded week before the case week covers week switching,
// case types, bot lines, request fields and the game layer's history.
// The QA ticket (top of Audit): fields, the brain's compensation check, findings with checked quotes, Agree / Not a mistake with live re-scoring,
// contests (a mark the QA lead disagrees with, and why) from a scorecard row or a finding card, and Not a mistake: both saved as lessons (chatLessons),
// deleted on withdraw, listed in Brain under What the coach learned and fed to the next grade's prompt.
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
// two invented corrections (findings the QA lead marked not a mistake) on last week's chat; the newer one must reach the prompts first
const LS_OLD = { sid: '9900901', week: PW, sa: 'Mara Quill', crit: 'tone', label: 'Reply quality', type: 'Too brief', what: 'Closed with a one-line confirmation.', note: 'Short is right for a menu fix.', by: 'u_test', at: addD(PW, 2) + 'T15:10:00.000Z' };
const LS_NEW = { sid: '9900901', week: PW, sa: 'Mara Quill', crit: 'rs', label: 'Restated the case correctly', type: 'No restatement', what: 'Did not repeat the request back.', note: 'Both prices were confirmed back in M5.', by: 'u_test', at: addD(PW, 3) + 'T09:00:00.000Z' };
const seed = [['settings/chatPolicy', W.policy], ['chatCalib/9900999', cal], ['settings/staff', { map: { 'dana.lowe': { name: 'Dana Lowe', role: 'ae' } } }],
  ['meta/roster', { agents: W.SA.map((s, i) => ({ name: s.name, logins: ['zzsa' + i] })) }], ['chatLessons/9900901_tone', LS_OLD], ['chatLessons/9900901_rs', LS_NEW]].concat(W.sideWeek(PW));
const markL = v => v === 'na' ? 'N/A' : Number(v) % 1 ? `${Math.floor(v)}–${Math.ceil(v)}` : String(v);
const vLabel = id => (B.VERDICTS.find(v => v[0] === id) || [])[2];
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
  // an older chat-1 audit (no check, no findings, no priority) still gets a ticket: fields, what happened, and no findings because every mark is full or N/A
  const tk0 = await txt(page, '#cTicket');
  ok(await page.locator('#cTicket').isVisible() && /QA ticket/i.test(tk0) && tk0.includes('Chat 9900901') && (await txt(page, '#tkWord')) === 'Great' && (await txt(page, '#tkPct')) === '100.0%' && await page.locator('#tkPrio .prio').count() === 0,
    'chat-1 audit: the ticket renders with verdict and score, no priority');
  ok(await page.locator('#cTicket .tkf').count() === 11 && tk0.includes('No order linked') && tk0.includes('None linked') && tk0.includes('MENU SETUP') && tk0.includes('The client asked for two price fixes'),
    'chat-1 ticket: 11 fields, no order, no recordings, case type, what happened');
  ok(await page.locator('#tkComp').count() === 0 && await page.locator('.tkfind').count() === 0 && (await txt(page, '#tkFinds')).includes('No findings.') && await page.locator('.vmeta').count() === 0, 'chat-1 ticket: no comp check, No findings, and the board drops the duplicate meta');
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
  ok(await page.evaluate(() => { const P = window.__prompts, g = P.filter(p => /You are Swift Coach/.test(p.input)); return P.length >= 45 && P.every(p => p.cache === undefined || (p.cache === false && /You are Swift Coach/.test(p.input))) && g.filter(p => p.cache === false).length * 2 === g.length }), 'first grades use the default sample cache; only the second grade read is fresh');
  ok(await weekSubN(page) === nSub, 'pulling and grading open no new subscriptions');
  ok(/Graded 9 chats/.test(await txt(page, '#chatStatus')) && await page.locator('.crow .pill', { hasText: 'Graded' }).count() === 9, 'queue shows Graded pills and the summary');
  const realA = await page.evaluate(p => window.__data[p], P('audits/' + SID));
  const RV = vLabel(realA.verdict), RP = fmt(realA.pct);
  ok(realA.v === 'chat-2' && realA.pct === B.chatScore(realA.grade.scores) && realA.verdict === B.chatVerdict(realA.pct).id && realA.orders[0].ticket === '65', `real case graded ${RV} ${RP}% on ticket 65`);
  ok(realA.check && realA.check.applies && realA.check.status === 'wrong' && realA.check.due.amount === 16.42 && realA.check.given.amount === 17.73 && realA.check.diff === 1.31 && realA.check.errors.some(e => e.code === 'tax')
    && realA.grade.amtBy === 'system' && realA.grade.scores.amt === 1 && realA.priority === 'P1', 'the brain checked the comp: due $16.42, gave $17.73, taxes included; amt set by the check; ticket P1');
  ok(W.chat.gradeSrc !== 't1' || (realA.grade.runs && JSON.stringify(realA.grade.runs[0]) !== JSON.stringify(realA.grade.runs[1])), 'the two grade reads come from grade and grade2');
  // the corrections reach the prompts, newest first
  const gp = await page.evaluate(s => window.__prompts.filter(p => /You are Swift Coach/.test(p.input) && p.input.includes(`CHAT ${s} ·`)).map(p => p.input), SID);
  const corr = gp.length ? gp[0].slice(gp[0].indexOf("QA LEAD'S CORRECTIONS")) : '';
  ok(gp.length === 2 && corr.includes(LS_NEW.note) && corr.includes(LS_OLD.note) && corr.indexOf(LS_NEW.note) < corr.indexOf(LS_OLD.note), "seeded corrections reach the grade prompt under QA LEAD'S CORRECTIONS, newest first");
  ok(await page.evaluate(s => window.__prompts.some(p => /You are the analyst for a QA lead/.test(p.input) && p.input.includes(`CHAT ${s} ·`) && p.input.includes("QA LEAD'S CORRECTIONS")), SID), 'and the analysis prompt');
  // queue: graded rows carry the ticket priority and the comp chip; the SA card counts comp right
  const realRow = page.locator(`.crow[data-open="${SID}"]`);
  ok((await realRow.locator('.prio').innerText()) === 'P1' && (await realRow.locator('.compchip').innerText()) === 'Comp ✗', 'the real case row: P1 and Comp ✗');
  ok(await page.locator('.crow .compchip').count() === 9 && await page.locator('.crow .compchip', { hasText: 'Comp ✓' }).count() === 8 && await page.locator('.crow .prio').count() >= 6, 'graded rows: 9 comp chips (8 ✓ nothing due), priority badges');
  ok((await page.locator('.sacard', { hasText: SA0 }).innerText()).replace(/\s+/g, ' ').includes('Comp right 0 of 1') && await page.locator('.sacard .sacomp').count() === 1, `${first}'s card: Comp right 0 of 1; no line where no check counts`);
  ok(await page.locator('.crow .cflags').count() === 9 && await page.locator('.crow:not(:has(.pill.solid)):not(:has(.cflags)) .pill', { hasText: 'Graded' }).count() === 0, 'every graded row has its flags');
  // first reply: the times (timing.firstReplyMin), red when slow, WIRA's own figure when it's off by a minute or more; the SA card's average
  const slowRow = page.locator('.crow[data-open="9900106"] .cfr'), wiraRow = page.locator('.crow[data-open="9900104"]');
  ok((await slowRow.innerText()) === 'Reply 24 min' && await slowRow.evaluate(e => e.classList.contains('t-bad') && getComputedStyle(e).color === getComputedStyle(document.querySelector('.t-bad')).color && getComputedStyle(e).color !== getComputedStyle(e.parentElement).color), 'a slow first reply (24 min) shows in red in the queue');
  ok((await wiraRow.locator('.cfr').innerText()) === 'Reply 9 min' && (await wiraRow.locator('.wsays').innerText()) === 'WIRA 2.1 min' && await page.locator(`.crow[data-open="${SID}"] .wsays`).count() === 0, "the queue shows WIRA's figure only where it differs by 1 min or more");
  ok((await page.locator(`.crow[data-open="${SID}"] .cfr`).innerText()) === 'Reply 2.3 min' && await page.locator(`.crow[data-open="${SID}"] .cfr.t-bad`).count() === 0, 'the real case: Reply 2.3 min, not slow');
  const mara = (await page.locator('.sacard', { hasText: 'Mara Quill' }).innerText()).replace(/\s+/g, ' ');
  ok(/Avg first reply \d+(\.\d)? min/.test(mara) && (await page.locator('.sacard', { hasText: SA0 }).locator('.safr').innerText()).includes('Avg first reply'), `SA cards add Avg first reply (${mara.match(/Avg first reply [^ ]+ min/)[0]})`);
  await shot(page, 'chats-queue.png'); await shot(page, 'queue-ticket.png');
  for (const wd of [1100, 900]) { await page.setViewportSize({ width: wd, height: 900 }); await page.waitForTimeout(120);
    ok(await width(page) <= wd && await page.evaluate(() => [...document.querySelectorAll('.crow .cmain')].every(m => m.getBoundingClientRect().width >= 160)), `${wd}px queue: rows keep room for the chat, no overflow`) }
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(100);

  // ===== 4. the real case in Audit
  await page.click(`.crow[data-open="${SID}"] .clink`); await page.waitForTimeout(300);
  ok(await sel(page) === 'chat' && await page.evaluate(() => location.hash) === `#chat/${WEEK}/${SID}`, 'row opens Audit at #chat/<week>/<sid>');
  ok((await txt(page, '#cvWord')) === RV && (await txt(page, '#cvPct')) === RP + '%', `verdict card: ${RV} ${RP}%`);
  await shot(page, 'chats-audit-top.png'); await shot(page, 'chats-audit-full.png', true);
  await shot(page, 'ticket-top.png'); await shot(page, 'ticket-full.png', true);
  ok(await page.locator('#cvRoute .rm').count() === 4 && (await txt(page, '#cvEsc')) === 'Level ' + markL(realA.grade.scores.esc), `route marks with escalation Level ${markL(realA.grade.scores.esc)}`);
  ok((await txt(page, '#cvCase')).includes('COMPENSATION') && (await page.locator('#cs-an .adl dt').allInnerTexts()).map(t => t.toLowerCase()).includes('policy') && await page.locator('#cs-an .aline').count() === 0, 'a compensation case keeps Policy and Compensation in Analysis');
  const ord = await txt(page, '.ordcard');
  ok(/Ticket 65/.test(ord) && ord.includes('$54.72') && ord.includes('$4.38') && ord.includes('$59.10'), 'money card: ticket 65, items $54.72, tax $4.38, total $59.10');
  ok((await txt(page, '.cline.right')) === 'Due: 30% × $54.72 items = $16.42', 'Analysis comp line: Due: 30% × $54.72 items = $16.42');
  ok((await txt(page, '.cline.off')) === `${first} gave $17.73: 30% × $59.10 (items $54.72 + tax $4.38) = $17.73`, "Analysis gave line follows the brain's check");

  // ===== 4b. the QA ticket: on top, fields, comp check, findings
  ok(await page.evaluate(() => { const t = document.getElementById('cTicket'), c = document.getElementById('cs-chat'); return !!t && !!c && !!(t.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) && t.getBoundingClientRect().bottom <= c.getBoundingClientRect().top }), 'the ticket sits above the chat');
  const hd = (await txt(page, '#cTicket .tkhd')).replace(/\s+/g, ' ');
  ok(/QA ticket/i.test(hd) && hd.includes('Chat ' + SID) && (await txt(page, '#tkWord')) === RV && (await txt(page, '#tkPct')) === RP + '%' && (await page.locator('#tkPrio .prio.p1').innerText()) === 'P1' && await page.locator('#cTicket.p1').count() === 1, `header: QA ticket · Chat ${SID}, ${RV} ${RP}%, P1`);
  const tdts = await page.locator('#cTicket .tkf dt').allInnerTexts();
  ok(JSON.stringify(tdts.map(t => t.trim().toLowerCase())) === JSON.stringify(['restaurant', 'sa', 'chat', 'order', 'case type', 'fault', 'opened', 'first reply', 'closed', 'started by', 'recordings']), 'field grid: Restaurant, SA, Chat, Order, Case type, Fault, Opened, First reply, Closed, Started by, Recordings');
  const fv = async k => (await page.locator('#cTicket .tkf', { has: page.locator('dt', { hasText: new RegExp('^' + k + '$', 'i') }) }).locator('dd').innerText()).replace(/\s+/g, ' ').trim();
  ok((await fv('Restaurant')).includes(W.code) && (await fv('SA')) === SA0 && (await fv('First reply')) === '2.3 min' && (await fv('Started by')) === 'Client' && /^Not closed · Blocked/.test(await fv('Closed')) && (await fv('Case type')) === 'COMPENSATION' && /Shared/.test(await fv('Fault')), 'fields: restaurant code, SA, first reply, started by, closed, case type, fault');
  // the Timing block: the times, the status strip (sized by minutes, "now" on the ongoing one), totals, and the one note
  ok(realA.timing && realA.timing.states.length === 2 && realA.timing.firstReplyMin === 2.3, "the audit carries timing with the case's two status changes (wira_tasks_state)");
  const tm = await page.evaluate(() => { const words = x => [...x.children].map(c => c.textContent.trim()).filter(Boolean).join(' '), T = document.getElementById('tkTiming'), cell = k => [...T.querySelectorAll('.tmc')].find(c => c.querySelector('dt').textContent === k).querySelector('dd').textContent.replace(/\s+/g, ' ').trim();
    return { fr: cell('First reply'), closed: cell('Closed'), handle: cell('Handle time'), slow: !!T.querySelector('.slowb'), segs: [...T.querySelectorAll('.tmseg')].map(x => x.className), legend: [...T.querySelectorAll('.tmst')].map(words),
      tot: [...T.querySelectorAll('.tmtc')].map(words), note: T.querySelector('.tmnote').textContent, grow: [...T.querySelectorAll('.tmseg')].map(x => x.getBoundingClientRect().width) } });
  ok(/2\.3 min$/.test(tm.fr) && !tm.slow && tm.closed === 'Open' && tm.handle === 'Still open', `timing: first reply ${tm.fr}, not slow, Open, still open`);
  ok(tm.segs.length === 2 && /on-support/.test(tm.segs[0]) && !/now/.test(tm.segs[0]) && /on-client/.test(tm.segs[1]) && /\bnow\b/.test(tm.segs[1]) && /^Support's turn 2\.3 min/.test(tm.legend[0]) && /^Waiting on client now/.test(tm.legend[1]), `status strip: ${tm.legend.join(' → ')}`);
  ok(tm.tot[0] === "On Support's side 2.3 min" && tm.tot[1] === "On the client's side –" && tm.tot[2] === 'In handoff –', 'totals: Support 2.3 min, client –, handoff –');
  ok(tm.note === "WIRA doesn't record a time for each message, so only the first reply can be timed." && await page.locator('#cTicket .tmnote').count() === 1, 'the note says why only the first reply is timed');
  const tmx = await page.evaluate(() => { const d = document.createElement('div'), c = { sid: '1', at: '2026-10-12T10:00:00', frt: 2.1 };
    d.innerHTML = chTimingHtml(c, { timing: { opened: c.at, firstClientAt: c.at, firstReplyAt: '2026-10-12T10:22:00', firstReplyMin: 22, wiraFirstReplyMin: 2.1, slowFirstReply: true, closedAt: '2026-10-12T12:40:00', handleMin: 160,
      states: [{ at: c.at, on: 'support', min: 22 }, { at: '2026-10-12T10:22:00', on: 'handoff', min: 60 }, { at: '2026-10-12T11:22:00', on: 'client', min: 78 }, { at: '2026-10-12T12:40:00', on: 'closed', min: null }], waitingOnSupportMin: 22, waitingOnClientMin: 78, waitingOnHandoffMin: 60 } });
    const old = document.createElement('div'); old.innerHTML = chTkFields({ sid: '2', frt: 4, at: c.at }, { sid: '2' }) + chTimingHtml({ sid: '2', frt: 4 }, { sid: '2' });
    return { slow: [...d.querySelectorAll('.slowb')].map(x => x.textContent), red: !!d.querySelector('.tmfr .frm.t-bad'), wira: d.querySelector('.wsays').textContent, handle: d.textContent.includes('2 h 40 min'), closed: d.textContent.includes('12:40 PM'),
      legend: [...d.querySelectorAll('.tmst')].map(x => [...x.children].map(c => c.textContent.trim()).filter(Boolean).join(' ')), oldFr: [...old.querySelectorAll('.tkf')].find(x => x.querySelector('dt').textContent === 'First reply').querySelector('dd').textContent, oldTiming: !!old.querySelector('#tkTiming') } });
  ok(tmx.slow.includes('Slow first reply') && tmx.slow.includes('Slow') && tmx.red && tmx.handle && tmx.closed, 'a slow chat: Slow badge, red minutes, closed time and handle time 2 h 40 min');
  ok(tmx.wira === 'WIRA says 2.1 min', 'the WIRA mismatch hint shows when the two first-reply values differ (22 vs 2.1)');
  ok(tmx.legend.length === 4 && /^Handoff 1 h/.test(tmx.legend[1]) && /^Closed/.test(tmx.legend[3]), `status labels: ${tmx.legend.join(' → ')}`);
  ok(tmx.oldFr === '4 min' && !tmx.oldTiming, 'an older audit without timing: first reply from frt, no Timing block');
  // full width: What happened and the Analysis rows fill their cards at 1280, 1100 and 900
  const fill = () => page.evaluate(() => { const inner = e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return [r.left + parseFloat(s.paddingLeft), r.right - parseFloat(s.paddingRight)] };
    const span = (els, box) => { const [l, r] = inner(box), R = [...els].map(e => e.getBoundingClientRect()); return (Math.max(...R.map(x => x.right)) - Math.min(...R.map(x => x.left))) / (r - l) };
    const wh = document.querySelector('#tkWhat .tkwh'), body = document.querySelector('#cTicket .tkbody'), an = document.querySelector('#cs-an .qbody');
    const rows = [...document.querySelectorAll('#cs-an .arow')], lefts = new Set(rows.map(x => Math.round(x.getBoundingClientRect().left)));
    return { what: span(wh.children, body), timing: span([document.getElementById('tkTiming')], body), comp: span([document.getElementById('tkComp')], body), an: span(rows, an), anHalf: span(rows.filter(x => !x.classList.contains('wide')), an), cols: lefts.size,
      side: !!wh.querySelector('.tkside') } });
  for (const wd of [1280, 1100, 900]) { await page.setViewportSize({ width: wd, height: 900 }); await page.waitForTimeout(150); const f = await fill();
    ok(f.what >= 0.9 && f.timing >= 0.9 && f.comp >= 0.9 && f.an >= 0.9 && f.anHalf >= 0.9 && f.cols === 2 && await width(page) <= wd,
      `${wd}px: What happened ${Math.round(f.what * 100)}%, Timing ${Math.round(f.timing * 100)}%, comp ${Math.round(f.comp * 100)}%, Analysis rows ${Math.round(f.an * 100)}% (${f.cols} columns) of the card`) }
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(150);
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; document.getElementById('tkWhat').scrollIntoView({ block: 'start' }) }); await page.waitForTimeout(80);
  { const a = await page.locator('#tkWhat').boundingBox(), b = await page.locator('#tkTiming').boundingBox(); await page.screenshot({ path: path.join(SH, 'ticket-timing.png'), clip: { x: a.x - 18, y: a.y - 12, width: a.width + 36, height: b.y + b.height - a.y + 24 } }) }
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.locator('#cs-an').screenshot({ path: path.join(SH, 'analysis-wide.png') });
  const wira = page.locator('#cTicket .tkf a', { hasText: 'WIRA ' + SID }), gdo = page.locator('#cTicket .tkf a', { hasText: 'Ticket 65' }), o1 = realA.orders[0];
  ok(await wira.getAttribute('href') === W.fx.chatRow.wira_project_tasks_wira_ticket_url && await wira.getAttribute('target') === '_blank', 'Chat: the WIRA link, new tab');
  ok((await gdo.getAttribute('href')) === `https://greendot.prod.letsdowonders.io/greendot/restaurant/${encodeURIComponent(W.code)}?orderId=${encodeURIComponent(o1.id)}` && (await gdo.getAttribute('href')).includes(encodeURIComponent(o1.id)) && (await fv('Order')).includes('$59.10'), 'Order: GreenDot order link with the order id, and the total');
  const recs = page.locator('#cTicket .tkf a', { hasText: /^Rec/ });
  ok(await recs.count() === realA.calls.length && (await recs.first().getAttribute('href')).includes('/callrecordings?callIds=' + encodeURIComponent(realA.calls[0].id)), `Recordings: ${realA.calls.length} Rec links`);
  ok(await page.evaluate(() => [...document.querySelectorAll('#cTicket a[href^="http"]')].every(a => a.target === '_blank' && /noopener/.test(a.rel))), 'every ticket link opens in a new tab');
  const comp = (await txt(page, '#tkComp')).replace(/\s+/g, ' ');
  ok(comp.includes('Due') && comp.includes('$16.42') && comp.includes(`${first} gave`) && comp.includes('$17.73') && comp.includes('Taxes included') && comp.includes('Over by $1.31') && /Wrong/.test(await txt(page, '#tkComp .tkst')), `comp check: Due $16.42, ${first} gave $17.73, Taxes included, Over by $1.31, Wrong`);
  ok((await txt(page, '#tkComp del')).includes('tax $4.38') && (await txt(page, '#tkComp .rwhere')) === 'CHAT' && comp.includes(W.policy.comp.buckets.find(b => b.id === 'made_twice_one_paid').label), "comp check: the tax in the SA's base is struck; where it's written; the policy row");
  const pr = await page.locator('.tkfind .tkfh .prio').allInnerTexts();
  ok(pr.length === realA.grade.findings.length && pr[0] === 'P1' && pr.every((p, i) => !i || p >= pr[i - 1]), `findings sorted P1 first (${pr.join(' ')})`);
  ok((await txt(page, '#tf-amt .tkfs')).includes('set by the comp check') && (await txt(page, '#tf-amt .tkfs')).includes('1/3') && (await txt(page, '#tf-amt .tktype')).includes('Taxes included'), 'the amount finding: 1/3, set by the comp check, typed by the check');
  ok(await page.locator('.tkfind .tkq .qok').count() >= 3 && await page.locator('.tkfind').first().locator('.tkfix h5').innerText().then(t => t.toLowerCase() === `what ${first.toLowerCase()} should have done`), 'verified quotes show ✓; What <SA> should have done');
  ok(await page.locator('.tkfind details.tkmodel').count() >= 1 && await page.locator('.tkfind details.tkmodel[open]').count() === 0, 'model messages are folded');
  const mchip = page.locator('.tkfind .srcchip[data-jump^="cm-"]').first(), mid = (await mchip.getAttribute('data-jump'));
  await mchip.click(); await page.waitForTimeout(700);
  ok(await page.evaluate(id => { const el = document.getElementById(id), r = el.getBoundingClientRect(); return el.classList.contains('flash') && r.top >= 0 && r.bottom <= innerHeight && !!el.closest('#cs-chat') }, mid) && await page.evaluate(() => location.hash) === `#chat/${WEEK}/${SID}`, `an M# chip scrolls to ${mid.replace('cm-', 'M')} in the chat and highlights it`);
  const tchip = page.locator('.tkfind .srcchip[data-jump^="cx-task-"]').first();
  if (await tchip.count()) { await tchip.click(); await page.waitForTimeout(700); ok(await page.evaluate(id => document.getElementById(id).classList.contains('flash'), await tchip.getAttribute('data-jump')), 'a Task chip scrolls to the task card in Context') }
  ok(await page.evaluate(t => { const d = document.createElement('div'); d.innerHTML = chSrcChip('Call 2') + chSrcChip('O1') + chSrcChip('Task ' + t);
    return [...d.querySelectorAll('a')].map(a => a.dataset.jump).every(id => !!document.getElementById(id)) }, realA.tasks[0].sid), 'Call, O# and Task chips point at the call card, the order card and the task card in Context');
  // every compensation status gets its badge (invented checks)
  const stl = await page.evaluate(() => ['right', 'minor', 'held', 'none_due', 'not_recorded', 'missing', 'not_due', 'unknown'].map(s => { const d = document.createElement('div');
    d.innerHTML = chCompHtml({ sid: '1', sa: 'Ana Ruiz' }, { sa: 'Ana Ruiz', analysis: {}, check: { applies: true, status: s, due: { label: 'Test row', pct: 30, formula: '30% × $10.00 items = $3.00', amount: 3, needsApproval: s === 'held', limit: 25 },
      given: { amount: s === 'minor' ? 3.5 : s === 'right' ? 3 : null, given: !['missing', 'held', 'none_due'].includes(s), where: 'note' }, errors: s === 'minor' ? [{ code: 'rounding', label: 'Rounded', detail: '$3.50 instead of the exact $3.00.' }] : [],
      flags: [], computed: s === 'right' ? '30% × $10.00 items = $3.00' : '', diff: s === 'minor' ? 0.5 : s === 'right' ? 0 : null, summary: 'Summary ' + s } });
    return [d.querySelector('.tkst').textContent, d.textContent.includes('Exact to the cent'), d.textContent.includes('Summary ' + s), !!d.querySelector('.rappr')] }));
  ok(JSON.stringify(stl.map(x => x[0])) === JSON.stringify(['Right', 'Rounded', 'Held for approval', 'Nothing due', 'Not recorded', 'Not offered', 'Not due', "Can't check"]) && stl[0][1] && !stl[1][1] && stl[2][2] && stl[2][3] && stl[7][2],
    'comp badges: Right (exact to the cent), Rounded, Held for approval (with the approval line), Nothing due, Not recorded, Not offered, Not due, Can\'t check');
  await page.click('#tkCopy'); await page.waitForTimeout(150);
  ok(/Ticket copied|Couldn't copy/.test(await txt(page, '#toast')), 'Copy ticket gives feedback');
  const plain = await page.evaluate(s => chTicketText(chatBy(s), chatAud[s], chatDraft(s)), SID);
  ok(plain.startsWith(`QA ticket · Chat ${SID} · ${RV} ${RP}% · P1`) && plain.includes('Order: Ticket 65 ($59.10) https://greendot') && plain.includes('Compensation check: Wrong') && plain.includes('- Taxes included:') && plain.includes('- Offered on a shared fault without approval:')
    && /\n1\. P1 · Approval · Offered on a shared fault without approval\n/.test(plain) && /\n2\. P1 · Resolution accuracy · Taxes included · 1\/3\n   What happened: Tax \(\$4\.38\) was in the base\./.test(plain) && plain.includes(`What ${first} should have done:`) && !/<[a-z]/i.test(plain),
    'the copied ticket is clean plain text: fields, comp check (error and flag), findings with should-have-done');
  ok(/\nFirst reply: 2\.3 min\n/.test(plain) && /\nTiming\nOpened: Oct 12 · 7:48 PM\nFirst client message: 7:48 PM\nFirst reply: 7:50 PM · 2\.3 min\nClosed: Open\nHandle time: Still open\nStatus: Support's turn 2\.3 min → Waiting on client \(now\)\nSupport's side 2\.3 min · Client's side – · Handoff –\nWIRA doesn't record a time for each message, so only the first reply can be timed\.\n/.test(plain),
    'the copied ticket carries the timing lines');
  // phone and dark: the ticket stays first, fields stack, nothing overflows
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(120); await shot(page, 'ticket-dark.png');
  ok(await page.evaluate(() => getComputedStyle(document.body).backgroundColor) !== 'rgb(253, 248, 244)' && await page.evaluate(() => getComputedStyle(document.querySelector('#cTicket .tkhd')).backgroundColor) !== 'rgb(244, 239, 234)', 'dark: the ticket takes the dark tokens');
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
  ok(await width(page) <= 390, `390px dark ticket: no horizontal overflow (${await width(page)})`);
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(100);
  ok(await width(page) <= 390 && await page.evaluate(() => { const t = document.getElementById('cTicket').getBoundingClientRect(), b = document.getElementById('chatBoard').getBoundingClientRect(); return t.bottom <= b.top && t.right <= 390 }), `390px light ticket: first on the page, no overflow (${await width(page)})`);
  ok(await page.evaluate(() => { const f = [...document.querySelectorAll('#cTicket .tkf')].map(x => x.getBoundingClientRect().left); return f.every(l => Math.abs(l - f[0]) < 1) }), '390px: the field grid stacks in one column');
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.locator('#cTicket').screenshot({ path: path.join(SH, 'ticket-390.png') });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(120);
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
  const note0 = await page.locator('#coachText').inputValue();
  ok(note0.startsWith(`Chat ${SID} · `) && note0.includes(`— ${RV} (${RP}%)`), 'coaching note starts with the chat line and the verdict');
  const items = note0.slice(note0.indexOf('\nNext time\n')).split('\n').filter(l => /^\d+\. /.test(l));
  ok(items.length === realA.grade.findings.length && items[0].startsWith('1. P1 · Approval') && items[1].startsWith('2. P1 · Resolution accuracy') && note0.includes(`Do: ${realA.grade.findings[0].should}`) && note0.includes('Why it matters: '), "coaching uses the ticket's findings, P1 first: what happened, why, do, model");
  // cite links jump without touching the route
  await page.locator('#cs-an .cite').first().click(); await page.waitForTimeout(200);
  ok(await page.evaluate(() => location.hash) === `#chat/${WEEK}/${SID}`, 'cites scroll to the fact and keep the route');

  // ===== 5. contest from the scorecard: a different mark opens the contest box; the reason is required; saving re-scores live and marks the row
  const marks = Object.assign({}, realA.grade.scores, { amt: 3 });
  const want = await page.evaluate(s => { const p = chatScore(s); return { p: fmt(p), v: chatVerdict(p).label } }, marks);
  ok(await page.locator('.ccrit [data-contest][data-where="row"]').count() === 9 && await page.locator('.tkfind [data-contest]').count() === realA.grade.findings.filter(f => B.CHAT_RUBRIC.some(r => r.id === f.id)).length && await page.locator('#tf-approval [data-contest]').count() === 0,
    'every scorecard row and every finding with a criterion has a Contest button');
  await page.click('[data-cm="amt"][data-v="3"]'); await page.waitForTimeout(100);
  const cbx = page.locator('#cc-amt #cbox');
  ok(await cbx.isVisible() && (await txt(page, '#cbox .cbclaude')) === '1/3' && (await txt(page, '#cbox .cbwhy')).includes(realA.grade.reasons.amt.slice(0, 40)) && await page.locator('#cbox [data-cv="3"][aria-pressed="true"]').count() === 1 && await page.locator('#cbox [data-cv="na"]').count() === (B.CHAT_RUBRIC.find(r => r.id === 'amt').na ? 1 : 0) && await page.locator('#cbox [data-cv]').count() === 4 + (B.CHAT_RUBRIC.find(r => r.id === 'amt').na ? 1 : 0),
    "a different mark opens the contest box: Claude's mark and reason, your mark picked, N/A only where allowed");
  ok(await page.locator('#cbSave').isDisabled() && (await txt(page, '#cvPct')) === RP + '%' && await page.locator('[data-cm="amt"][data-v="1"][aria-pressed="true"]').count() === 1 && await page.evaluate(() => document.activeElement && document.activeElement.id === 'cbWhy'), 'Save is disabled until there is a reason; the mark and score wait; focus goes to Why');
  await page.fill('#cbWhy', '   '); ok(await page.locator('#cbSave').isDisabled(), 'blank space is not a reason');
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; document.getElementById('cc-amt').scrollIntoView({ block: 'center' }) });
  const WHY = 'The lead approved $17.73 in the thread before the client was told, so the amount stands.';
  await page.fill('#cbWhy', WHY); ok(await page.locator('#cbSave').isEnabled(), 'typing a reason arms Save contest');
  await page.waitForTimeout(80); await page.screenshot({ path: path.join(SH, 'contest-box.png') });
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(120);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('cbox')).backgroundColor) !== 'rgb(255, 255, 255)', 'dark: the contest box takes the dark tokens');
  await page.screenshot({ path: path.join(SH, 'contest-box-dark.png') }); await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
  await page.evaluate(() => document.getElementById('cbox').scrollIntoView({ block: 'center' })); await page.waitForTimeout(80);
  ok(await width(page) <= 390 && await page.evaluate(() => document.getElementById('cbox').getBoundingClientRect().right <= 390), `390px contest box: no horizontal overflow (${await width(page)})`);
  await page.screenshot({ path: path.join(SH, 'contest-390.png') });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(120);
  await page.click('#cbSave'); await page.waitForTimeout(100);
  ok((await txt(page, '#cvPct')) === want.p + '%' && (await txt(page, '#cvWord')) === want.v && (await txt(page, '#csScoreAns')) === `${want.v} · ${want.p}%` && await page.locator('#cbox').count() === 0, `Save contest re-scores live: ${want.v} ${want.p}%`);
  ok(await page.locator('#cc-amt.contested').count() === 1 && (await txt(page, '#cc-amt .ccon')) === 'CONTESTED' && (await txt(page, '#cc-amt .cfrom s')) === '1/3' && (await txt(page, '#cc-amt .cfrom b')) === '3/3' && (await txt(page, '#cc-amt .cyour')).includes(WHY) && await page.locator('[data-cm="amt"][data-v="3"][aria-pressed="true"]').count() === 1,
    "the row: Contested, Claude's 1/3 struck, 3/3, the reason underneath");
  ok((await page.locator('#coachText').inputValue()).includes(`— ${want.v} (${want.p}%)`) && !/\d\. P1 · Resolution accuracy/.test(await page.locator('#coachText').inputValue()), 'coaching note follows the marks; contested to full marks, the finding leaves it');
  ok((await txt(page, '#tkPct')) === want.p + '%' && (await txt(page, '#tkWord')) === want.v && (await txt(page, '#tf-amt .tkfs s')) === '1/3' && (await txt(page, '#tf-amt .tkscore')) === '3/3' && (await txt(page, '#tf-amt .tkcon')) === 'CONTESTED' && (await txt(page, '#tf-amt .tkyour')).includes(WHY), "the ticket follows: score, verdict, the finding's mark struck and contested, the reason");
  // Cancel leaves everything as it was
  const crit2 = B.CHAT_RUBRIC.find(r => r.id !== 'amt' && Number.isInteger(realA.grade.scores[r.id]) && realA.grade.scores[r.id] < r.max);
  await page.click(`[data-cm="${crit2.id}"][data-v="${crit2.max}"]`); await page.waitForTimeout(80);
  ok(await page.locator(`#cc-${crit2.id} #cbox`).isVisible(), `clicking a different mark on ${crit2.label} opens its box`);
  await page.click('#cbCancel'); await page.waitForTimeout(80);
  ok(await page.locator('#cbox').count() === 0 && await page.locator(`[data-cm="${crit2.id}"][data-v="${realA.grade.scores[crit2.id]}"][aria-pressed="true"]`).count() === 1 && (await txt(page, '#cvPct')) === want.p + '%', 'Cancel leaves the mark and the score alone');

  // ===== 5b. Not a mistake: full marks on that criterion, the % and verdict recomputed live, a note box; Agree just marks
  const NF = realA.grade.findings.find(f => f.id !== 'amt' && f.id !== 'approval' && typeof f.score === 'number'), NR = B.CHAT_RUBRIC.find(r => r.id === NF.id);
  const marks2 = Object.assign({}, marks, { [NF.id]: NR.max }), want2 = await page.evaluate(s => { const p = chatScore(s); return { p: fmt(p), v: chatVerdict(p).label } }, marks2);
  await page.click(`#tf-${NF.id} [data-fmark="not"]`); await page.waitForTimeout(100);
  ok(await page.locator(`#tf-${NF.id}.not`).count() === 1 && await page.locator(`#tf-${NF.id} [data-fmark="not"][aria-pressed="true"]`).count() === 1 && (await txt(page, `#tf-${NF.id} .tknot`)) === 'NOT A MISTAKE', `Not a mistake greys out ${NF.label}`);
  ok(await page.locator(`[data-cm="${NF.id}"][data-v="${NR.max}"][aria-pressed="true"]`).count() === 1 && (await txt(page, `#tf-${NF.id} .tkscore`)) === `${NR.max}/${NR.max}` && await page.locator(`#was-${NF.id}`).isVisible(), `${NF.label} restored to full marks (${NR.max}/${NR.max}) on the scorecard`);
  ok((await txt(page, '#cvPct')) === want2.p + '%' && (await txt(page, '#tkPct')) === want2.p + '%' && (await txt(page, '#cvWord')) === want2.v && (await txt(page, '#csScoreAns')) === `${want2.v} · ${want2.p}%`, `% and verdict recomputed live: ${want2.v} ${want2.p}%`);
  ok(!(await page.locator('#coachText').inputValue()).includes(`P${NF.priority.slice(1)} · ${NF.label}`) && await page.locator(`#tkn-${NF.id}`).isVisible() && (await txt(page, `label[for="tkn-${NF.id}"]`)).toLowerCase() === "why it wasn't a mistake", 'the finding leaves the coaching note; a note box opens');
  const NOTE = 'The lead had already cleared this reply wording.';
  await page.fill(`#tkn-${NF.id}`, NOTE);
  const fa = realA.grade.findings.find(f => f.id !== 'amt' && f.id !== NF.id);
  await page.click(`#tf-${fa.id} [data-fmark="agree"]`); await page.waitForTimeout(100);
  ok(await page.locator(`#tf-${fa.id} [data-fmark="agree"][aria-pressed="true"]`).count() === 1 && await page.locator(`#tf-${fa.id}.not`).count() === 0 && (await page.locator(`#tkn-${NF.id}`).inputValue()) === NOTE && (await txt(page, '#tkPct')) === want2.p + '%', 'Agree just marks it; the note survives the repaint');
  // marking the P1 finding drops the ticket to its next priority; un-marking puts the mark back
  await page.click('#tf-amt [data-fmark="not"]'); await page.waitForTimeout(100);
  const nextP = realA.grade.findings.filter(f => f.id !== 'amt' && f.id !== NF.id).map(f => f.priority).sort()[0];
  ok((await txt(page, '#tkPrio')) === nextP && await page.locator(`#cTicket.${nextP.toLowerCase()}`).count() === 1, `all P1s marked not a mistake: the ticket drops to ${nextP}`);
  await page.click('#tf-amt [data-fmark="not"]'); await page.waitForTimeout(100);
  ok((await txt(page, '#tkPrio')) === 'P1' && (await txt(page, '#tf-amt .tkscore')) === '3/3' && (await txt(page, '#tkPct')) === want2.p + '%' && await page.locator('#tkn-amt').count() === 0 && await page.locator('#cc-amt.contested').count() === 1, 'un-marking puts the contest back (3/3) with its reason');
  // ----- 5c. contest from a finding card: pick a mark, give a reason, save
  const CF = realA.grade.findings.find(f => { const r = B.CHAT_RUBRIC.find(x => x.id === f.id); return r && !['amt', NF.id, fa.id].includes(f.id) && Number.isInteger(f.score) && f.score <= r.max - 2 }), CR = B.CHAT_RUBRIC.find(r => r.id === CF.id), CTO = CF.score + 1;
  await page.click(`#tf-${CF.id} [data-contest]`); await page.waitForTimeout(100);
  ok(await page.locator(`#tf-${CF.id} #cbox`).isVisible() && await page.locator('#cbox [data-cv][aria-pressed="true"]').count() === 0 && await page.locator('#cbSave').isDisabled() && (await page.locator(`#tf-${CF.id} [data-contest]`).getAttribute('aria-expanded')) === 'true', `Contest on the ${CF.label} finding opens the box in the card, no mark picked`);
  await page.click(`#cbox [data-cv="${CTO}"]`);
  ok(await page.locator('#cbSave').isDisabled() && await page.locator(`#cbox [data-cv="${CTO}"][aria-pressed="true"]`).count() === 1, 'a mark alone does not arm Save');
  const WHY2 = 'The client asked for the steps and got them in M9.';
  await page.fill('#cbWhy', WHY2); await page.click('#cbSave'); await page.waitForTimeout(100);
  const marks3 = Object.assign({}, marks2, { [CF.id]: CTO }), want3 = await page.evaluate(s => { const p = chatScore(s); return { p: fmt(p), v: chatVerdict(p).label } }, marks3);
  ok((await txt(page, `#tf-${CF.id} .tkscore`)) === `${CTO}/${CR.max}` && (await txt(page, `#tf-${CF.id} .tkfs s`)) === `${CF.score}/${CR.max}` && (await txt(page, `#tf-${CF.id} .tkyour`)).includes(WHY2) && await page.locator(`#cc-${CF.id}.contested`).count() === 1 && (await txt(page, '#tkPct')) === want3.p + '%' && (await txt(page, '#cvPct')) === want3.p + '%',
    `saved from the card: ${CF.label} ${CF.score}/${CR.max} → ${CTO}/${CR.max}, the row contested, ${want3.p}%`);
  ok(/\d\. P\d · /.test(await page.locator('#coachText').inputValue()) && (await page.locator('#coachText').inputValue()).includes(CF.label), 'a contest below full marks keeps the finding in the coaching note');
  const plain2 = await page.evaluate(s => chTicketText(chatBy(s), chatAud[s], chatDraft(s)), SID);
  ok(plain2.includes(`Resolution accuracy · Taxes included · 3/3 · Contested (coach 1/3)`) && plain2.includes(`   Why contested: ${WHY}`), 'the copied ticket carries the contest and its reason');
  await page.evaluate(id => { const t = document.getElementById('toast'); if (t) t.hidden = true; document.getElementById(id).scrollIntoView({ block: 'center' }) }, 'cc-amt'); await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SH, 'contest-saved.png') });
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true });
  await page.locator(`#tf-${NF.id}`).scrollIntoViewIfNeeded(); await page.evaluate(id => document.getElementById(id).scrollIntoView({ block: 'center' }), 'tf-' + NF.id); await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(SH, 'ticket-notmistake.png') });

  // ===== 6. save review: chatReviews + finding marks + a correction (chatLessons) + XP
  const xp0 = await page.evaluate(() => gameStats().xp);
  await page.fill('#chatReviewer', 'QA lead');
  await page.click('#chatSave'); await page.waitForTimeout(300);
  const rv = await page.evaluate(p => window.__data[p], P('reviews/' + SID));
  ok(rv && rv.scores.amt === 3 && rv.scores[NF.id] === NR.max && rv.scores[CF.id] === CTO && fmt(rv.pct) === want3.p && rv.verdict === B.chatVerdict(rv.pct).id && rv.week === WEEK && rv.sa === SA0 && rv.reviewer === 'QA lead' && rv.by === 'u_test' && rv.coaching.startsWith('Chat ' + SID), 'Save review writes chatReviews/<sid>');
  ok(JSON.stringify(rv.findings) === JSON.stringify({ [NF.id]: { mark: 'not', note: NOTE }, [fa.id]: { mark: 'agree', note: '' } }) || (rv.findings[NF.id].mark === 'not' && rv.findings[NF.id].note === NOTE && rv.findings[fa.id].mark === 'agree' && Object.keys(rv.findings).length === 2), 'the review stores the finding marks: {id: {mark, note}}');
  const LID = `chatLessons/${SID}_${NF.id}`, les = await page.evaluate(p => window.__data[p], LID);
  ok(les && les.sid === SID && les.week === WEEK && les.sa === SA0 && les.crit === NF.id && les.label === NF.label && les.type === NF.type && les.what === NF.what && les.note === NOTE && les.by === 'u_test' && !isNaN(Date.parse(les.at)), `Not a mistake writes ${LID}: sid, week, sa, crit, label, type, what, note, by, at`);
  ok(les.kind === 'not' && les.caseType === 'compensation', 'a Not a mistake lesson has kind "not"');
  ok(JSON.stringify(rv.contests) === JSON.stringify({ amt: { from: '1/3', to: '3/3', reason: WHY }, [CF.id]: { from: `${CF.score}/${CR.max}`, to: `${CTO}/${CR.max}`, reason: WHY2 } }), 'the review stores contests: {crit: {from, to, reason}}');
  const amtF = realA.grade.findings.find(f => f.id === 'amt'), lc = await page.evaluate(p => window.__data[p], `chatLessons/${SID}_amt`);
  ok(lc && lc.kind === 'contest' && lc.sid === SID && lc.week === WEEK && lc.sa === SA0 && lc.crit === 'amt' && lc.label === 'Resolution accuracy' && lc.caseType === 'compensation' && lc.type === amtF.type && lc.from === '1/3' && lc.to === '3/3' && lc.reason === WHY && lc.what === realA.grade.reasons.amt && lc.by === 'u_test' && !isNaN(Date.parse(lc.at)),
    `Save review writes chatLessons/${SID}_amt: kind contest, from, to, reason, caseType, type, what`);
  const lc2 = await page.evaluate(p => window.__data[p], `chatLessons/${SID}_${CF.id}`);
  ok(lc2 && lc2.kind === 'contest' && lc2.from === `${CF.score}/${CR.max}` && lc2.to === `${CTO}/${CR.max}` && lc2.reason === WHY2 && lc2.type === CF.type, `and chatLessons/${SID}_${CF.id}`);
  ok(await count(page, 'chatLessons') === 5, 'two contests and one Not a mistake: three lessons beside the two seeded');
  await page.evaluate(() => renderBrain());
  const bl = await page.evaluate(s => [...document.querySelectorAll('#brLessons .lsitem.contest')].map(x => x.textContent.replace(/\s+/g, ' ')).find(t => t.includes('Resolution accuracy') && t.includes('Chat ' + s)) || '', SID);
  ok(bl.includes('1/3') && bl.includes('3/3') && bl.includes(WHY) && bl.includes(SA0) && bl.includes('Compensation'), 'the Brain lists the contest: criterion · case type, 1/3 → 3/3, the reason, SA, chat');
  ok(await page.evaluate(s => (document.querySelector(`.crow[data-open="${s}"] .conchip`) || {}).textContent, SID) === 'Contested 2', 'the queue row shows Contested 2');
  const xp1 = await page.evaluate(() => gameStats().xp);
  ok(xp1 - xp0 === 10, `review adds 10 XP (${xp0} → ${xp1})`);
  ok(/Saved .* · \+10 XP · 1 of 9 · 3 lessons/.test(await txt(page, '#toast')) && await page.locator('#toast .tact', { hasText: 'Next chat' }).count() === 1, 'toast: +10 XP · 1 of 9 · 3 lessons, offers Next chat');
  ok(await page.locator(`#tf-${NF.id}.not`).count() === 1 && (await page.locator(`#tkn-${NF.id}`).inputValue()) === NOTE, 'after saving, the ticket shows the saved marks');
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
  ok(cs.length === 5 && cs.every(c => c === false), 'picking an order re-grades with cache:false on every pass (refs, facts, analysis, two grade reads)');
  const rg = await page.evaluate(n => window.__prompts.slice(n).filter(p => /You are Swift Coach/.test(p.input)).map(p => p.input), pq);
  const rgc = rg.length ? rg[0].slice(rg[0].indexOf("QA LEAD'S CORRECTIONS")) : '';
  ok(rg.length === 2 && rgc.includes(NOTE) && rgc.includes(NF.label) && rgc.indexOf(NOTE) < rgc.indexOf(LS_NEW.note), "after a re-grade the new correction is in the grade prompt, newest first");
  ok(rgc.includes(`Resolution accuracy · ${amtF.type} (compensation case): the coach gave 1/3, the QA lead says 3/3. Why: ${WHY}`) && rgc.includes(`the QA lead says ${CTO}/${CR.max}. Why: ${WHY2}`), "the re-grade's prompt has the contests: the coach gave X, the QA lead says Y. Why: …");
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
  cs = await caches(page, pq); ok(cs.length === 5 && cs.every(c => c === false), 'No order re-grades with cache:false');
  ok(await page.locator('#cs-ctx .txcall').count() === 0, 'no order, no recordings');
  ok((await txt(page, '#cTicket')).includes('No order linked') && (await txt(page, '#cTicket')).includes('None linked') && /Can't check/.test(await txt(page, '#tkComp .tkst')), "the ticket after No order: no order, no recordings, the comp check can't check");
  // un-mark Not a mistake and save: the correction is deleted, the mark goes back
  ok(await page.locator(`#tf-${NF.id}.not`).count() === 1, 'the saved mark survives a re-grade');
  await page.click(`#tf-${NF.id} [data-fmark="not"]`); await page.waitForTimeout(100);
  ok(await page.locator(`#tf-${NF.id}.not`).count() === 0 && (await txt(page, `#tf-${NF.id} .tkscore`)) === `${markL(NF.score)}/${NR.max}`, `un-marking puts ${NF.label} back to ${markL(NF.score)}`);
  ok(await page.locator(`#cc-${CF.id}.contested`).count() === 1 && (await txt(page, `#tf-${CF.id} .tkscore`)) === `${CTO}/${CR.max}`, 'the saved contest survives a re-grade');
  await page.click(`[data-contest="${CF.id}"][data-where="row"]`); await page.waitForTimeout(80);
  ok((await page.locator('#cbWhy').inputValue()) === WHY2 && await page.locator('#cbWithdraw').isVisible(), 'reopening a contest shows its reason and Withdraw');
  await page.click('#cbWithdraw'); await page.waitForTimeout(80);
  ok(await page.locator(`#cc-${CF.id}.contested`).count() === 0 && await page.locator(`[data-cm="${CF.id}"][data-v="${CF.score}"][aria-pressed="true"]`).count() === 1 && await page.locator('#cbox').count() === 0, `Withdraw puts ${CF.label} back on Claude's ${CF.score}`);
  const nLs = await count(page, 'chatLessons');
  await page.click('#chatSave'); await page.waitForTimeout(300);
  const rv2 = await page.evaluate(p => window.__data[p], P('reviews/' + SID));
  ok(!(await page.evaluate(p => window.__data[p], LID)) && !rv2.findings[NF.id], 'un-marking and saving deletes the Not a mistake lesson and the mark');
  ok(!(await page.evaluate(p => window.__data[p], `chatLessons/${SID}_${CF.id}`)) && !(rv2.contests || {})[CF.id] && await count(page, 'chatLessons') === nLs - 2, 'withdrawing and saving deletes the contest lesson and the review\'s contest');

  // ===== 9. next chat, dark, phone widths
  await page.click('#cvNext'); await page.waitForTimeout(200);
  const nextSid = await page.evaluate(() => chatSel);
  ok(nextSid && nextSid !== SID && await page.evaluate(() => location.hash) === `#chat/${WEEK}/${nextSid}` && (await txt(page, '#cvWord')).length > 0, 'Next chat opens the next unreviewed pick');
  ok((await txt(page, '#cvGrade')) === 'Re-grade', 'a graded chat offers Re-grade');
  pq = await nPrompts(page);
  await page.click('#cvGrade');
  await page.waitForFunction(n => window.__prompts.length >= n + 5 && !chatRun && !document.querySelector('#chatSteps'), pq, { timeout: 20000 }); await page.waitForTimeout(100);
  cs = await caches(page, pq); ok(cs.length === 5 && cs.every(c => c === false), 'Re-grade asks Claude fresh (cache:false)');
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
  // the approval flag (offered on a shared fault without approval): a warning in the comp check and a P1 finding with no criterion. Not a mistake only marks it
  const pa = await txt(page, '#tkPct');
  ok((await txt(page, '#tkComp .rflag')).includes('Offered on a shared fault without approval') && await page.locator('#tkComp .rerr:not(.rflag)', { hasText: 'Offered on a shared fault' }).count() === 0 && await page.locator('#tf-approval').count() === 1 && await page.locator('#tf-approval .tkscore').count() === 0 && (await txt(page, '#tf-approval .prio')) === 'P1', 'approval flag: a warning in the comp check, a P1 finding with no score');
  await page.click('#tf-approval [data-fmark="not"]'); await page.waitForTimeout(100);
  ok(await page.locator('#tf-approval.not').count() === 1 && (await txt(page, '#tkPct')) === pa && await page.locator('#tkn-approval').isVisible(), 'Not a mistake on approval marks it and leaves the score alone');
  await page.click('#tf-approval [data-fmark="not"]'); await page.waitForTimeout(100);
  // an older chat-1 audit with misses: no check, findings or priority stored. The page rebuilds the findings from the grade's reasons and cited facts
  await page.evaluate(p => window.claude.use('db').then(db => db.doc(p).get().then(d => { const a = d.data(); a.v = 'chat-1'; delete a.check; delete a.priority; delete a.grade.findings; delete a.grade.amtBy; return db.doc(p).set(a) })), P('audits/' + SID));
  await page.waitForTimeout(250);
  const a1 = await page.evaluate(p => window.__data[p], P('audits/' + SID)), below = B.CHAT_RUBRIC.filter(r => a1.grade.scores[r.id] !== 'na' && Number(a1.grade.scores[r.id]) < r.max).length;
  ok(await page.locator('#cTicket').isVisible() && await page.locator('#tkComp').count() === 0 && below > 0 && await page.locator('.tkfind').count() === below && (await page.locator('.tkfind .tkfh .prio').allInnerTexts()).every(p => /^P[123]$/.test(p)), `chat-1 audit with misses: ${below} findings rebuilt from the reasons, no comp check`);
  ok(await page.locator('.tkfind .tkq.fact').count() > 0 && await page.locator('.tkfind .tkq.fact .cite').count() === await page.locator('.tkfind .tkq.fact').count(), 'rebuilt findings show their cited facts as evidence, each with its fact id');
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
  // corrections: newest first, with what the coach said, the note, the SA, the date and the chat
  const lsi = page.locator('#brLessons .lsitem');
  const nL = await count(page, 'chatLessons');
  ok(await lsi.count() === nL && (await txt(page, '#brLessons .bhd h2')) === 'What the coach learned' && (await txt(page, '#brLessons .bhd .num')) === String(nL) && (await txt(page, '#brLessons .lsuse')) === 'Every new grade reads the newest 20.', 'Brain: What the coach learned, a count and the one-line note');
  const lsN = page.locator('#brLessons .lsitem', { hasText: LS_NEW.note }), ls0 = (await lsN.innerText()).replace(/\s+/g, ' ');
  ok(await lsN.locator('.tknot').count() === 1 && ls0.includes(LS_NEW.label) && ls0.includes(LS_NEW.type) && ls0.includes(LS_NEW.what) && ls0.includes(LS_NEW.note) && ls0.includes('Mara Quill') && ls0.includes('Chat 9900901') && await page.evaluate(([a, b]) => { const t = [...document.querySelectorAll('#brLessons .lsitem')].map(x => x.textContent); return t.findIndex(x => x.includes(a)) < t.findIndex(x => x.includes(b)) }, [LS_NEW.note, LS_OLD.note]), 'a Not a mistake lesson: label, the note, what the coach said, SA, date, chat; newest first');
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; document.getElementById('brLessons').scrollIntoView({ block: 'start' }) }); await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(SH, 'brain-learned.png') });
  const ldel = page.locator('#brLessons [data-lsdel="9900901_tone"]');
  await ldel.click(); ok(await page.evaluate(() => !!window.__data['chatLessons/9900901_tone']) && (await ldel.innerText()) === 'Confirm', 'delete asks to confirm');
  await ldel.click(); await page.waitForTimeout(200);
  ok(!(await page.evaluate(() => window.__data['chatLessons/9900901_tone'])) && await lsi.count() === nL - 1 && (await txt(page, '#brLessons .bhd .num')) === String(nL - 1), 'delete removes a lesson');
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
  cs = await caches(page, pq); ok(cs.length === 5 * left && cs.every(c => c === false), 'a chat that failed is asked fresh (cache:false)');
  ok(!errors.length, 'no console errors (batches) ' + JSON.stringify(errors));
  await ctx.close();
  ok(!allErrors.length, 'no console errors (routes) ' + JSON.stringify(allErrors));
  await b.close(); console.log(`ui chats: ${n} checks passed`);
})().catch(e => { console.error('TEST FAILED', e); process.exit(1) });
