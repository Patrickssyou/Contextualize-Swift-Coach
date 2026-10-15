// Chats area: Queue → Audit → Brain, on the real case (data/chats/cases/1831362.json, git-ignored) plus invented chats from tests/mock.js.
// Storage is by week (chatWeeks/<week>/{chats,audits,tx,reviews}); an invented, already-graded week before the case week covers week switching,
// case types, bot lines, request fields and the game layer's history.
// The QA ticket (top of Audit): fields, the brain's compensation check, findings with checked quotes, Agree / Not a mistake with live re-scoring,
// contests (a mark the QA lead disagrees with, and why) from a scorecard row or a finding card, and Not a mistake: both saved as lessons (chatLessons),
// deleted on withdraw, listed in Brain under What the coach learned and fed to the next grade's prompt. Reinforce (right mark, better reason) is a lesson too;
// order cards show Voided, Draft and Refunded.
// No names or chat text from the real case are written here: the SA, restaurant and messages are read from the fixture at run time.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), assert = require('assert');
const { openPage, chatWorld, learnWorld, reinforceWorld, DIR } = require('./mock.js');
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
const noteOf = page => page.evaluate(() => { const s = String(chatSel); return chNote(chatBy(s), chatAud[s], chatDraft(s)) });
const sel = page => page.locator('[role=tab][data-tab][aria-selected="true"]').getAttribute('data-tab');   // the nav tabs (the ticket's own tabs have no data-tab)
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
  ok(subs.length === 4 && ['Dashboard', 'Audit', 'Learning', 'Brain'].every((x, i) => subs[i].includes(x)), 'Chats steps: Dashboard, Audit, Learning, Brain');
  ok(/Not pulled yet/.test(await txt(page, '#chatStatus')) && await page.locator('#chatPull').isEnabled(), 'empty week: Pull chats ready');
  await page.click('[data-tab="learn"]'); await page.waitForTimeout(200);
  ok(await sel(page) === 'learn' && await page.evaluate(() => location.hash) === '#learn' && (await txt(page, '#lrNoCp')) === 'No checkpoint yet.' && /No round yet/.test(await txt(page, '#lrRound')) && await page.locator('#lrChart').isHidden(), 'Learning with no brainRuns: No checkpoint yet, no round, no chart');
  await page.click('[data-tab="chats"]'); await page.waitForTimeout(100);
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
  const dts = (await page.locator('#evStrip dt').allInnerTexts()).map(t => t.trim().toLowerCase());
  ok(dts[0] === 'case type' && (await page.locator('#evStrip dd').first().innerText()).trim() === 'Menu setup' && !dts.includes('policy') && !dts.includes('request'), 'Evidence strip: the case type first; no Policy on a non-compensation case');
  ok((await page.locator('#evStrip .pill').first().innerText()) === 'No fault' && (await txt(page, '#cs-ev .qans')).startsWith('Menu setup · No order'), 'fault none shows as No fault');
  ok(JSON.stringify(await page.locator('#evBrief li').allInnerTexts()) === JSON.stringify(['The client asked for two price fixes; the SA sent them to the menu team and confirmed once live.']), 'an older audit without a brief: the analysis summary stands in');
  ok(await page.locator('#cs-ev details.srcf').count() === 5 && await page.locator('#cs-ev details.srcf[open]').count() === 0 && (await txt(page, '#src-chat > summary')).replace(/\s+/g, ' ') === 'Chat 6 messages', 'sources are folded by default, one line each');
  await page.click('#src-chat > summary'); await page.waitForTimeout(80);
  ok(await page.locator('#src-chat[open]').count() === 1, 'a source opens on click');
  ok(await page.locator('#cs-chat .sysline').count() === 1 && /system/i.test(await txt(page, '#cm-2.sysline')) && (await txt(page, '#cm-2')).includes('Menu change request created') && await page.locator('#cs-chat .bub').count() === 5, 'bot message renders as a system line, not a bubble');
  ok(await page.locator('#cs-chat .bub.other').count() === 1 && (await txt(page, '#cs-chat .bub.other .bwho')).includes('trainer'), 'unknown role: neutral bubble labelled with the role');
  await page.click('#src-fields > summary'); await page.waitForTimeout(80);
  const rf = await txt(page, '#cxFields');
  ok(rf.includes('Large Margherita') && /new price/i.test(rf) && rf.includes('16.99') && (await txt(page, '#src-fields > summary')).replace(/\s+/g, ' ') === 'WIRA form Item, New price, Second item, Second price', 'Evidence › WIRA form: a plain title, the field names as the summary, label: value inside');
  ok(JSON.stringify(await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = chVia({ fields: '{"message_source":"cma"}' }) + chVia({ fields: { message_source: 'pos' } }) + chVia({ fields: '{}' });
    return [[...d.querySelectorAll('.viachip')].map(x => x.textContent), chFieldList({ message_source: 'cma', item: 'Pie' }), chFieldList('{"message_source":"pos"}')] })) === JSON.stringify([['via CMA', 'via POS'], [['Item', 'Pie']], []]), 'message_source leaves the form and shows as a "via" chip');
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
  ok(await page.evaluate(() => { const P = window.__prompts, g = P.filter(p => /You are Swift Coach/.test(p.input)); return P.length === 36 && g.length === 9 && P.every(p => p.cache === undefined) }), 'first grades: 4 passes per chat (refs, facts, analysis, one grade read), all on the default sample cache');
  ok(await weekSubN(page) === nSub, 'pulling and grading open no new subscriptions');
  ok(/Graded 9 chats/.test(await txt(page, '#chatStatus')) && await page.locator('.crow .pill', { hasText: 'Graded' }).count() === 9, 'queue shows Graded pills and the summary');
  const realA = await page.evaluate(p => window.__data[p], P('audits/' + SID));
  const RV = vLabel(realA.verdict), RP = fmt(realA.pct);
  ok(realA.v === 'chat-2' && realA.pct === B.chatScore(realA.grade.scores) && realA.verdict === B.chatVerdict(realA.pct).id && realA.orders[0].ticket === '65', `real case graded ${RV} ${RP}% on ticket 65`);
  ok(realA.check && realA.check.applies && realA.check.status === 'wrong' && realA.check.due.amount === 16.42 && realA.check.given.amount === 17.73 && realA.check.diff === 1.31 && realA.check.errors.some(e => e.code === 'tax')
    && realA.grade.amtBy === 'system' && realA.grade.scores.amt === 1 && realA.priority === 'P1', 'the brain checked the comp: due $16.42, gave $17.73, taxes included; amt set by the check; ticket P1');
  ok(!realA.grade.runs && !realA.grade.runPcts && B.CHAT_RUBRIC.every(r => realA.grade.scores[r.id] === 'na' || Number.isInteger(realA.grade.scores[r.id])), 'one grade read: no runs, no half marks');
  // the corrections reach the prompts, newest first
  const gp = await page.evaluate(s => window.__prompts.filter(p => /You are Swift Coach/.test(p.input) && p.input.includes(`CHAT ${s} ·`)).map(p => p.input), SID);
  const corr = gp.length ? gp[0].slice(gp[0].indexOf("QA LEAD'S CORRECTIONS")) : '';
  ok(gp.length === 1 && corr.includes(LS_NEW.note) && corr.includes(LS_OLD.note) && corr.indexOf(LS_NEW.note) < corr.indexOf(LS_OLD.note), "seeded corrections reach the grade prompt under QA LEAD'S CORRECTIONS, newest first");
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
  ok((await wiraRow.locator('.cfr').innerText()) === 'Reply 2.1 min' && await page.locator('.wsays').count() === 0, "first reply is WIRA's own first response time (the Lightdash metric), not recomputed");
  ok((await page.locator(`.crow[data-open="${SID}"] .cfr`).innerText()) === 'Reply 2.3 min' && await page.locator(`.crow[data-open="${SID}"] .cfr.t-bad`).count() === 0, 'the real case: Reply 2.3 min, not slow');
  const mara = (await page.locator('.sacard', { hasText: 'Mara Quill' }).innerText()).replace(/\s+/g, ' ');
  ok(/First reply \d+(\.\d)? min median/.test(mara) && !/p90|Avg first reply/.test(mara), `SA cards show the median first reply only (${(mara.match(/First reply .*? median/) || [''])[0]})`);
  await shot(page, 'chats-queue.png'); await shot(page, 'queue-ticket.png');
  for (const wd of [1100, 900]) { await page.setViewportSize({ width: wd, height: 900 }); await page.waitForTimeout(120);
    ok(await width(page) <= wd && await page.evaluate(() => [...document.querySelectorAll('.crow .cmain')].every(m => m.getBoundingClientRect().width >= 160)), `${wd}px queue: rows keep room for the chat, no overflow`) }
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(100);

  // ===== 4. the real case in Audit
  await page.click(`.crow[data-open="${SID}"] .clink`); await page.waitForTimeout(300);
  ok(await sel(page) === 'chat' && await page.evaluate(() => location.hash) === `#chat/${WEEK}/${SID}`, 'row opens Audit at #chat/<week>/<sid>');
  ok((await txt(page, '#cvWord')) === RV && (await txt(page, '#cvPct')) === RP + '%', `verdict card: ${RV} ${RP}%`);
  ok(await page.locator('#cs-score .reads').count() === 0 && await page.locator('#cs-score .cm.half').count() === 0 && await page.locator('.vreads').count() === 0, 'a one-read audit: no Reads line, no half marks, no two-reads note');
  const two = await page.evaluate(s => { const a = JSON.parse(JSON.stringify(chatAud[s])), g = a.grade, t0 = Number(g.scores.tone), t1 = t0 ? t0 - 1 : 1, r2 = Object.assign({}, g.scores, { tone: t1 }); g.runs = [g.scores, r2]; g.runPcts = [80, 60]; g.spread = 20; g.scores = Object.assign({}, g.scores, { tone: (t0 + t1) / 2 });
    const d = document.createElement('div'); d.innerHTML = chScorecard(a, { scores: g.scores, contests: {} }) + chBoard(chatBy(s), a, null, { scores: g.scores });
    return { reads: d.querySelectorAll('.reads').length, half: d.querySelectorAll('.cm.half').length, note: (d.querySelector('.vreads') || {}).textContent || '' } }, SID);
  ok(two.reads === 1 && two.half === 2 && /Two reads: 80\.0% · 60\.0%/.test(two.note), 'an older two-read audit still shows Reads, the half mark and the two-reads note');
  await shot(page, 'chats-audit-top.png'); await shot(page, 'chats-audit-full.png', true);
  await shot(page, 'ticket-top.png'); await shot(page, 'ticket-full.png', true);
  ok(await page.locator('#cvRoute .rm').count() === 4 && (await txt(page, '#cvEsc')) === 'Level ' + markL(realA.grade.scores.esc), `route marks with escalation Level ${markL(realA.grade.scores.esc)}`);
  ok((await txt(page, '#cvCase')).includes('COMPENSATION') && (await page.locator('#evStrip dt').allInnerTexts()).map(t => t.toLowerCase()).includes('policy'), 'a compensation case shows its policy row in the strip');
  await page.click('#src-order > summary .srct'); await page.waitForTimeout(80);
  const ord = await txt(page, '.ordcard');
  ok(/Ticket 65/.test(ord) && ord.includes('$54.72') && ord.includes('$4.38') && ord.includes('$59.10'), 'Evidence › Order: ticket 65, items $54.72, tax $4.38, total $59.10');
  await page.click('#src-order > summary .srct'); await page.waitForTimeout(80);

  // ===== 4b. the QA ticket: on top, fields, comp check, findings
  ok(await page.evaluate(() => { const t = document.getElementById('cTicket'), c = document.getElementById('cs-ev'); return !!t && !!c && !!(t.compareDocumentPosition(c) & Node.DOCUMENT_POSITION_FOLLOWING) && t.getBoundingClientRect().bottom <= c.getBoundingClientRect().top }), 'the ticket sits above Evidence');
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
  const tmx = await page.evaluate(() => { const d = document.createElement('div'), c = { sid: '1', at: '2026-10-12T10:00:00', frt: 22 };
    d.innerHTML = chTimingHtml(c, { timing: { opened: c.at, firstClientAt: c.at, firstReplyAt: '2026-10-12T10:22:00', firstReplyMin: 22, wiraFirstReplyMin: 2.1, slowFirstReply: true, closedAt: '2026-10-12T12:40:00', handleMin: 160,
      states: [{ at: c.at, on: 'support', min: 22 }, { at: '2026-10-12T10:22:00', on: 'handoff', min: 60 }, { at: '2026-10-12T11:22:00', on: 'client', min: 78 }, { at: '2026-10-12T12:40:00', on: 'closed', min: null }], waitingOnSupportMin: 22, waitingOnClientMin: 78, waitingOnHandoffMin: 60 } });
    const old = document.createElement('div'); old.innerHTML = chTkFields({ sid: '2', frt: 4, at: c.at }, { sid: '2' }) + chTimingHtml({ sid: '2', frt: 4 }, { sid: '2' });
    return { slow: [...d.querySelectorAll('.slowb')].map(x => x.textContent), red: !!d.querySelector('.tmfr .frm.t-bad'), wira: d.querySelector('.wsays') ? d.querySelector('.wsays').textContent : null, handle: d.textContent.includes('2 h 40 min'), closed: d.textContent.includes('12:40 PM'),
      legend: [...d.querySelectorAll('.tmst')].map(x => [...x.children].map(c => c.textContent.trim()).filter(Boolean).join(' ')), oldFr: [...old.querySelectorAll('.tkf')].find(x => x.querySelector('dt').textContent === 'First reply').querySelector('dd').textContent, oldTiming: !!old.querySelector('#tkTiming') } });
  ok(tmx.slow.includes('Slow first reply') && tmx.slow.includes('Slow') && tmx.red && tmx.handle && tmx.closed, 'a slow chat: Slow badge, red minutes, closed time and handle time 2 h 40 min');
  ok(tmx.wira === null, 'no second first-reply figure: WIRA\'s is the one shown');
  ok(tmx.legend.length === 4 && /^Handoff 1 h/.test(tmx.legend[1]) && /^Closed/.test(tmx.legend[3]), `status labels: ${tmx.legend.join(' → ')}`);
  ok(tmx.oldFr === '4 min' && !tmx.oldTiming, 'an older audit without timing: first reply from frt, no Timing block');
  // full width: What happened and the Analysis rows fill their cards at 1280, 1100 and 900
  const fill = () => page.evaluate(() => { const inner = e => { const s = getComputedStyle(e), r = e.getBoundingClientRect(); return [r.left + parseFloat(s.paddingLeft), r.right - parseFloat(s.paddingRight)] };
    const span = (els, box) => { const [l, r] = inner(box), R = [...els].map(e => e.getBoundingClientRect()); return (Math.max(...R.map(x => x.right)) - Math.min(...R.map(x => x.left))) / (r - l) };
    const wh = document.querySelector('#tkWhat .tkwh'), body = document.querySelector('#cTicket .tkbody'), ev = document.querySelector('#cs-ev .qbody');
    return { what: span(wh.children, body), timing: span([document.getElementById('tkTiming')], body), comp: span([document.getElementById('tkComp')], body), an: span([document.getElementById('evStrip')], ev), side: !!wh.querySelector('.tkside') } });
  for (const wd of [1280, 1100, 900]) { await page.setViewportSize({ width: wd, height: 900 }); await page.waitForTimeout(150); const f = await fill();
    ok(f.what >= 0.9 && f.timing >= 0.9 && f.comp >= 0.9 && f.an >= 0.9 && await width(page) <= wd,
      `${wd}px: What happened ${Math.round(f.what * 100)}%, Timing ${Math.round(f.timing * 100)}%, comp ${Math.round(f.comp * 100)}%, the evidence strip ${Math.round(f.an * 100)}% of the card`) }
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(150);
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; document.getElementById('tkWhat').scrollIntoView({ block: 'start' }) }); await page.waitForTimeout(80);
  { const a = await page.locator('#tkWhat').boundingBox(), b = await page.locator('#tkTiming').boundingBox(); await page.screenshot({ path: path.join(SH, 'ticket-timing.png'), clip: { x: a.x - 18, y: a.y - 12, width: a.width + 36, height: b.y + b.height - a.y + 24 } }) }
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.locator('#cs-ev').screenshot({ path: path.join(SH, 'evidence-collapsed.png') });
  const wira = page.locator('#cTicket .tkf a', { hasText: 'WIRA ' + SID }), gdo = page.locator('#cTicket .tkf a', { hasText: 'Ticket 65' }), o1 = realA.orders[0];
  ok(await wira.getAttribute('href') === W.fx.chatRow.wira_project_tasks_wira_ticket_url && await wira.getAttribute('target') === '_blank', 'Chat: the WIRA link, new tab');
  ok((await gdo.getAttribute('href')) === `https://greendot.prod.letsdowonders.io/greendot/restaurant/${encodeURIComponent(W.code)}?orderId=${encodeURIComponent(o1.id)}` && (await gdo.getAttribute('href')).includes(encodeURIComponent(o1.id)) && (await fv('Order')).includes('$59.10'), 'Order: GreenDot order link with the order id, and the total');
  const recs = page.locator('#cTicket .tkf a', { hasText: /^▶ Call \d/ });
  ok(await recs.count() === realA.calls.length && (await recs.first().getAttribute('href')).includes('/callrecordings?callIds=' + encodeURIComponent(realA.calls[0].id)) && /^▶ Call 1 \(\d{1,2}:\d{2} [AP]M\)$/.test((await recs.first().innerText()).trim()), `Recordings: ${realA.calls.length} links reading ▶ Call 1 (time)`);
  ok(await page.evaluate(() => [...document.querySelectorAll('#cTicket a[href^="http"]')].every(a => a.target === '_blank' && /noopener/.test(a.rel))), 'every ticket link opens in a new tab');
  const comp = (await txt(page, '#tkComp')).replace(/\s+/g, ' ');
  ok(comp.includes('Due') && comp.includes('$16.42') && comp.includes(`${first} gave`) && comp.includes('$17.73') && comp.includes('Taxes included') && comp.includes('Over by $1.31') && /Wrong/.test(await txt(page, '#tkComp .tkst')), `comp check: Due $16.42, ${first} gave $17.73, Taxes included, Over by $1.31, Wrong`);
  ok((await txt(page, '#tkComp del')).includes('tax $4.38') && (await txt(page, '#tkComp .rwhere')) === 'CHAT' && comp.includes(W.policy.comp.buckets.find(b => b.id === 'made_twice_one_paid').label), "comp check: the tax in the SA's base is struck; where it's written; the policy row");
  const pr = await page.locator('.tkfind .tkfh .prio').allInnerTexts();
  ok(pr.length === realA.grade.findings.length && pr[0] === 'P1' && pr.every((p, i) => !i || p >= pr[i - 1]), `findings sorted P1 first (${pr.join(' ')})`);
  ok((await txt(page, '#tf-amt .tkfs')).includes('set by the comp check') && (await txt(page, '#tf-amt .tkfs')).includes('1/3') && (await txt(page, '#tf-amt .tktype')).includes('Taxes included'), 'the amount finding: 1/3, set by the comp check, typed by the check');
  ok(await page.locator('.tkfind .tkq .qok').count() >= 3 && await page.locator('.tkfind').first().locator('.tkfix h5').innerText().then(t => t.toLowerCase() === `what ${first.toLowerCase()} should have done`), 'verified quotes show ✓; What <SA> should have done');
  ok(await page.locator('.tkfind details.tkmodel').count() >= 1 && await page.locator('.tkfind details.tkmodel[open]').count() === 0, 'model messages are folded');
  // ----- the ticket's tabs: Ticket | Chat N
  const nMsg = await page.evaluate(s => chatBy(s).msgs.length, SID), nInt = await page.evaluate(s => chatBy(s).msgs.filter(m => m.internal).length, SID);
  const tabs = (await page.locator('#cTicket [role=tablist] [role=tab]').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  ok(JSON.stringify(tabs) === JSON.stringify(['Ticket', 'Chat ' + nMsg]) && await page.locator('#tkTab-ticket[aria-selected="true"]').count() === 1 && await page.locator('#tkPan-ticket').isVisible() && await page.locator('#tkPan-chat').isHidden(), `ticket tabs: Ticket | Chat ${nMsg}, Ticket open`);
  ok(await page.evaluate(() => { const t = document.querySelectorAll('#cTicket [role=tab]'); return [...t].every(b => b.tagName === 'BUTTON' && b.getAttribute('aria-controls') && document.getElementById(b.getAttribute('aria-controls')).getAttribute('role') === 'tabpanel') && t[0].tabIndex === 0 && t[1].tabIndex === -1 }), 'tabs are buttons with aria-selected, aria-controls and a roving tabindex');
  await page.click('#tkTab-chat'); await page.waitForTimeout(100);
  const tc = await page.evaluate(() => { const P = document.getElementById('tkPan-chat'), L = [...P.querySelectorAll('#tkChat > li')];
    return { vis: !P.hidden, tk: document.getElementById('tkPan-ticket').hidden, n: L.length, ms: L.map(x => (x.querySelector('.bn') || {}).textContent), ints: [...P.querySelectorAll('.bub.internal')].map(x => x.querySelector('.ntag').textContent),
      cl: P.querySelectorAll('.bub.cl').length, me: P.querySelectorAll('.bub.me').length, left: (P.querySelector('.bub.cl') || P).getBoundingClientRect().left, right: (P.querySelector('.bub.me') || P).getBoundingClientRect().right, pl: P.getBoundingClientRect().left, pr: P.getBoundingClientRect().right,
      scroll: getComputedStyle(P).overflowY, tall: P.scrollHeight > P.clientHeight, foot: !!document.querySelector('#cTicket .tkfoot') } });
  ok(tc.vis && tc.tk && tc.n === nMsg && tc.ms.every((m, i) => m === 'M' + (i + 1)), `Chat tab: all ${nMsg} messages with M numbers, the ticket body hidden`);
  ok(tc.ints.length === nInt && nInt > 0 && tc.ints.every(t => t.startsWith('internal')), `Chat tab: ${nInt} internal notes tagged`);
  ok(tc.cl > 0 && tc.me > 0 && tc.left - tc.pl < 40 && tc.pr - tc.right < 40, 'Chat tab: client on the left, the SA on the right');
  ok(tc.scroll === 'auto' && tc.tall, 'Chat tab: a long chat scrolls inside the card');
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; window.scrollTo(0, 0) }); await page.waitForTimeout(80);
  await page.locator('#cTicket').screenshot({ path: path.join(SH, 'ticket-chat-tab.png') });
  await page.focus('#tkTab-chat'); await page.keyboard.press('ArrowLeft'); await page.waitForTimeout(60);
  ok(await page.evaluate(() => document.activeElement.id) === 'tkTab-ticket' && await page.locator('#tkTab-ticket[aria-selected="true"]').count() === 1 && await page.locator('#tkPan-chat').isHidden(), 'keyboard: ArrowLeft moves to Ticket and selects it');
  await page.keyboard.press('End'); await page.waitForTimeout(60);
  ok(await page.evaluate(() => document.activeElement.id) === 'tkTab-chat' && await page.locator('#tkPan-chat').isVisible(), 'keyboard: End selects Chat');
  await page.keyboard.press('Enter'); await page.click('#tkTab-ticket'); await page.waitForTimeout(60);
  const mchip = page.locator('.tkfind .srcchip[data-jump^="tm-"]').first(), mid = (await mchip.getAttribute('data-jump'));
  await mchip.click(); await page.waitForTimeout(700);
  ok(await page.evaluate(id => { const el = document.getElementById(id), r = el.getBoundingClientRect(), P = document.getElementById('tkPan-chat').getBoundingClientRect();
    return el.classList.contains('flash') && !!el.closest('#tkPan-chat') && r.top >= Math.max(0, P.top) - 1 && r.bottom <= Math.min(innerHeight, P.bottom) + 1 }, mid) && await page.locator('#tkTab-chat[aria-selected="true"]').count() === 1 && await page.evaluate(() => location.hash) === `#chat/${WEEK}/${SID}`,
    `an M# chip on a finding opens the Chat tab, scrolls to ${mid.replace('tm-', 'M')} and highlights it`);
  ok(await page.locator('#src-chat').count() === 1 && await page.locator('#cs-chat > li').count() === nMsg, 'the transcript fold stays in Evidence too');
  // the tab is kept for the page view: a repaint and another chat keep Chat
  await page.evaluate(() => { paintTicket(); renderChatAudit(true) }); await page.waitForTimeout(60);
  ok(await page.locator('#tkTab-chat[aria-selected="true"]').count() === 1 && await page.locator('#tkPan-chat').isVisible(), 'a repaint keeps the Chat tab');
  await page.evaluate(w => openChat('9900901', w), PW); await page.waitForFunction(() => !!document.querySelector('#cTicket[data-sid="9900901"]'), null, { timeout: 5000 });
  ok(await page.locator('#tkTab-chat[aria-selected="true"]').count() === 1 && (await txt(page, '#tkTab-chat')).replace(/\s+/g, ' ') === 'Chat 6' && await page.locator('#tkPan-chat #tkChat > li').count() === 6, 'switching chats keeps the Chat tab (Chat 6 on the other chat)');
  await page.evaluate(w => openChat(w[0], w[1]), [SID, WEEK]); await page.waitForFunction(s => !!document.querySelector(`#cTicket[data-sid="${s}"]`), SID, { timeout: 5000 });
  ok(await page.locator('#tkTab-chat[aria-selected="true"]').count() === 1, 'and back: still on Chat');
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
  ok(await width(page) <= 390 && await page.evaluate(() => [...document.querySelectorAll('#cTicket .tktab, #tkPan-chat .bub, #tkPan-chat .sysline')].every(e => e.getBoundingClientRect().right <= 390)), `390px Chat tab: no horizontal overflow (${await width(page)})`);
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.locator('#cTicket').screenshot({ path: path.join(SH, 'ticket-chat-390.png') });
  await page.click('#tkTab-ticket'); await page.waitForTimeout(80);
  ok(await width(page) <= 390, `390px Ticket tab: no horizontal overflow (${await width(page)})`);
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; window.scrollTo(0, 0) }); await page.locator('#cTicket').screenshot({ path: path.join(SH, 'ticket-tab-390.png') });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(120);
  ok(await page.locator('#tkTab-ticket[aria-selected="true"]').count() === 1, 'back on the Ticket tab');
  const tchip = page.locator('.tkfind .srcchip[data-jump^="cx-task-"]').first();
  if (await tchip.count()) { await tchip.click(); await page.waitForTimeout(700); ok(await page.evaluate(id => document.getElementById(id).classList.contains('flash') && !!document.getElementById(id).closest('#src-tasks[open]'), await tchip.getAttribute('data-jump')), 'a Task chip opens Tasks and scrolls to the task card') }
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
  const ints = await page.locator('#cs-chat .bub.internal').allInnerTexts();
  ok(ints.length === 3 && ints.every(t => t.includes('internal · inferred')), '3 internal notes tagged internal · inferred');
  ok(await page.locator('.bub.cl').count() > 0 && await page.locator('.bub.me').count() > 0, 'client bubbles left, audited SA bubbles marked');
  // folded, the Calls row lists each call with its recording link; the Order row has the GreenDot link
  await page.evaluate(() => { const d = document.getElementById('src-calls'); if (d) d.open = false }); await page.waitForTimeout(60);
  const crow = await page.evaluate(() => [...document.querySelectorAll('#src-calls > summary .srcrow')].map(r => { const a = r.querySelector('a.rec'), b = a && a.getBoundingClientRect(); return { t: r.innerText.replace(/\s+/g, ' ').trim(), href: a && a.getAttribute('href'), tgt: a && a.target, vis: !!b && b.width > 0 && b.height > 0 } }));
  ok(crow.length === realA.calls.length && crow.every((r, i) => new RegExp(`^Call ${i + 1} · \\d{1,2}:\\d{2} [AP]M · \\d+:\\d{2} · .+ ▶ Recording$`).test(r.t) && r.vis && r.tgt === '_blank' && r.href.includes('/callrecordings?callIds=' + encodeURIComponent(realA.calls[i].id))) && await page.locator('#src-calls[open]').count() === 0,
    `Calls folded: ${crow.map(r => r.t).join(' | ')}`);
  const gd = page.locator('#src-order > summary a.srclink');
  ok(await gd.count() === 1 && await gd.isVisible() && (await gd.getAttribute('href')).includes('?orderId=' + encodeURIComponent(realA.orders[0].id)) && await page.locator('#src-order[open]').count() === 0, 'Order folded: the GreenDot link works without opening');
  await page.evaluate(() => document.querySelector('#src-calls > summary a.rec').addEventListener('click', e => e.preventDefault(), { once: true })); await page.click('#src-calls > summary a.rec'); await page.waitForTimeout(60);
  ok(await page.locator('#src-calls[open]').count() === 0, 'clicking ▶ Recording does not open the fold');
  ok(await page.locator('#src-fields').count() === 0 && /^via [A-Z]/.test(await txt(page, '#cTicket .tkid .viachip')), `a message_source-only chat: no WIRA form fold, the source as a chip (${await txt(page, '#cTicket .tkid .viachip')})`);
  ok(await page.locator('#src-calls .txcall').count() === 2 && await page.locator('#src-calls .txcall a', { hasText: 'Rec' }).count() === 2 && await page.locator('#src-calls .txsum li').count() > 4 && (await txt(page, '#src-calls > summary')).includes('2 calls'), 'Calls: two call cards with recordings and Claude bullets');
  if (!(await page.locator('#src-calls[open]').count())) await page.click('#src-calls > summary');
  await page.locator('#src-calls details.txd summary').first().click();
  await page.waitForFunction(() => { const t = document.querySelector('#src-calls details.txd .txtext'); return t && t.textContent.length > 100 }, null, { timeout: 5000 });
  ok(true, 'transcript loads from chatTx');
  ok(await page.locator('#src-tasks .task').count() === 1 && await page.locator('#src-tasks .task .ttag', { hasText: 'From this chat' }).count() === 1, 'linked task from this chat');
  const fsum = (await txt(page, '#src-facts > summary')).replace(/\s+/g, ' '), ncon = realA.facts.claims.filter(c => c.check === 'contradicted').length;
  const osum = (await txt(page, '#src-order > summary')).replace(/\s+/g, ' ').trim();
  ok(fsum === `Timeline and SA claims ${realA.facts.timeline.length} facts · ${realA.facts.claims.length} claims · ${ncon} wrong` && /^Order Ticket 65 · \$59\.10 · [a-z ]+ · \d{1,2}:\d{2} [AP]M Open in GreenDot ↗$/.test(osum), `source lines: ${fsum}; ${osum}`);
  const brief0 = await page.locator('#evBrief li').allInnerTexts();
  ok(brief0.length === 1 + realA.calls.length && brief0[0] === realA.analysis.summary && brief0[1].startsWith('Call 1: '), 'no brief on the real case: the summary plus each call\'s first bullet');
  ok(await page.locator('.cfacts .fact').count() === realA.facts.timeline.length && await page.locator('.claim').count() === realA.facts.claims.length, `case facts: ${realA.facts.timeline.length} facts, ${realA.facts.claims.length} claims`);
  ok(await page.locator('.claim.contradicted').count() === realA.facts.claims.filter(c => c.check === 'contradicted').length, 'contradicted claims flagged');
  ok(await page.locator('.ccrit').count() === 9 && await page.locator('[data-cm="esc"]').count() === 6 && await page.locator('[data-cm="ev"][data-v="na"]').count() === 0, 'scorecard: 9 criteria, esc 0–4 + N/A, N/A only where allowed');
  const note0 = await noteOf(page);
  ok(note0.startsWith(`Chat ${SID} · `) && note0.includes(`— ${RV} (${RP}%)`), 'coaching note starts with the chat line and the verdict');
  const items = note0.slice(note0.indexOf('\nNext time\n')).split('\n').filter(l => /^\d+\. /.test(l));
  ok(items.length === realA.grade.findings.length && items[0].startsWith('1. P1 · Approval') && items[1].startsWith('2. P1 · Resolution accuracy') && note0.includes(`Do: ${realA.grade.findings[0].should}`) && note0.includes('Why it matters: '), "coaching uses the ticket's findings, P1 first: what happened, why, do, model");
  // cite links jump without touching the route
  await page.evaluate(() => { const d = document.getElementById('src-facts'); if (d) d.open = false });
  const cjump = await page.locator('#evStrip .cite').first().getAttribute('data-jump');
  await page.locator('#evStrip .cite').first().click(); await page.waitForTimeout(400);
  ok(await page.evaluate(() => location.hash) === `#chat/${WEEK}/${SID}` && await page.evaluate(id => document.getElementById(id).classList.contains('flash') && !!document.getElementById(id).closest('#src-facts[open]'), cjump), 'a fact cite opens the timeline, scrolls to the fact and keeps the route');
  // the four sections and the coaching cards
  ok((await txt(page, '#cTicket .sechd')) === 'QA TICKET' && JSON.stringify(await page.locator('#view-chat .qsec > .qhd .qttl').allInnerTexts()) === '["Evidence","Scorecard","Coaching"]' && JSON.stringify(await page.locator('#view-chat .qnum').allInnerTexts()) === '["1","2","3","4"]',
    'the audit has four sections: 1 Ticket, 2 Evidence, 3 Scorecard, 4 Coaching');
  const fixes = await page.evaluate(s => chFixes(chatAud[s], chatDraft(s).scores, chatDraft(s).findings, chatDraft(s).contests), SID);
  ok(await page.locator('#coachFixes .fixcard').count() === fixes.length && fixes.length === realA.grade.findings.length && (await page.locator('#coachFixes .fixcard .prio').first().innerText()) === 'P1' && (await page.locator('#coachFixes .fixcard h4').first().innerText()).startsWith('Approval')
    && await page.locator('#coachFixes .fixcard .fixdo').count() === fixes.filter(f => f.should).length && await page.locator('#coachFixes .fixmodel [data-ccopy]').count() === fixes.filter(f => f.model).length, 'coaching: one card per fix, P1 first, What happened, Do this instead, the model message with Copy');
  ok(await page.locator('#coachWell .wchips li').count() === (realA.grade.wentWell || []).length && await page.locator('#coachText').count() === 0 && await page.locator('#coachCopy').innerText() === 'Copy all', 'what went well as chips; no note box until asked; Copy all');
  await page.click('#coachEdit'); await page.waitForTimeout(80);
  ok((await page.locator('#coachText').inputValue()) === note0 && (await txt(page, '#coachEdit')) === 'Close note', 'Edit note opens the note, prefilled from the same text');
  await page.click('#coachEdit'); await page.waitForTimeout(80);
  ok(await page.locator('#cs-ev details.srcf').count() >= 4 && await page.locator('#calOpen').count() === 0 && !/calibration/i.test(await txt(page, '#view-chat')), 'no calibration button on the audit');
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.locator('#cs-coach').screenshot({ path: path.join(SH, 'coaching-cards.png') });
  await page.evaluate(() => document.querySelectorAll('#cs-ev details.srcf[open]').forEach(d => d.open = false)); await shot(page, 'audit-4sections.png', true);

  // ===== 4c. the evidence panel: a contest (or a row's Sources link) opens what Claude used for that criterion, beside the page (a bottom sheet on phones)
  const PC = await page.evaluate(s => { const c = chatBy(s), a = chatAud[s], R = a.grade.reasons || {}, out = {};
    for (const r of CHAT_RUBRIC) { const k = chCitesIn(R[r.id]), its = chPanelItems(c, a, r.id).items;
      if (!out.m && k.some(x => /^M\d+$/.test(x))) out.m = { id: r.id, label: r.label, ms: [...new Set(its.filter(i => i.tgt && i.tgt.kind === 'msg').map(i => String(i.tgt.n)))] };
      const fk = k.find(x => /^F\d+$/.test(x) && a.facts.timeline.some(t => t.id === x));
      if (!out.f && fk) { const t = a.facts.timeline.find(x => x.id === fk); out.f = { id: r.id, key: fk, text: `${t.who} ${t.what}` } }
      const ci = its.findIndex(i => i.tgt && i.tgt.kind === 'call');
      if (!out.call && ci >= 0) out.call = { id: r.id, i: ci, n: its[ci].tgt.n, callId: a.calls[its[ci].tgt.n - 1].id } }
    return out }, SID);
  ok(PC.m && PC.f && PC.call && PC.m.ms.length > 0, `the real case has reasons citing messages (${PC.m.id}), facts (${PC.f.id}: ${PC.f.key}) and a call (${PC.call.id})`);
  ok(JSON.stringify(await page.evaluate(() => [chCitesIn('See M2, F1 to F3 and C8; Call 2 and Task 1831693 (O1).'), chCitesIn('M4–M6')])) === JSON.stringify([['M2', 'F1', 'F2', 'F3', 'C8', 'Call 2', 'Task 1831693', 'O1'], ['M4', 'M5', 'M6']]), 'cites are read from the reason: M, F, C, O, Call, Task and ranges');
  await page.click(`[data-contest="${PC.m.id}"][data-where="row"]`); await page.waitForTimeout(250);
  const pan = () => page.evaluate(() => { const P = document.getElementById('chPanel'), r = P && P.getBoundingClientRect(); return P && !P.hidden ? { l: r.left, r: r.right, t: r.top, b: r.bottom, w: r.width, h: r.height } : null });
  let pr0 = await pan();
  ok(pr0 && Math.abs(pr0.r - 1280) < 1 && pr0.w >= 420 && pr0.w <= 480 && pr0.t === 0 && Math.abs(pr0.b - 900) < 1 && await page.locator(`#cc-${PC.m.id} #cbox`).isVisible(), `Contest opens the panel on the right (${Math.round(pr0 && pr0.w)}px, full height) beside the contest box`);
  ok((await txt(page, '#chpTitle')) === PC.m.label && (await txt(page, '#chPanel .chpmark b')) === await page.evaluate(([s, k]) => { const r = chRub(k); return chMk(chClaudeMark(chatAud[s], k), r.max) }, [SID, PC.m.id]) && await page.locator('#chpClose').isVisible(), "panel header: the criterion, Claude's mark, ×");
  ok(await page.evaluate(() => { const b = document.getElementById('cbox').getBoundingClientRect(), p = document.getElementById('chPanel').getBoundingClientRect(), s = document.querySelector('#cs-score').getBoundingClientRect(); return b.right <= p.left && s.right <= p.left }) && await width(page) <= 1280, 'the page narrows: the scorecard and the contest box sit clear of the panel');
  await page.fill('#cbWhy', 'Checking the sources.'); ok((await page.locator('#cbWhy').inputValue()) === 'Checking the sources.' && await page.evaluate(() => document.activeElement.id) === 'cbWhy', 'the contest box stays usable while the panel is open');
  const pit = await page.evaluate(() => [...document.querySelectorAll('#chPanel .chplist > li')].map(x => x.textContent.replace(/\s+/g, ' ').trim()));
  ok(pit.length >= PC.m.ms.length && (await page.locator('#chPanel .chpwhy .chpcite').count()) > 0, `What Claude used: ${pit.length} items, the reason's cites are buttons`);
  const cv = await page.evaluate(ms => { const V = document.getElementById('chpView'), vr = V.getBoundingClientRect(), C = [...V.querySelectorAll('.cited')], f = C[0] && C[0].getBoundingClientRect();
    return { ids: C.map(x => x.id.replace('pm-', '')), all: V.querySelectorAll('#chpChat > li').length, first: !!f && f.top >= vr.top - 1 && f.top < vr.bottom - 20, tag: C.every(x => /Cited/.test(x.textContent)) } }, PC.m.ms);
  ok(JSON.stringify(cv.ids.slice().sort()) === JSON.stringify(PC.m.ms.slice().sort()) && cv.all === await page.evaluate(s => chatBy(s).msgs.length, SID) && cv.tag, `the panel's chat: every message, ${cv.ids.map(x => 'M' + x).join(' ')} marked Cited`);
  ok(cv.first, 'the first cited message is scrolled into view');
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; document.getElementById('cbox').scrollIntoView({ block: 'center' }) }); await page.waitForTimeout(120);
  await page.screenshot({ path: path.join(SH, 'contest-panel.png') });
  const lastM = PC.m.ms[PC.m.ms.length - 1];
  await page.locator('#chPanel [data-pgo]').filter({ has: page.locator('.srcchip', { hasText: new RegExp('^M' + lastM + '$') }) }).first().click(); await page.waitForTimeout(200);
  ok(await page.evaluate(n => { const V = document.getElementById('chpView').getBoundingClientRect(), e = document.getElementById('pm-' + n), r = e.getBoundingClientRect(); return e.classList.contains('flash') && r.top >= V.top - 1 && r.top < V.bottom - 10 }, lastM) && await page.evaluate(() => scrollY) > 0, `clicking the M${lastM} item scrolls the panel's chat to it`);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(150);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('chPanel')).backgroundColor) !== 'rgb(255, 255, 255)', 'dark: the panel takes the dark tokens');
  await page.screenshot({ path: path.join(SH, 'contest-panel-dark.png') }); await page.emulateMedia({ colorScheme: 'light' });
  await page.click('#chpClose'); await page.waitForTimeout(100);
  ok(!(await pan()) && await page.locator('#cbox').isVisible() && !(await page.evaluate(() => document.body.classList.contains('chp-on'))), '× closes the panel; the contest box stays');
  await page.click('#cbCancel'); await page.waitForTimeout(80);
  await page.click(`[data-contest="${PC.m.id}"][data-where="row"]`); await page.waitForTimeout(150);
  ok(!!(await pan()), 'contesting again reopens it');
  await page.click('#cbCancel'); await page.waitForTimeout(100);
  ok(!(await pan()) && await page.locator('#cbox').count() === 0, 'closing the contest box closes the panel');
  await page.click(`[data-contest="${PC.m.id}"][data-where="row"]`); await page.waitForTimeout(150);
  await page.focus('#cbWhy'); await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  ok(!(await pan()) && await page.locator('#cbox').count() === 0, 'Esc in the contest box closes both');
  // contest from a finding card
  const fcard = await page.evaluate(() => { const b = document.querySelector('.tkfind [data-contest][data-where="find"]'); return b && b.dataset.contest });
  await page.click(`.tkfind [data-contest="${fcard}"]`); await page.waitForTimeout(150);
  ok((await txt(page, '#chpTitle')) === await page.evaluate(k => chRub(k).label, fcard) && (await txt(page, '#chpVia')) === 'CONTEST', 'a finding card\'s Contest opens the panel too');
  await page.click('#cbCancel'); await page.waitForTimeout(100);
  // the Sources link: no contest
  await page.click(`[data-psrc="${PC.f.id}"]`); await page.waitForTimeout(150);
  ok(!!(await pan()) && await page.locator('#cbox').count() === 0 && (await txt(page, '#chpVia')) === 'SOURCES' && (await page.locator(`[data-psrc="${PC.f.id}"]`).getAttribute('aria-expanded')) === 'true' && await page.evaluate(() => document.activeElement.id) === 'chpTitle', 'Sources opens the panel without contesting');
  const fi = page.locator('#chPanel .chplist .chpi').filter({ has: page.locator('.srcchip', { hasText: new RegExp('^' + PC.f.key + '$') }) }).first();
  ok((await fi.locator('.chpq').innerText()).replace(/\s+/g, ' ').trim() === PC.f.text.replace(/\s+/g, ' ').trim() && await fi.locator('.srcchip').count() === 2, `${PC.f.key} resolves to the fact text and its source`);
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  ok(!(await pan()) && await page.evaluate(k => document.activeElement && document.activeElement.dataset.psrc === k, PC.f.id), 'Esc closes it and focus goes back to Sources');
  // a Call cite shows the call: bullets, the recording, the transcript with the quote marked when it's found
  await page.click(`[data-psrc="${PC.call.id}"]`); await page.waitForTimeout(150);
  await page.click(`#chPanel [data-pgo="${PC.call.i}"]`); await page.waitForTimeout(400);
  const callV = await page.evaluate(() => { const C = document.getElementById('chpCall'), a = C && C.querySelector('a.rec'); return C ? { head: C.querySelector('.chpsh b').textContent, href: a && a.getAttribute('href'), tgt: a && a.target, tx: !!C.querySelector('details[data-ptx]'), back: !!document.querySelector('#chpView [data-pback]') } : null });
  ok(callV && callV.head === 'Call ' + PC.call.n && callV.href.includes('/callrecordings?callIds=' + encodeURIComponent(PC.call.callId)) && callV.tgt === '_blank' && callV.tx && callV.back, `a Call cite shows Call ${PC.call.n} in the panel with ▶ Recording and a transcript`);
  if (!(await page.locator('#chpCall details[open]').count())) await page.click('#chpCall details summary');
  await page.waitForFunction(() => { const t = document.getElementById('chpTx'); return t && t.textContent.length > 100 }, null, { timeout: 5000 });
  ok(await page.evaluate(() => { const d = document.createElement('div'); d.innerHTML = chTxMark('Hello. Pickup or delivery? Pickup. Thanks.', ["Answered 'x'", 'Pickup or delivery? Pickup']); return d.querySelector('mark').textContent }) === 'Pickup or delivery? Pickup', 'the transcript marks the quoted words when found');
  await page.click('#chpView [data-pback]'); await page.waitForTimeout(100);
  ok(await page.locator('#chpChat').isVisible(), '← Chat goes back to the chat');
  await page.click('#chpClose'); await page.waitForTimeout(80);
  // phone: a bottom sheet, the contest box above it
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
  await page.click(`[data-contest="${PC.m.id}"][data-where="row"]`); await page.waitForTimeout(250);
  const sh = await pan();
  ok(sh && sh.l === 0 && Math.abs(sh.r - 390) < 1 && Math.abs(sh.b - 860) < 1 && sh.h <= 860 * 0.55 && sh.t > 380 && await width(page) <= 390, `390px: a bottom sheet (${Math.round(sh && sh.h)}px), no horizontal overflow (${await width(page)})`);
  ok(await page.evaluate(() => { const b = document.getElementById('cbox').getBoundingClientRect(), p = document.getElementById('chPanel').getBoundingClientRect(); const w = document.getElementById('cbWhy').getBoundingClientRect(), sv = document.getElementById('cbSave').getBoundingClientRect(); return w.top >= 0 && sv.bottom <= p.top + 1 && b.bottom <= p.top + 1 }), '390px: Why and Submit sit above the sheet');
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.screenshot({ path: path.join(SH, 'contest-panel-390.png') });
  await page.click('#cbCancel'); await page.waitForTimeout(100);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(120);
  ok(!(await pan()) && await page.locator('#cbox').count() === 0, 'panel and contest box closed before the contest checks');

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
  await page.fill('#cbWhy', WHY); ok(await page.locator('#cbSave').isEnabled(), 'typing a reason arms Submit');
  await page.waitForTimeout(80); await page.screenshot({ path: path.join(SH, 'contest-box.png') });
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(120);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('cbox')).backgroundColor) !== 'rgb(255, 255, 255)', 'dark: the contest box takes the dark tokens');
  await page.screenshot({ path: path.join(SH, 'contest-box-dark.png') }); await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
  await page.evaluate(() => document.getElementById('cbox').scrollIntoView({ block: 'center' })); await page.waitForTimeout(80);
  ok(await width(page) <= 390 && await page.evaluate(() => document.getElementById('cbox').getBoundingClientRect().right <= 390), `390px contest box: no horizontal overflow (${await width(page)})`);
  await page.screenshot({ path: path.join(SH, 'contest-390.png') });
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(120);
  ok((await txt(page, '#cbSave')) === 'Submit', 'the contest button says Submit');
  await page.click('#cbSave'); await page.waitForTimeout(100);
  ok((await txt(page, '#cvPct')) === want.p + '%' && (await txt(page, '#cvWord')) === want.v && (await txt(page, '#csScoreAns')) === `${want.v} · ${want.p}%` && await page.locator('#cbox').count() === 0, `Submit re-scores live: ${want.v} ${want.p}%`);
  ok(await page.locator('#cc-amt.contested').count() === 1 && (await txt(page, '#cc-amt .ccon')) === 'CONTESTED' && (await txt(page, '#cc-amt .cfrom s')) === '1/3' && (await txt(page, '#cc-amt .cfrom b')) === '3/3' && (await txt(page, '#cc-amt .cyour')).includes(WHY) && await page.locator('[data-cm="amt"][data-v="3"][aria-pressed="true"]').count() === 1,
    "the row: Contested, Claude's 1/3 struck, 3/3, the reason underneath");
  await page.waitForFunction(p => !!window.__data[p], `chatLessons/${SID}_amt`, { timeout: 3000 });
  const sub = await page.evaluate(p => window.__data[p], `chatLessons/${SID}_amt`);
  ok(sub.kind === 'contest' && sub.from === '1/3' && sub.to === '3/3' && sub.reason === WHY && sub.week === WEEK && 'round' in sub && 'checkpoint' in sub && sub.round === null && !(await page.evaluate(p => !!window.__data[p], P('reviews/' + SID))), 'Submit writes the lesson at once, before Save review, with round and checkpoint fields');
  await page.waitForTimeout(100);
  ok((await txt(page, '#cc-amt .clearned')) === 'Submitted · learned' && (await txt(page, '#tf-amt .tkyour .clearned')) === 'Submitted · learned', 'the row and the finding card say Submitted · learned');
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; document.getElementById('cc-amt').scrollIntoView({ block: 'center' }) }); await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SH, 'contest-submit.png') });
  ok((await noteOf(page)).includes(`— ${want.v} (${want.p}%)`) && !/\d\. P1 · Resolution accuracy/.test(await noteOf(page)), 'coaching note follows the marks; contested to full marks, the finding leaves it');
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
  ok(!(await noteOf(page)).includes(`P${NF.priority.slice(1)} · ${NF.label}`) && await page.locator(`#tkn-${NF.id}`).isVisible() && (await txt(page, `label[for="tkn-${NF.id}"]`)).toLowerCase() === "why it wasn't a mistake", 'the finding leaves the coaching note; a note box opens');
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
  ok(/\d\. P\d · /.test(await noteOf(page)) && (await noteOf(page)).includes(CF.label), 'a contest below full marks keeps the finding in the coaching note');
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
  // ===== 6b. Dashboard: the week's numbers, then one card per SA with the average score, lowest first
  await page.click('[data-tab="chats"]'); await page.waitForTimeout(200);
  const DB = await page.evaluate(w => { const L = Object.entries(window.__data).filter(([p]) => p.startsWith(`chatWeeks/${w}/chats/`)).map(([, d]) => d);
    const aud = s => window.__data[`chatWeeks/${w}/audits/${s}`], rev = s => window.__data[`chatWeeks/${w}/reviews/${s}`];
    return L.map(c => ({ sid: String(c.sid), sa: c.sa, ai: aud(c.sid) ? aud(c.sid).pct : null, rv: rev(c.sid) ? rev(c.sid).pct : null, fr: chFirstMin(c, aud(c.sid)) })) }, WEEK);
  const mean = L => L.length ? L.reduce((t, v) => t + v, 0) / L.length : null;
  const med = L => { const x = L.slice().sort((a, b) => a - b), k = x.length; return k ? (k % 2 ? x[(k - 1) / 2] : (x[k / 2 - 1] + x[k / 2]) / 2) : null };
  const cur = d => d.rv != null ? d.rv : d.ai, scored = DB.filter(d => cur(d) != null), teamAvg = mean(scored.map(cur));
  const realD = DB.find(d => d.sid === SID);
  ok(realD.rv != null && realD.ai != null && realD.rv !== realD.ai && fmt(teamAvg) !== fmt(mean(DB.filter(d => d.ai != null).map(d => d.ai))), `the reviewed chat's % (${fmt(realD.rv)}) differs from Claude's (${fmt(realD.ai)}), so the override shows`);
  ok((await txt(page, '#dmScore .dmv')) === fmt(teamAvg) + '%' && (await txt(page, '#dmScore .dms')).endsWith(`${scored.length} chats`), `Team quality score ${fmt(teamAvg)}% over ${scored.length} chats: the mean, reviewed % over Claude's`);
  const vmix = {}; scored.forEach(d => { const v = B.chatVerdict(cur(d)).id; vmix[v] = (vmix[v] || 0) + 1 });
  ok(await page.evaluate(() => [...document.querySelectorAll('#dmMix .dmixl li')].map(li => [li.dataset.v, Number(li.querySelector('b').textContent)])).then(x => x.every(([v, k]) => k === (vmix[v] || 0)) && x.length === 5), `verdict mix: ${JSON.stringify(vmix)}`);
  const frs = DB.map(d => d.fr).filter(x => x != null), teamFr = med(frs);
  ok((await txt(page, '#dmFr .dmv')) === await page.evaluate(m => chFrt(m), teamFr), `first reply median ${await page.evaluate(m => chFrt(m), teamFr)} over ${frs.length} chats`);
  const tally = await page.evaluate(() => chCompTally(chatsOfWeek()));
  ok((await txt(page, '#dmComp .dmv')) === `${tally.right} of ${tally.n}` && (await txt(page, '#dmRev .dmv')) === `1 of ${DB.length}`, `comp accuracy ${tally.right} of ${tally.n}; reviewed by you 1 of ${DB.length}`);
  const cardsDom = await page.evaluate(() => [...document.querySelectorAll('#chatStrip .sacard')].map(c => ({ sa: c.dataset.sa, score: c.querySelector('.sascore').textContent, fr: (c.querySelector('.safr b') || {}).textContent || null })));
  const bySa = {}; DB.forEach(d => (bySa[d.sa] = bySa[d.sa] || []).push(d));
  const wantCards = Object.entries(bySa).map(([sa, L]) => ({ sa, avg: mean(L.filter(d => cur(d) != null).map(cur)), fr: med(L.map(d => d.fr).filter(x => x != null)) })).sort((x, y) => (x.avg == null) - (y.avg == null) || (x.avg ?? 0) - (y.avg ?? 0));
  ok(cardsDom.length === wantCards.length && cardsDom.every((c, i) => c.sa === wantCards[i].sa && c.score === (wantCards[i].avg == null ? '–' : fmt(wantCards[i].avg) + '%')), `SA cards sorted lowest first: ${cardsDom.map(c => c.sa.split(' ')[0] + ' ' + c.score).join(', ')}`);
  ok(await Promise.all(cardsDom.map((c, i) => wantCards[i].fr == null ? c.fr === null : page.evaluate(m => chFrt(m), wantCards[i].fr).then(t => t === c.fr))).then(x => x.every(Boolean)), 'each card: its first reply median');
  await page.click(`#chatStrip .sacard[data-sa="${cardsDom[0].sa}"]`); await page.waitForTimeout(500);
  ok(await page.evaluate(sa => { const g = [...document.querySelectorAll('.sagroup')].find(x => x.querySelector('h3 span').textContent.startsWith(sa)); const r = g.getBoundingClientRect(); return r.top >= -2 && r.top < innerHeight / 2 }, cardsDom[0].sa), 'a card jumps to that SA\'s chats');
  await shot(page, 'dashboard.png');
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(120); await shot(page, 'dashboard-dark.png'); await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
  ok(await width(page) <= 390 && await page.evaluate(() => [...document.querySelectorAll('#chatMetrics .dm, #chatStrip .sacard')].every(e => e.getBoundingClientRect().right <= 390)), `390px Dashboard: no horizontal overflow (${await width(page)})`);
  await shot(page, 'dashboard-390.png'); await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(100);
  await page.click(`.crow[data-open="${SID}"] .clink`); await page.waitForTimeout(300);


  // ===== 7. (calibration cases are no longer saved from the audit)
  ok(await page.locator('#calOpen, #calForm').count() === 0 && !(await page.evaluate(s => !!window.__data['chatCalib/' + s], SID)), 'no Save as calibration case');

  // ===== 8. change order: ranked matches, then the whole day (searchable), then No order; every pick re-grades fresh
  if (!(await page.locator('#src-order[open]').count())) await page.click('#src-order > summary .srct');
  await page.click('#ordChange'); await page.waitForTimeout(100);
  const cids = new Set(realA.candidates.map(x => x.id)), rest = realA.dayOrders.filter(o => !cids.has(o.id)), c65 = realA.candidates.find(x => x.ticket === '65');
  ok(realA.dayOrders.length === 101 && await page.locator('.opick .ocand').count() === realA.candidates.length && (await page.locator('.opick .ocand', { hasText: 'Ticket 65' }).innerText()).includes(c65.why[0]), `Change order: ${realA.candidates.length} ranked matches first, with their reasons`);
  ok(await page.locator('#ordList .orow').count() === rest.length && (await txt(page, '#ordN')) === String(rest.length) && await page.locator('#ordPick [data-oid=""]', { hasText: 'No order' }).count() === 1, `then the other ${rest.length} orders of the day, then No order`);
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.mouse.move(0, 0);
  await page.locator('#src-order').screenshot({ path: path.join(SH, 'chats-change-order.png') });
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
  const rg = await page.evaluate(n => window.__prompts.slice(n).filter(p => /You are Swift Coach/.test(p.input)).map(p => p.input), pq);
  const rgc = rg.length ? rg[0].slice(rg[0].indexOf("QA LEAD'S CORRECTIONS")) : '';
  ok(rg.length === 1 && rgc.includes(NOTE) && rgc.includes(NF.label) && rgc.indexOf(NOTE) < rgc.indexOf(LS_NEW.note), "after a re-grade the new correction is in the grade prompt, newest first");
  ok(rgc.includes(`Resolution accuracy · ${amtF.type} (compensation case): the coach gave 1/3, the QA lead says 3/3. Why: ${WHY}`) && rgc.includes(`the QA lead says ${CTO}/${CR.max}. Why: ${WHY2}`), "the re-grade's prompt has the contests: the coach gave X, the QA lead says Y. Why: …");
  ok((await txt(page, '.ordcard')).includes('Ticket ' + tgt.ticket) && await page.locator('#src-order .ttag', { hasText: 'Your pick' }).count() === 1, 'the picked order is linked as your pick');
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
  ok(await page.locator('.ordcard').count() === 0 && (await txt(page, '#src-order')).includes('No order linked') && await page.locator('#src-order .ttag', { hasText: 'Your pick' }).count() === 1, 'No order: re-graded, the money card is gone');
  cs = await caches(page, pq); ok(cs.length === 4 && cs.every(c => c === false), 'No order re-grades with cache:false');
  ok(await page.locator('#src-calls .txcall').count() === 0, 'no order, no recordings');
  ok((await txt(page, '#cTicket')).includes('No order linked') && (await txt(page, '#cTicket')).includes('None linked') && /Can't check/.test(await txt(page, '#tkComp .tkst')), "the ticket after No order: no order, no recordings, the comp check can't check");
  // un-mark Not a mistake and save: the correction is deleted, the mark goes back
  ok(await page.locator(`#tf-${NF.id}.not`).count() === 1, 'the saved mark survives a re-grade');
  await page.click(`#tf-${NF.id} [data-fmark="not"]`); await page.waitForTimeout(100);
  ok(await page.locator(`#tf-${NF.id}.not`).count() === 0 && (await txt(page, `#tf-${NF.id} .tkscore`)) === `${markL(NF.score)}/${NR.max}`, `un-marking puts ${NF.label} back to ${markL(NF.score)}`);
  ok(await page.locator(`#cc-${CF.id}.contested`).count() === 1 && (await txt(page, `#tf-${CF.id} .tkscore`)) === `${CTO}/${CR.max}`, 'the saved contest survives a re-grade');
  await page.click(`[data-contest="${CF.id}"][data-where="row"]`); await page.waitForTimeout(80);
  ok((await page.locator('#cbWhy').inputValue()) === WHY2 && await page.locator('#cbWithdraw').isVisible(), 'reopening a contest shows its reason and Withdraw');
  const nLs = await count(page, 'chatLessons');
  await page.click('#cbWithdraw'); await page.waitForTimeout(150);
  ok(!(await page.evaluate(p => window.__data[p], `chatLessons/${SID}_${CF.id}`)) && await count(page, 'chatLessons') === nLs - 1, 'Withdraw unlearns a submitted contest at once');
  ok(await page.locator(`#cc-${CF.id}.contested`).count() === 0 && await page.locator(`[data-cm="${CF.id}"][data-v="${CF.score}"][aria-pressed="true"]`).count() === 1 && await page.locator('#cbox').count() === 0, `Withdraw puts ${CF.label} back on Claude's ${CF.score}`);
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
  await page.waitForFunction(n => window.__prompts.length >= n + 4 && !chatRun && !document.querySelector('#chatSteps'), pq, { timeout: 20000 }); await page.waitForTimeout(100);
  cs = await caches(page, pq); ok(cs.length === 4 && cs.every(c => c === false), 'Re-grade asks Claude fresh (cache:false)');
  await page.click('#coachCopy'); await page.waitForTimeout(150);
  ok(/Copied|Couldn't copy/.test(await txt(page, '#toast')), 'Copy gives feedback');
  const harbor = await page.evaluate(() => (Object.values(window.__data).find(d => d.restaurant === 'Harbor Crust' && d.grade) || {}).sid);
  await page.evaluate(s => openChat(s), harbor); await page.waitForTimeout(200);
  const hs = await page.evaluate(p => window.__data[p].slack, P('audits/' + harbor));
  ok(hs.length === 1 && hs[0].channel === 'pizza-support-ops' && hs[0].replies.length === 1 && await page.locator('#src-slack .task', { hasText: 'printer offline' }).count() === 1 && JSON.stringify(await page.locator('#evBrief li').allInnerTexts()) === JSON.stringify(W.chat.synth.facts.brief), 'Slack threads about the restaurant are linked; the brief shows as the case at a glance');
  ok(await page.evaluate(() => window.__slack.some(x => x.tool === 'slack_search_public' && x.input.keywords[0] === '"Harbor Crust"' && Number(x.input.before) > Number(x.input.after))), 'Slack search: restaurant name, day before to day after');
  await page.evaluate(p => window.claude.use('db').then(db => db.doc(p).get().then(d => { const a = d.data(); a.analysis.caseNotes = { kind: 'repeat', count: 2 }; return db.doc(p).set(a) })), P('audits/' + SID));
  await page.evaluate(s => openChat(s), SID); await page.waitForTimeout(250);
  const an = await txt(page, '#evStrip');
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
  ok(await page.evaluate(() => [...document.querySelectorAll('#view-chat .fixcard, #view-chat .srcf, #evStrip')].every(e => e.getBoundingClientRect().right <= 390)), '390px: evidence strip, sources and coaching cards fit');
  await shot(page, 'audit-390.png', true);
  await page.click('[data-tab="chats"]'); await page.waitForTimeout(200);
  ok(await width(page) <= 390, `390px queue: no horizontal overflow (${await width(page)})`);
  await shot(page, 'chats-queue-390.png');
  await page.click('[data-tab="brain"]'); await page.waitForTimeout(200);
  ok(await width(page) <= 390, `390px brain: no horizontal overflow (${await width(page)})`);
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(150);

  // ===== 10. Brain: policy, calibration cases, staff, rubric
  ok(await sel(page) === 'brain' && (await page.locator('#polText').inputValue()).length > 200 && await page.locator('#brRubric .rbr:not(.rbh)').count() === 9, 'Brain shows the policy text and the 9-row rubric');
  ok(await page.locator('#brCal .calitem').count() === 2 && await page.locator('#brStaff .srow:not(.srh)').count() === 4, 'Brain lists 2 calibration cases and the staff directory');
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

  ok(await page.locator('#brCal [data-caldel], #brCal .danger').count() === 0, 'calibration cases are read-only in Brain');
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
    let good = (['results', 'data'].includes(t) ? await page.locator(`[data-area="${t}"][aria-current="page"]`).count() === 1 && !(await page.locator('[role=tab][data-tab][aria-selected="true"]').count()) : await sel(page) === t) && await page.locator(view).isVisible();
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

  // ===== 13. Learning: the teacher/student loop on an invented week (14 graded chats, 6 SAs, checkpoint cp0)
  const LW = addD(WEEK, -14), LWo = learnWorld(LW), audOf = sid => LWo.list.find(x => x.sid === sid);
  ({ page, ctx, errors } = await openPage(b, seed.concat(LWo.seed), { viewer: true, sampleMs: 30 }, { width: 1280, height: 900 }, more));
  await page.goto('http://qa.test/#learn'); await page.waitForTimeout(500);
  const state = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__data['learning/state'])));
  ok(await sel(page) === 'learn' && /No round yet/.test(await txt(page, '#lrRound')) && await page.locator('#lrCps .cprow').count() === 1 && await page.locator('#lrChart').isHidden(), 'Learning: no round yet, one checkpoint, no chart');
  await page.click('#lrDraw');
  await page.waitForFunction(() => (window.__data['learning/state'].rounds || []).length === 1 && document.querySelectorAll('#lrRound .lrrow').length === 10, null, { timeout: 5000 });
  let st = await state(), r1 = st.rounds[0];
  const bySA = {}; r1.sample.forEach(x => bySA[x.sa] = (bySA[x.sa] || 0) + 1);
  ok(r1.round === 1 && r1.status === 'open' && r1.sample.length === 10 && new Set(r1.sample.map(x => x.sid)).size === 10, 'Draw 10: ten distinct chats, round 1 open');
  ok(Object.keys(bySA).length === 6 && Object.values(bySA).every(k => k >= 1 && k <= 2), `spread across the 6 SAs, 1–2 each (${Object.values(bySA).join(' ')})`);
  ok(!r1.sample.some(x => x.sid === LWo.reviewed.sid || x.sid === LWo.marked.sid), 'excludes the marked chat and the one already reviewed');
  ok(r1.sample.every(x => { const a = audOf(x.sid); return x.aiPct === a.pct && x.aiVerdict === a.verdict && JSON.stringify(x.aiScores) === JSON.stringify(a.scores) && x.sa === a.sa && x.restaurant === a.restaurant }) && r1.checkpoint === 'cp0' && st.currentCheckpoint === 'cp0' && st.week === LW && JSON.stringify(st.marked) === JSON.stringify([LWo.marked.sid]),
    "the state keeps Claude's score, verdict and marks at draw time, the checkpoint and the week");
  ok((await txt(page, '#lrRound .lrprog')).replace(/\s+/g, ' ').startsWith('0 of 10 reviewed') && await page.locator('#lrDraw').isDisabled() && await page.locator('#st-learn').innerText() === '0/10', 'progress 0 of 10; Draw is off while the round is open; the tab shows 0/10');
  // review the 10: three with a contest on Gathered the evidence (to 0), the rest as Claude graded them
  const WHYL = 'The SA set the hours without checking the current schedule first.';
  for (let i = 0; i < 10; i++) { const x = r1.sample[i];
    await page.click('[data-tab="learn"]'); await page.waitForTimeout(120);
    await page.click(`#lrRound [data-lopen="${x.sid}"]`); await page.waitForTimeout(250);
    if (i === 0) {
      ok(await sel(page) === 'chat' && await page.evaluate(() => location.hash) === `#chat/${LW}/${x.sid}` && (await txt(page, '#tkRound')).replace(/\s+/g, ' ').includes(`Round 1 Sampled chat Claude's score at draw: ${fmt(x.aiPct)}% ${vLabel(x.aiVerdict)}`), "a sampled chat opens on its week with the banner: Round 1 · Claude's score at draw");
      await page.click('[data-tab="chats"]'); await page.waitForTimeout(200);
      ok(await page.locator('.crow .rndchip').count() === 10 && (await txt(page, `.crow[data-open="${x.sid}"] .rndchip`)) === 'Round 1' && await page.locator('.crow .rndchip.done').count() === 0, 'queue: the 10 sampled chats wear a Round 1 chip');
      await page.click(`.crow[data-open="${x.sid}"] .clink`); await page.waitForTimeout(200) }
    if (i < 3) { await page.click('[data-cm="ev"][data-v="0"]'); await page.fill('#cbWhy', WHYL); await page.click('#cbSave');
      await page.waitForFunction(p => !!window.__data[p], `chatLessons/${x.sid}_ev`, { timeout: 3000 });
      if (i === 0) { const L = await page.evaluate(p => window.__data[p], `chatLessons/${x.sid}_ev`);
        ok(L.kind === 'contest' && L.round === 1 && L.checkpoint === 'cp0' && L.from === `${x.aiScores.ev}/3` && L.to === '0/3' && L.reason === WHYL && L.sa === x.sa && L.week === LW, 'Submit on a sampled chat: the lesson carries round 1 and checkpoint cp0, written before Save review');
        await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; document.getElementById('cTicket').scrollIntoView({ block: 'start' }) }); await page.waitForTimeout(100);
        await page.screenshot({ path: path.join(SH, 'learning-audit-banner.png') }) } }
    await page.click('#chatSave');
    await page.waitForFunction(([p, k]) => !!window.__data[p] && (window.__data['learning/state'].rounds[0].results || []).length === k, [`chatWeeks/${LW}/reviews/${x.sid}`, i + 1], { timeout: 5000 });
    if (i === 0) ok(/ · Round 1: 1 of 10/.test(await txt(page, '#toast')), 'the save toast counts the round: Round 1: 1 of 10') }
  st = await state(); r1 = st.rounds[0];
  const revs = await page.evaluate(w => Object.fromEntries(Object.entries(window.__data).filter(([p]) => p.startsWith(`chatWeeks/${w}/reviews/`)).map(([p, d]) => [p.split('/').pop(), d])), LW);
  const exp = r1.sample.map(x => { const v = revs[x.sid]; return { d: Math.round((v.pct - x.aiPct) * 10) / 10, m: v.verdict === x.aiVerdict } });
  const expM = exp.filter(e => e.m).length, expD = Math.round(exp.reduce((t, e) => t + Math.abs(e.d), 0) / 10 * 10) / 10;
  ok(r1.status === 'done' && r1.results.length === 10 && r1.results.every((x, i) => x.sid === r1.sample[i].sid && x.yourPct === revs[x.sid].pct && x.yourVerdict === revs[x.sid].verdict && x.aiPct === r1.sample[i].aiPct && x.diff === exp[i].d && x.match === exp[i].m), 'each review fills the round results: Claude at draw, yours, the difference, match');
  ok(r1.verdictMatch === expM && expM === 7 && r1.meanAbsDiff === expD && r1.pass === false, `round 1: ${r1.verdictMatch} of 10 verdicts, ${r1.meanAbsDiff} pts average difference, not a pass`);
  ok(new Set(st.marked).size === 11 && r1.sample.every(x => st.marked.includes(x.sid)), 'the 10 reviewed chats join the marked list');
  await page.click('[data-tab="chats"]'); await page.waitForTimeout(200);
  ok(await page.locator('.crow .rndchip.done').count() === 10 && (await txt(page, `.crow[data-open="${r1.sample[0].sid}"] .rndchip`)) === 'Round 1 ✓', 'queue: reviewed sampled chats show Round 1 ✓');
  await page.click('[data-tab="learn"]'); await page.waitForTimeout(200);
  const rr = (await txt(page, '#lrResult')).replace(/\s+/g, ' ');
  ok(rr.includes('FAIL') && rr.includes('Verdicts 7 of 10') && rr.includes(`Average difference ${fmt(expD)} pts`) && rr.includes('Streak 0 of 2') && (await txt(page, '#lrNext')) === 'Round done. Ask Claude to regrade all 14 with what it learned.', 'round card: FAIL, 7 of 10, the average difference, streak 0 of 2, and the regrade line');
  ok(await page.locator('#lrRound .lrrow.miss').count() === 3 && (await txt(page, `#lrRound .lrrow:has([data-lopen="${r1.sample[0].sid}"]) .lrd`)).startsWith('−') && await page.locator('#lrDraw').isEnabled(), 'the three mismatches stand out with their differences; Draw is back on');
  await shot(page, 'learning-round.png', true);
  // the main session regrades: checkpoint cp1 lands (brainRuns/cp1 + grades), audits move to cp1, one chat's score moves
  const moved = (r1.sample.find(x => x.aiPct > 80) || r1.sample[0]).sid;
  await page.evaluate(([lw, list, moved]) => window.claude.use('db').then(async db => {
    const v = {}; list.forEach(x => v[x.verdict] = (v[x.verdict] || 0) + 1);
    await db.doc('brainRuns/cp1').set({ id: 'cp1', round: 1, at: new Date(Date.parse(lw) + 9 * 864e5).toISOString(), brain: 'chat-2', model: 'test-model', week: lw, chats: list.length, graded: list.length, avgPct: 88.1, verdicts: v, perSA: {}, lessonsUsed: 5, learned: [{ kind: 'lesson', text: 'Check the current schedule before changing hours.', sid: moved, crit: 'ev' }], notes: '' });
    for (const x of list) { const g = Object.assign({}, x, x.sid === moved ? { pct: 72.7, verdict: 'okay' } : {}); delete g.scores; await db.doc(`brainRuns/cp1/grades/${x.sid}`).set(Object.assign(g, { priority: null, caseType: 'hours_service', fault: 'none' }));
      const p = `chatWeeks/${lw}/audits/${x.sid}`, a = (await db.doc(p).get()).data(); a.checkpoint = 'cp1'; await db.doc(p).set(a) } }), [LW, LWo.list, moved]);
  await page.waitForTimeout(250);
  ok(await page.locator('#lrCps .cprow').count() === 2 && (await txt(page, '#lrCps .cprow[data-cp="cp0"] .cpagree')).replace(/\s+/g, ' ').includes('7 of 10 verdicts'), 'a new checkpoint shows up; cp0 carries round 1\'s agreement');
  // round 2: only the 2 chats never marked or reviewed are left
  await page.click('#lrDraw');
  await page.waitForFunction(() => (window.__data['learning/state'].rounds || []).length === 2, null, { timeout: 5000 });
  st = await state(); const r2 = st.rounds[1], seen1 = new Set(r1.sample.map(x => x.sid).concat([LWo.reviewed.sid, LWo.marked.sid]));
  ok(r2.round === 2 && r2.sample.length === 2 && r2.sample.every(x => !seen1.has(x.sid)) && r2.checkpoint === 'cp1' && st.currentCheckpoint === 'cp1', 'a second Draw takes only chats never marked (2 left), on checkpoint cp1');
  for (const x of r2.sample) { await page.click(`#lrRound [data-lopen="${x.sid}"]`); await page.waitForTimeout(250); await page.click('#chatSave');
    await page.waitForFunction(p => !!window.__data[p], `chatWeeks/${LW}/reviews/${x.sid}`, { timeout: 5000 }); await page.waitForTimeout(150); await page.click('[data-tab="learn"]'); await page.waitForTimeout(150) }
  st = await state();
  ok(st.rounds[1].status === 'done' && st.rounds[1].verdictMatch === 2 && st.rounds[1].meanAbsDiff === 0 && st.rounds[1].pass === true, 'round 2: 2 of 2, 0 pts, a pass');
  const rr2 = (await txt(page, '#lrResult')).replace(/\s+/g, ' ');
  ok(rr2.includes('PASS') && rr2.includes('Verdicts 2 of 2') && rr2.includes('need 2') && rr2.includes('Streak 1 of 2'), 'round card: PASS, the bar scales to the sample, streak 1 of 2');
  ok(await page.locator('#lrChart').isVisible() && await page.locator('#lrChartV circle:not(.lrhit)').count() === 2 && await page.locator('#lrChartD circle:not(.lrhit)').count() === 2 && await page.locator('#lrChart .lrtgt').count() === 2, 'two finished rounds: the agreement charts (verdicts, difference), each with its target');
  await page.click('#lrDraw'); await page.waitForTimeout(250);
  ok((await state()).rounds.length === 2 && /No chats left to sample/.test(await txt(page, '#lrRound')), 'nothing left: Draw says so and writes nothing');
  // checkpoints history: newest first; expand cp0 for what it learned and per SA
  const cpr = await page.locator('#lrCps .cprow').evaluateAll(x => x.map(d => d.dataset.cp));
  ok(JSON.stringify(cpr) === '["cp1","cp0"]' && (await txt(page, '#lrCps .cprow[data-cp="cp1"] .cpagree')).replace(/\s+/g, ' ').includes('2 of 2 verdicts'), 'checkpoints newest first; cp1 shows round 2\'s agreement');
  const c0 = (await txt(page, '#lrCps .cprow[data-cp="cp0"] summary')).replace(/\s+/g, ' ');
  ok(c0.includes(LWo.cp0.avgPct.toFixed(1) + '%') && /LESSONS USED 2\b/i.test(c0), 'cp0 row: average and lessons used');
  ok(Object.entries(LWo.cp0.verdicts).every(([k, v]) => c0.includes(`${vLabel(k)} ${v}`)), 'cp0 row: the verdict mix');
  await page.click('#lrCps .cprow[data-cp="cp0"] summary'); await page.waitForTimeout(120);
  const cb = (await txt(page, '#lrCps .cprow[data-cp="cp0"] .cpbody')).replace(/\s+/g, ' ');
  ok(LWo.cp0.learned.every(l => cb.includes(l.text)) && await page.locator('#lrCps .cprow[data-cp="cp0"] .cpsr:not(.cpsh)').count() === 6 && cb.includes('Faye Lund') && cb.includes(LWo.cp0.notes), 'expanding cp0: what it learned in this pass, the notes, per-SA averages');
  await page.evaluate(() => document.getElementById('lrChart').scrollIntoView({ block: 'start' })); await page.waitForTimeout(100);
  await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.screenshot({ path: path.join(SH, 'learning-history.png'), fullPage: true });
  // one chat's history: cp0 → cp1 and Patrick's review
  await page.selectOption('#lrPick', moved);
  await page.waitForFunction(() => document.querySelectorAll('#lrHist .chr:not(.chh)').length === 3, null, { timeout: 5000 });
  const hr = await page.locator('#lrHist .chr:not(.chh)').allInnerTexts(), mv = audOf(moved);
  ok(hr[0].includes('cp0') && hr[0].includes(fmt(mv.pct) + '%') && hr[1].includes('cp1') && hr[1].includes('72.7%') && hr[1].includes(`−${fmt(mv.pct - 72.7)}`) && hr[2].includes('Your review') && hr[2].includes(fmt(revs[moved].pct) + '%'), 'chat history: the grade at cp0 and cp1, how it moved, and your review');
  await page.locator('#lrChat').screenshot({ path: path.join(SH, 'learning-chat.png') });
  // dark and phone
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(120);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('#lrRound')).backgroundColor) !== 'rgb(255, 255, 255)' && await page.evaluate(() => getComputedStyle(document.querySelector('.lrline')).stroke) === 'rgb(167, 139, 250)', 'dark: Learning takes the dark tokens');
  await shot(page, 'learning-dark.png', true);
  for (const wd of [390, 900]) { await page.setViewportSize({ width: wd, height: 860 }); await page.waitForTimeout(150); ok(await width(page) <= wd, `${wd}px Learning (dark): no horizontal overflow (${await width(page)})`) }
  await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(100);
  ok(await width(page) <= 900, '900px Learning (light): no overflow');
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
  ok(await width(page) <= 390, `390px Learning (light): no horizontal overflow (${await width(page)})`);
  await shot(page, 'learning-390.png', true);
  await page.click(`#lrRound [data-lopen="${r2.sample[0].sid}"]`); await page.waitForTimeout(250);
  ok(await width(page) <= 390 && await page.locator('#tkRound').count() === 0, '390px audit of a chat in a finished round: no banner, no overflow');
  ok(!errors.length, 'no console errors (learning) ' + JSON.stringify(errors));
  await ctx.close();

  // ===== 8. Reinforce (Claude's mark is right, its reason isn't) and order status
  { const RW = addD(WEEK, -21), R = reinforceWorld(RW), RS = R.sid, LP = `chatLessons/${RS}_ev`, LT = `chatLessons/${RS}_tone`;
    ({ page, ctx, errors } = await openPage(b, R.seed, { sampleMs: 30 }, { width: 1280, height: 900 }, { now: NOW }));
    await page.goto('http://qa.test/'); await page.waitForTimeout(400);
    await page.evaluate(([s, w]) => openChat(s, w), [RS, RW]); await page.waitForSelector('#cTicket'); await page.waitForTimeout(250);
    const pct0 = await txt(page, '#tkPct');
    ok(await page.locator('.ccrit [data-reinforce][data-where="row"]').count() === 9 && await page.locator('.tkfind [data-reinforce][data-where="find"]').count() === 2, 'every scorecard row and every finding with a criterion has Reinforce');
    ok(await page.evaluate(() => [...document.querySelectorAll('.tkfind .tkact')].every(g => { const b = [...g.querySelectorAll('button')].map(x => x.textContent); return b.indexOf('Reinforce') === b.indexOf('Contest') + 1 })), 'Reinforce sits next to Contest');
    // open from the finding card: the mark is locked to Claude's, Submit needs a better reason
    await page.click('#tf-ev [data-reinforce]'); await page.waitForTimeout(150);
    ok(await page.locator('#tf-ev #cbox').isVisible() && (await page.locator('#tf-ev [data-reinforce]').getAttribute('aria-expanded')) === 'true' && (await page.locator('#tf-ev [data-contest]').getAttribute('aria-expanded')) === 'false', 'Reinforce opens the box in the finding card');
    ok(await page.evaluate(() => { const b = [...document.querySelectorAll('#cbox [data-cv]')]; return b.length === 4 && b.every(x => x.disabled) && b.filter(x => x.getAttribute('aria-pressed') === 'true').map(x => x.dataset.cv).join() === '2' }), "the mark is locked to Claude's 2");
    ok((await page.locator('#cbox label[for="cbWhy"]').textContent()) === 'Better reason' && await page.locator('#cbSave').isDisabled(), 'label Better reason; Submit off until it is filled');
    ok((await txt(page, '#chpVia')) === 'REINFORCE' && (await txt(page, '#chpTitle')) === 'Gathered the evidence', 'the side panel opens with the header Reinforce');
    await page.fill('#cbWhy', '   '); ok(await page.locator('#cbSave').isDisabled(), 'blank reason: Submit stays off');
    await page.locator('#cbox [data-cv="3"]').click({ force: true }); await page.waitForTimeout(60);
    ok(await page.evaluate(() => document.querySelector('#cbox [data-cv="2"]').getAttribute('aria-pressed')) === 'true', 'clicking another mark does nothing');
    const WHYR = 'Two points is right, but because no pickup window was checked, not the order itself.';
    await page.fill('#cbWhy', WHYR); ok(await page.locator('#cbSave').isEnabled(), 'a reason turns Submit on');
    await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.screenshot({ path: path.join(SH, 'reinforce-box.png') });
    await page.locator('#tf-ev').screenshot({ path: path.join(SH, 'reinforce-finding.png') });
    await page.click('#cbSave');
    await page.waitForFunction(p => !!window.__data[p], LP, { timeout: 3000 });
    const L1 = await page.evaluate(p => window.__data[p], LP);
    ok(L1.kind === 'reinforce' && L1.from === '2/3' && L1.to === '2/3' && L1.reason === WHYR && L1.what === 'Voided O1 without checking the pickup time first (F2).' && L1.crit === 'ev' && L1.label === 'Gathered the evidence' && L1.type === 'Did not check the order' && L1.caseType === 'order_issue' && L1.sid === RS && L1.sa === 'Ivo Lark' && !isNaN(Date.parse(L1.at)),
      'Submit writes chatLessons/<sid>_ev at once: kind reinforce, from = to = 2/3, the reason, what, crit, label, type, caseType');
    ok((await txt(page, '#tkPct')) === pct0 && await page.evaluate(s => chatDraft(s).scores.ev, RS) === 2 && await page.locator('#cbox').count() === 0 && !(await page.evaluate(() => !!(chPanel))), 'the score does not move; the box and the panel close');
    ok((await txt(page, '#tf-ev .tkrei')) === 'REINFORCED' && (await txt(page, '#tf-ev .tkrei-why')).includes(WHYR) && (await txt(page, '#tf-ev .tkrei-why')).includes('Submitted · learned') && (await txt(page, '#cc-ev .crei')) === 'REINFORCED' && (await txt(page, '#cc-ev .crei-why')).includes(WHYR),
      'the finding and the row show Reinforced and the better reason');
    ok(await page.evaluate(s => JSON.stringify(chatDraft(s).reinforce), RS) === JSON.stringify({ ev: { reason: WHYR } }), 'the draft keeps d.reinforce[crit] = {reason}');
    ok((await page.evaluate(() => { const s = String(chatSel); return chTicketText(chatBy(s), chatAud[s], chatDraft(s)) })).includes('   Better reason: ' + WHYR), 'the copied ticket carries the better reason');
    // from a scorecard row, then withdraw: the draft entry and the lesson go
    await page.click('#cc-tone [data-reinforce]'); await page.waitForTimeout(120);
    ok(await page.locator('#cc-tone #cbox.rei').isVisible() && (await txt(page, '#chpVia')) === 'REINFORCE', 'Reinforce from a row opens the box and the panel');
    await page.fill('#cbWhy', 'Brief is fine; the miss is the refund not being named.'); await page.click('#cbSave');
    await page.waitForFunction(p => !!window.__data[p], LT, { timeout: 3000 });
    await page.click('#cc-tone [data-reinforce]'); await page.waitForTimeout(120);
    ok((await page.locator('#cbWhy').inputValue()).startsWith('Brief is fine') && await page.locator('#cbWithdraw').isVisible(), 'reopening shows the reason and Withdraw');
    await page.click('#cbWithdraw'); await page.waitForFunction(p => !window.__data[p], LT, { timeout: 3000 });
    ok(await page.locator('#cc-tone .crei').count() === 0 && await page.locator('#cbox').count() === 0 && await page.evaluate(s => !chatDraft(s).reinforce.tone, RS) && await page.evaluate(p => !!window.__data[p], LP), 'Withdraw removes the draft entry and deletes that lesson only');
    // Save review keeps it; a reload brings it back from the review
    await page.click('#chatSave'); await page.waitForFunction(p => !!window.__data[p], `chatWeeks/${RW}/reviews/${RS}`, { timeout: 3000 }); await page.waitForTimeout(150);
    const rvR = await page.evaluate(p => window.__data[p], `chatWeeks/${RW}/reviews/${RS}`), L2 = await page.evaluate(p => window.__data[p], LP);
    ok(JSON.stringify(rvR.reinforce) === JSON.stringify({ ev: { mark: '2/3', reason: WHYR } }) && JSON.stringify(rvR.contests) === '{}' && rvR.scores.ev === 2 && L2 && L2.kind === 'reinforce' && L2.at === L1.at, 'Save review stores reinforce {mark, reason} and keeps the lesson (same date)');
    // a reload (the mock store doesn't survive one): drop the working copy and what this session submitted, so both come back from the review and chatLessons
    await page.evaluate(() => { chatDrafts.clear(); chSubmitted.clear(); renderChatAudit(true) }); await page.waitForTimeout(150);
    ok((await txt(page, '#tf-ev .tkrei')) === 'REINFORCED' && (await txt(page, '#tf-ev .tkrei-why')).includes(WHYR) && (await txt(page, '#tf-ev .tkrei-why')).includes('Submitted · learned'), 'after a reload the finding is still Reinforced (from the review), and learned (from chatLessons)');
    // Learning tab list
    await page.click('[data-tab="brain"]'); await page.waitForTimeout(250);
    const li = (await page.locator('#brLessons .lsitem.reinforce').allInnerTexts()).map(t => t.replace(/\s+/g, ' '));
    ok(li.length === 1 && li[0].includes('Gathered the evidence') && /REINFORCED/i.test(li[0]) && li[0].includes('2/3') && li[0].includes(WHYR) && /Better reason/i.test(li[0]), 'What the coach learned lists it as Reinforced, the mark and the better reason');
    // withdraw after reload: the lesson goes
    await page.evaluate(([s, w]) => openChat(s, w), [RS, RW]); await page.waitForSelector('#tf-ev'); await page.click('#tf-ev [data-reinforce]'); await page.waitForTimeout(120); await page.click('#cbWithdraw');
    await page.waitForFunction(p => !window.__data[p], LP, { timeout: 3000 });
    ok(await page.locator('#tf-ev .tkrei').count() === 0, 'Withdraw after a reload deletes the lesson doc');
    // contest on a reinforced criterion replaces it
    await page.click('#tf-tone [data-reinforce]'); await page.fill('#cbWhy', 'Right mark, wrong reason.'); await page.click('#cbSave'); await page.waitForFunction(p => (window.__data[p] || {}).kind === 'reinforce', LT, { timeout: 3000 });
    await page.click('#tf-tone [data-contest]'); await page.locator('#cbox [data-cv="3"]').click(); await page.fill('#cbWhy', 'It was clear enough.'); await page.click('#cbSave');
    await page.waitForFunction(p => (window.__data[p] || {}).kind === 'contest', LT, { timeout: 3000 });
    ok(await page.locator('#tf-tone .tkrei').count() === 0 && await page.locator('#tf-tone [data-reinforce]').count() === 0 && (await txt(page, '#tf-tone .tkcon')) === 'CONTESTED', 'a contest replaces the reinforce; a contested finding has no Reinforce');
    // ----- order status
    const ordLine = (await page.locator('.tkgrid .tkf', { hasText: 'Order' }).first().innerText()).replace(/\s+/g, ' ');
    ok(ordLine.includes('Voided · No pick up') && ordLine.includes('Refunded $24.50 (full)'), 'the ticket Order line: Voided · No pick up, Refunded $24.50 (full)');
    await page.click('#src-order summary'); await page.waitForTimeout(150);
    const cards = await page.locator('#src-order .ordcard').allInnerTexts();
    ok(cards.length === 2 && cards[0].includes('Voided · No pick up') && !cards[0].includes('Refunded') && cards[1].includes('Refunded $24.50 (full)') && !cards[1].includes('Voided'), 'order cards: the voided one shows Voided · No pick up, the refunded one Refunded $24.50 (full)');
    ok(await page.locator('#src-order .ordcard .ostat').count() === 2, 'nothing for a submitted order with no refund');
    await page.locator('#src-order .ordcard').first().scrollIntoViewIfNeeded(); await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true });
    await page.locator('#src-order').screenshot({ path: path.join(SH, 'order-voided.png') });
    await page.click('#ordChange'); await page.waitForTimeout(200);
    const rows = await page.evaluate(() => [...document.querySelectorAll('#ordList .orow')].map(r => [r.querySelector('.otk').textContent, (r.querySelector('.ostat') || {}).textContent || '']));
    ok(JSON.stringify(rows) === JSON.stringify([['#4472', 'Voided'], ['#4473', ''], ['#4474', '']]), 'day order rows: Voided only, no Draft tag');
    await page.click('#ordCancel').catch(() => {}); await page.waitForTimeout(100);
    // dark and phone
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(100);
    ok(await page.evaluate(() => getComputedStyle(document.querySelector('.ordcard .ostat')).color) === 'rgb(248, 113, 113)', 'dark: the status tag takes the dark tokens');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
    await page.click('#tf-ev [data-reinforce]'); await page.waitForTimeout(250);
    ok(await width(page) <= 390 && await page.evaluate(() => document.getElementById('cbox').getBoundingClientRect().right <= 390), `390px: the reinforce box and order tags fit (${await width(page)})`);
    await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.screenshot({ path: path.join(SH, 'reinforce-390.png') });
    ok(!errors.length, 'no console errors (reinforce, orders) ' + JSON.stringify(errors));
    await ctx.close() }
  ok(!allErrors.length, 'no console errors (routes) ' + JSON.stringify(allErrors));
  await b.close(); console.log(`ui chats: ${n} checks passed`);
})().catch(e => { console.error('TEST FAILED', e); process.exit(1) });
