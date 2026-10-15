// Calibration: three graders (Pat, Howard, Li Qi; all invented) mark the same items blind, reveal per person, compare, settle rows, lock the agreed score.
// Chats come from an open Learning round (learnWorld, invented); calls from an invented week of the call queue. Rules checked against the mock's access rules:
// a draft under data/users/<id> is private, calibMarks/<uid> is written by <uid> only.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), assert = require('assert');
const { openPage, learnWorld, DIR } = require('./mock.js');
const B = require('../src/chat.js');
const RV1 = JSON.parse(fs.readFileSync(path.join(DIR, 'src/rubric_v1.json'), 'utf8'));
const SH = path.join(DIR, 'shots'); fs.mkdirSync(SH, { recursive: true });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('ok -', m) };
const fmt = p => (Math.round(p * 10) / 10).toFixed(1);
const PAT = 'u_test', HOW = 'u_howard', LIQ = 'u_liqi', people = { [PAT]: 'Pat', [HOW]: 'Howard', [LIQ]: 'Li Qi' };
const LW = '2026-10-05', NOW = '2026-10-14T16:00:00Z';
const L = learnWorld(LW);
// the open round: ten chats never reviewed or marked, one with Claude at ev 3 / path 3 first
const pool = L.list.filter(x => x.sid !== L.reviewed.sid && x.sid !== L.marked.sid);
const first = pool.find(x => x.scores.ev === 3 && x.scores.path === 3), rest = pool.filter(x => x !== first).slice(0, 9);
const sample = [first].concat(rest).map(x => ({ sid: x.sid, sa: x.sa, restaurant: x.restaurant, aiPct: x.pct, aiVerdict: x.verdict, aiScores: x.scores }));
const S0 = sample[0].sid, S1 = sample[1].sid, IK = 'chat_' + S0;
const state = { week: LW, currentCheckpoint: 'cp0', target: { verdicts: 8, pts: 5, streak: 2 }, marked: [L.marked.sid], rounds: [{ round: 1, checkpoint: 'cp0', drawnAt: LW + 'T12:00:00.000Z', status: 'open', sample, results: [], verdictMatch: null, meanAbsDiff: null, pass: null }] };
const base = { fr: 3, ev: 1, rs: 3, fa: 'na', path: 3, amt: 'na', expl: 'na', esc: 'na', tone: 3 };
const howM = Object.assign({}, base, { ev: 2, path: 2 }), liqM = Object.assign({}, base, { rs: 2 });
// twelve invented calls across four SAs, each with facts read
const AG = ['Ana Ruiz', 'Ben Okafor', 'Cleo Marsh', 'Dev Patel'];
const calls = []; for (let i = 0; i < 12; i++) { const id = 'qcal' + String(i + 1).padStart(2, '0'), cid = 'c0ffee00-0000-4000-8000-0000000000' + String(i + 10);
  calls.push(['queue/' + id, { agent: AG[i % 4], type: 'call', kind: 'CL', callDate: '2026-10-0' + (5 + (i % 4)), callTime: '1' + (i % 8) + ':15', restaurantId: 'R95' + String(i).padStart(3, '0'), restaurantName: `Sample Oven ${i + 1}`,
    callId: cid, durationSec: 240 + i * 10, link: `https://greendot.example.test/restaurant/R95${String(i).padStart(3, '0')}`, week: LW, pos: i, source: 'lightdash', removed: false, auditId: null, score: null,
    chain: { legs: [{ id: cid, at: `2026-10-0${5 + (i % 4)}T1${i % 8}:15:00`, sec: 240 + i * 10, who: AG[i % 4], own: true, graded: true, sampled: true, dir: 'in' }], count: 1, agents: 1 },
    aiFacts: { summary: 'The caller says a pickup order was not ready on time.', rootCause: 'Ticket did not print', facts: { calls: {}, timeline: [{ id: 'F1', src: 'Call 1', when: '0:12', who: 'Caller', kind: 'said', what: 'Says the pickup order was not ready 20 minutes after the quoted time' }, { id: 'F2', src: 'Call 1', when: '1:40', who: AG[i % 4], kind: 'did', what: 'Called the store, which said the ticket never printed' }], promises: [] } } }]) }
const seed = L.seed.filter(([p]) => p !== 'learning/state').concat([['learning/state', state],
  ['calibMarks/' + PAT, { joinedAt: '2026-10-12T09:00:00.000Z', lastSeen: '2026-10-12T09:00:00.000Z' }], ['calibMarks/' + HOW, { joinedAt: '2026-10-12T09:05:00.000Z', lastSeen: '2026-10-12T09:05:00.000Z' }],
  ['calibMarks/' + LIQ, { joinedAt: '2026-10-12T09:10:00.000Z', lastSeen: '2026-10-12T09:10:00.000Z' }],
  [`calibMarks/${HOW}/items/${IK}`, { kind: 'chat', key: S0, marks: howM, notes: { ev: 'Opened the schedule eventually, partial credit.', path: 'Should have confirmed the old hours first.' }, submittedAt: '2026-10-13T10:00:00.000Z', updatedAt: '2026-10-13T10:00:00.000Z' }],
  ['pulls/2026-10-05', { status: 'done', week: '2026-10-05', at: '2026-10-13T08:00:00.000Z', added: 12 }], ['pulls/2026-09-28', { status: 'done', week: '2026-09-28', at: '2026-10-05T08:00:00.000Z', added: 0 }]]).concat(calls);
const txt = (page, s) => page.locator(s).innerText();
const width = page => page.evaluate(() => document.documentElement.scrollWidth);
const D = (page, p) => page.evaluate(p => window.__data[p] ? JSON.parse(JSON.stringify(window.__data[p])) : null, p);
const waitDoc = (page, p, fn, t) => page.waitForFunction(([p, f]) => { const d = window.__data[p]; return f ? !!d && new Function('d', 'return ' + f)(d) : !!d }, [p, fn || ''], { timeout: t || 5000 });
const cell = (page, crit, i) => page.locator(`#cbr-${crit} > td`).nth(i);        // 0 Claude, 1 Pat, 2 Howard, 3 Li Qi (joined in that order)
const shot = async (page, name, full) => { await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.waitForTimeout(120); await page.screenshot({ path: path.join(SH, name), fullPage: !!full }) };
const gridShot = async (page, name) => { await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; document.getElementById('cs-score').scrollIntoView({ block: 'start' }) }); await page.waitForTimeout(120);
  await page.locator('#cs-score').screenshot({ path: path.join(SH, name) }) };
const asUser = (page, uid, op) => page.evaluate(([uid, op]) => window.__as(uid, async db => { try { await new Function('db', 'return (async () => {' + op + '})()')(db); return 'ok' } catch (e) { return e && e.code || String(e) } }), [uid, op]);

(async () => {
  const b = await chromium.launch();
  let { page, ctx, errors } = await openPage(b, seed, { people, room: true, sampleMs: 30 }, { width: 1280, height: 900 }, { now: NOW });
  await page.goto('http://qa.test/#calib'); await page.waitForTimeout(600);

  // ===== 1. the Calibration tab: the round, KPIs, presence
  const tabs = (await page.locator('#sub-chats [role=tab]').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  ok(tabs.length === 5 && ['Dashboard', 'Audit', 'Calibration', 'Learning', 'Brain'].every((x, i) => tabs[i].includes(x)), 'Chats steps: Dashboard, Audit, Calibration, Learning, Brain');
  ok((await txt(page, '#cbRound h2')) === 'Round 1' && await page.locator('#cbItems tbody tr').count() === 10 && await page.locator('#cbDraw').isDisabled(), "Calibration: Round 1, the round's 10 chats, Draw off while the round is open");
  ok((await txt(page, '#cbkAgreed b')) === '0 / 10' && (await txt(page, '#cbkTurn b')) === '10' && (await txt(page, '#st-calib')) === '10', 'KPIs: Agreed 0 / 10, Your turn 10 (also on the tab)');
  ok(await page.locator(`#cbItems tr[data-ik="${IK}"] .cbdot.done`).count() === 1 && (await txt(page, `#cbItems tr[data-ik="${IK}"] .pill`)) === 'Scoring' && (await txt(page, `#cbItems tr[data-ik="${IK}"] .cbdot.done`)) === 'H', "the list: Howard's dot is filled, stage Scoring");
  ok(await page.evaluate(() => (window.__presence || []).some(p => p.tab === 'calib' && p.item === null)), 'presence: the tab is sent');
  await page.evaluate(h => window.__peers([{ by: h, presence: { tab: 'calib', item: null } }]), HOW); await page.waitForTimeout(150);
  ok(/You and Howard are here/.test(await txt(page, '#cbRound .cbhd')), 'presence: "You and Howard are here" in the round header');

  // ===== 2. a chat in the round: the Audit shows the shared grid, blind
  await page.click(`[data-cb="open"][data-ik="${IK}"]`); await page.waitForTimeout(400);
  ok(await page.evaluate(() => tab) === 'chat' && await page.evaluate(() => location.hash) === `#chat/${LW}/${S0}` && await page.locator('#cbGrid').count() === 1, 'a round chat opens in Audit with the calibration grid');
  ok(await page.locator('.ccrit').count() === 0 && await page.locator('[data-contest],[data-reinforce]').count() === 0, 'no solo scorecard, no Contest or Reinforce on a round chat');
  ok(await page.evaluate(() => (window.__presence || []).some(p => p.tab === 'chat' && p.item)), 'presence: the item on screen is sent');
  await page.evaluate(([h, ik]) => window.__peers([{ by: h, presence: { tab: 'chat', item: ik } }]), [HOW, IK]); await page.waitForTimeout(150);
  ok(/You and Howard are here/.test(await txt(page, '#cbGrid .cbmeta')), "presence on the item's scorecard");
  ok((await txt(page, '#cbr-ev > td >> nth=0')).trim() === String(sample[0].aiScores.ev) && (await cell(page, 'ev', 2).innerText()).includes('✓ Scored') && (await cell(page, 'ev', 3).innerText()).includes('Not yet'), "blind: Claude's mark shows, Howard ✓ Scored, Li Qi Not yet");
  ok(await page.locator('#cbGrid [data-cb="peek"]').count() === 0 && await page.locator('#cbGrid [data-cb="submit"]').isDisabled() && (await txt(page, '#cbFilled')) === '0/9', 'no Reveal before you submit; Submit off at 0/9');
  ok(await page.locator('#tkFinds').count() === 0 && await page.locator('.tkfind').count() === 0, 'the ticket has no Findings section');
  ok(await page.locator('#evBrief li').count() >= 1 && await page.locator('#evBrief li').count() <= 5 && await page.locator('#evSrcs .evrow').count() >= 1 && await page.locator('#evFull').isHidden(), 'Evidence: What happened beside the source rows; full sources folded away');
  await page.click('#evMore'); await page.waitForTimeout(80);
  ok(await page.locator('#evFull').isVisible() && await page.locator('#evFull details.srcf').count() >= 2 && (await page.locator('#evMore').getAttribute('aria-expanded')) === 'true', 'Timeline and full sources opens the folds');
  await page.click('#evMore');
  // criterion → where the evidence is
  await page.click('#cbGrid [data-psrc="ev"]'); await page.waitForTimeout(200);
  ok(await page.locator('#chPanel').isVisible() && (await txt(page, '#chpTitle')) === 'Gathered the evidence' && (await page.locator('#cbGrid [data-psrc="ev"]').getAttribute('aria-expanded')) === 'true', "clicking a criterion's name opens its sources panel");
  await page.click('#chpClose'); await page.waitForTimeout(100);
  await gridShot(page, 'calib-scorecard-blind.png');

  // ===== 3. scoring: the draft is private, then Submit
  for (const [k, v] of Object.entries(base)) await page.click(`#cbGrid [data-cb="pick"][data-crit="${k}"][data-v="${v}"]`);
  await page.click('#cbGrid [data-cb="note"][data-crit="ev"]'); await page.fill('[data-cbnote="ev"]', 'Set the hours without checking the schedule.');
  await page.click('#cbGrid button[data-cb="note"][data-crit="ev"]:not(.cbnotebtn)');
  const DP = `data/users/${PAT}/calib_${IK}`;
  await waitDoc(page, DP, `d.marks.ev===1&&d.marks.tone===3&&/schedule/.test(d.notes.ev)`);
  ok(!(await D(page, `calibMarks/${PAT}/items/${IK}`)) && (await txt(page, '#cbFilled')) === '9/9' && await page.locator('#cbGrid [data-cb="submit"]').isEnabled(), 'marks save to your private draft (debounced), not shared; Submit on at 9/9');
  ok(await asUser(page, HOW, `await db.doc('${DP}').get()`) === 'permission_denied', "Howard can't read Pat's draft");
  ok(await asUser(page, HOW, `await db.doc('calibMarks/${PAT}/items/x').set({a:1})`) === 'permission_denied' && await asUser(page, HOW, `await db.doc('calibMarks/${HOW}/items/x').set({a:1})`) === 'ok', 'calibMarks/{self}: Howard writes his own marks, never Pat\'s');
  await asUser(page, HOW, `await db.doc('calibMarks/${HOW}/items/x').delete()`);
  await page.click('#cbGrid [data-cb="submit"]');
  await waitDoc(page, `calibMarks/${PAT}/items/${IK}`, 'd.submittedAt');
  const sub = await D(page, `calibMarks/${PAT}/items/${IK}`);
  ok(JSON.stringify(sub.marks) === JSON.stringify(Object.assign({}, base)) && sub.kind === 'chat' && sub.key === S0 && /schedule/.test(sub.notes.ev) && !JSON.stringify(sub).includes('Pat'), 'Submit copies the draft to calibMarks/<you>/items/<item> (ids only, no names)');
  await page.waitForTimeout(150);
  ok(await page.locator(`#cbGrid th[data-col="${HOW}"] [data-cb="peek"]`).count() === 1 && await page.locator(`#cbGrid th[data-col="${LIQ}"] [data-cb="peek"]`).count() === 0 && (await cell(page, 'ev', 2).innerText()).includes('✓ Scored'), 'after submit: Reveal on Howard (submitted), none on Li Qi');
  await page.click(`#cbGrid th[data-col="${HOW}"] [data-cb="peek"]`); await page.waitForTimeout(100);
  ok((await cell(page, 'ev', 2).innerText()).trim().startsWith('2') && (await cell(page, 'path', 2).innerText()).trim().startsWith('2') && (await cell(page, 'ev', 3).innerText()).includes('Not yet'), "Reveal shows Howard's marks only");
  await gridShot(page, 'calib-scorecard-revealed.png');
  await page.click(`#cbGrid th[data-col="${HOW}"] [data-cb="peek"]`); await page.waitForTimeout(80);
  ok((await cell(page, 'ev', 2).innerText()).includes('✓ Scored'), 'Hide puts him back');
  // Li Qi submits elsewhere: her column lights up live
  await asUser(page, LIQ, `await db.doc('calibMarks/${LIQ}/items/${IK}').set({kind:'chat',key:'${S0}',marks:${JSON.stringify(liqM)},notes:{rs:'Missed the closing time in the restatement.'},submittedAt:'2026-10-14T15:00:00.000Z',updatedAt:'2026-10-14T15:00:00.000Z'})`);
  await page.waitForFunction(l => !!document.querySelector(`#cbGrid th[data-col="${l}"] [data-cb="peek"]`), LIQ, { timeout: 3000 });
  ok(true, "Li Qi submits from her own view: her Reveal appears live");

  // ===== 4. Compare all: spread, agreed, settle (one row from Howard, live)
  await page.click('#cbGrid [data-cb="compare"]'); await page.waitForTimeout(150);
  ok(await page.locator('#cbGrid thead th', { hasText: 'Spread' }).count() === 1 && (await txt(page, '#cbr-fr .cbsp')) === 'Match' && (await txt(page, '#cbr-ev .cbsp')) === '1 apart' && await page.locator('#cbr-ev [data-cb="row"]').count() === 1 && (await txt(page, '#cbr-fr .cbag')).trim() === '3', 'Compare all: spread pills, matched rows agreed, the rest Settle');
  ok((await txt(page, '#cbToSettle')) === '3' && await page.locator('#cbGrid [data-cb="lock"]').isDisabled(), '3 rows to settle; Lock off');
  await page.click('#cbr-ev > td >> nth=0'); await page.waitForTimeout(100);
  const cards = await page.locator('#cbGrid .cbdet .cbnt header').allInnerTexts();
  ok(cards.length === 4 && /Claude/.test(cards[0]) && /You/.test(cards[1]) && /Howard/.test(cards[2]) && /Li Qi/.test(cards[3]) && (await txt(page, '#cbGrid .cbdet')).includes('Opened the schedule eventually'), "a row opens everyone's note cards with Claude's reason");
  await page.click('#cbr-ev > td >> nth=0'); await page.waitForTimeout(80);
  await asUser(page, HOW, `await db.doc('calibItems/${IK}/rows/ev').set({mark:1,note:'Evidence comes before any action.',by:'${HOW}',at:'2026-10-14T15:30:00.000Z'})`);
  await page.waitForFunction(() => { const c = document.querySelector('#cbr-ev .cbag'); return c && c.innerText.trim().startsWith('1') }, null, { timeout: 3000 });
  ok((await txt(page, '#cbToSettle')) === '2', "Howard settles Gathered the evidence: Pat sees it live");
  const settle = async (crit, mark, note) => { if (!(await page.locator(`#cbr-${crit}.open`).count())) await page.click(`#cbr-${crit} > td >> nth=0`); await page.waitForTimeout(80);
    await page.click(`#cbGrid [data-cb="apick"][data-crit="${crit}"][data-v="${mark}"]`); await page.fill(`[data-cbag="${crit}"]`, note); await page.click(`#cbGrid [data-cb="asave"][data-crit="${crit}"]`);
    await waitDoc(page, `calibItems/${IK}/rows/${crit}`, `d.note===${JSON.stringify(note)}`); await page.waitForTimeout(120) };
  await settle('path', 3, 'Setting the hours was the right path.');
  await settle('rs', 3, 'Confirmed back in M2.');
  await settle('tone', 3, 'Clear and kind, not just polite.');
  ok((await D(page, `calibItems/${IK}/rows/path`)).by === PAT && (await txt(page, '#cbToSettle')) === '0' && await page.locator('#cbGrid [data-cb="lock"]').isEnabled(), 'settled rows are their own docs; every row agreed: Lock on');

  // ===== 5. Lock: the agreed score, lessons (contest + reinforce), the round result
  const agreed = Object.assign({}, base, { ev: 1, path: 3, rs: 3, tone: 3 }), pct = B.chatScore(agreed), vd = B.chatVerdict(pct);
  await page.click('#cbGrid [data-cb="lock"]');
  await waitDoc(page, 'calibItems/' + IK, 'd.locked');
  const it = await D(page, 'calibItems/' + IK);
  ok(it.locked.pct === pct && it.locked.verdict === vd.id && it.locked.by === PAT && it.kind === 'chat' && it.key === S0 && it.round === 1 && JSON.stringify(it.locked.marks) === JSON.stringify(agreed), `Lock writes the agreed score the scorecard computes (${pct}%, ${vd.label})`);
  ok((await D(page, `calibItems/${IK}/rows/fr`)).note === 'All matched', 'matched rows get an "All matched" row doc on lock');
  await page.waitForFunction(p => !!window.__data[p], `chatLessons/${S0}_tone`, { timeout: 5000 });
  const les = await page.evaluate(s => Object.fromEntries(Object.entries(window.__data).filter(([p]) => p.startsWith(`chatLessons/${s}_`)).map(([p, d]) => [p.split('_').pop(), d])), S0);
  ok(Object.keys(les).sort().join() === 'ev,path,rs,tone', 'lessons only where the panel moved Claude or gave a real reason');
  ok(les.ev.kind === 'contest' && les.ev.from === '3/3' && les.ev.to === '1/3' && les.ev.reason === 'Evidence comes before any action.' && les.ev.by === 'panel' && les.ev.round === 1 && les.ev.what === 'Cites F1 and F2.', 'contest lesson: Claude 3/3 → agreed 1/3, the agreed note, by panel, round 1');
  ok(['path', 'rs', 'tone'].every(k => les[k].kind === 'reinforce' && les[k].from === '3/3' && les[k].to === '3/3' && les[k].by === 'panel') && les.tone.reason === 'Clear and kind, not just polite.', 'reinforce lessons: same mark, the agreed reason');
  const st = await D(page, 'learning/state'), res = st.rounds[0].results;
  ok(res.length === 1 && res[0].sid === S0 && res[0].yourPct === pct && res[0].aiPct === sample[0].aiPct && res[0].match === (vd.id === sample[0].aiVerdict), "the round records Claude vs the panel's agreed score");
  const rv = await D(page, `chatWeeks/${LW}/reviews/${S0}`);
  ok(rv && rv.panel === true && rv.pct === pct && JSON.stringify(rv.scores) === JSON.stringify(agreed), 'the review is the panel\'s agreed score');
  await page.waitForTimeout(250);
  ok((await txt(page, '#tkPct')) === fmt(pct) + '%' && (await txt(page, '#cbAgPct')) === fmt(pct) + '%' && /Agreed/.test(await txt(page, '#cbGrid .cbstatus')) && await page.locator('#coachCopy').count() === 1 && await page.locator('#chatSave').count() === 0, 'the ticket shows the agreed score; coaching from it, no solo Save');
  ok((await txt(page, '#cbSent')).includes('Gathered the evidence: Claude 3, agreed 1') && (await txt(page, '#cbWho')).includes('Howard: 7 of 9'), 'outcome: sent to the coach, who matched');
  await gridShot(page, 'calib-scorecard-agreed.png');
  // Reopen withdraws them
  await page.click('#cbGrid [data-cb="reopen"]');
  await waitDoc(page, 'calibItems/' + IK, 'd.locked===null');
  await page.waitForFunction(s => !Object.keys(window.__data).some(p => p.startsWith(`chatLessons/${s}_`)), S0, { timeout: 5000 });
  ok(!(await D(page, `chatWeeks/${LW}/reviews/${S0}`)) && await page.locator('#cbGrid [data-cb="lock"]').isEnabled(), 'Reopen clears the lock, withdraws the panel lessons and the review');
  await page.click('#cbGrid [data-cb="lock"]'); await waitDoc(page, 'calibItems/' + IK, 'd.locked');
  await page.waitForFunction(p => !!window.__data[p], `chatLessons/${S0}_ev`, { timeout: 5000 });
  ok((await D(page, 'learning/state')).rounds[0].results.length === 1, 'locking again records the round once');
  // a draft on another item, for Howard's view later
  await page.evaluate(([s, w]) => openChat(s, w), [S1, LW]); await page.waitForTimeout(300);
  await page.click('#cbGrid [data-cb="pick"][data-crit="fr"][data-v="2"]'); await waitDoc(page, `data/users/${PAT}/calib_chat_${S1}`);
  const rowSubs = await page.evaluate(() => window.__subs.filter(s => s.on && /^calibItems\/.+\/rows$/.test(s.path)).map(s => s.path));
  ok(rowSubs.length === 1 && rowSubs[0] === `calibItems/chat_${S1}/rows`, 'rows: one live subscription, for the item on screen');
  ok(await page.evaluate(() => window.__subs.filter(s => /^calibMarks/.test(s.path)).length) === 4, 'calibMarks: one subscription plus one per grader');

  // ===== 6. the Calibration tab after one agreed chat
  await page.click('[data-tab="calib"]'); await page.waitForTimeout(250);
  ok((await txt(page, '#cbkAgreed b')) === '1 / 10' && (await txt(page, '#cbkTurn b')) === '9' && (await txt(page, `#cbItems tr[data-ik="${IK}"] .pill`)) === 'Agreed', 'KPIs: Agreed 1 / 10, Your turn 9; the item is Agreed');
  // all three submitted: 9 criteria, ev, path and rs split → 6 of 9 the same
  ok((await txt(page, '#cbkSame b')) === Math.round(6 / 9 * 100) + '%', 'Same mark, all graders: 6 of 9 criteria');
  const cl = B.CHAT_RUBRIC.filter(r => String(sample[0].aiScores[r.id]) === String(agreed[r.id])).length;
  ok((await txt(page, '#cbkClaude b')) === Math.round(cl / 9 * 100) + '%', `Claude vs agreed: ${cl} of 9`);
  const dis = await page.locator('#cbDis .cbbar').allInnerTexts();
  ok(dis.length >= 3 && /Gathered the evidence|Resolution path|Restated/.test(dis[0]) && dis[0].includes('100%'), 'Where we disagree most: the split criteria first');
  ok(await page.locator('#cbEach .cbbar').count() === 4 && (await txt(page, `#cbEach [data-g="${HOW}"]`)).includes(Math.round(7 / 9 * 100) + '%') && await page.locator('#cbEach [data-g="claude"]').count() === 1, 'Each grader vs the agreed mark, Claude included');
  await shot(page, 'calib-tab.png', true);

  // ===== 7. calls: draw 10 from the week's queue, the inline call, its grid and lock
  await page.click('[data-cb="kind"][data-v="call"]'); await page.waitForTimeout(150);
  ok((await txt(page, '#cbRound h2')) === 'No round yet' && await page.locator('#cbDraw').isEnabled(), 'Calls: no round yet, Draw on');
  await page.click('#cbDraw');
  await page.waitForFunction(() => Object.keys(window.__data).some(p => p.startsWith('calibRounds/')), null, { timeout: 5000 });
  const rd = await page.evaluate(() => Object.entries(window.__data).find(([p]) => p.startsWith('calibRounds/'))[1]);
  const per = {}; rd.items.forEach(x => per[x.sa] = (per[x.sa] || 0) + 1);
  ok(rd.kind === 'call' && rd.week === LW && rd.items.length === 10 && new Set(rd.items.map(x => x.key)).size === 10 && Object.values(per).every(k => k >= 2 && k <= 3) && rd.by === PAT, `Draw 10: ten calls spread across the SAs (${Object.values(per).join(' ')})`);
  await page.waitForTimeout(200);
  ok((await txt(page, '#cbRound h2')) === 'Round 1' && await page.locator('#cbItems tbody tr').count() === 10 && await page.locator('#cbDraw').isDisabled(), 'the call round lists its 10');
  const CK = rd.items[0].key, CIK = 'call_' + CK;
  await page.click(`[data-cb="open"][data-ik="${CIK}"]`); await page.waitForTimeout(250);
  ok(await page.locator('#cbCall').isVisible() && (await txt(page, '#cbCall h2')).startsWith('Sample Oven') && (await txt(page, '#cbCall .cbtkmeta')).includes('CL call') && await page.locator('#cbCall .evrow a', { hasText: '▶ Recording' }).count() === 1 && (await txt(page, '#cbBrief')).includes('not ready on time'), 'the call opens inline: ticket, facts, recording');
  ok(await page.locator('#cbGrid tbody tr[id^="cbr-"]').count() === 12 && (await txt(page, '#cbr-1a > td >> nth=0')).trim() === '–' && await page.locator('#cbr-1a [data-cb="pick"]').count() === 4 && await page.locator('#cbr-1a [data-cb="pick"][data-v="0"]').count() === 0, 'call grid: 12 rubric items, Claude –, marks 1–3 and N/A');
  await page.click('#cbGrid [data-cb="panel"][data-crit="2b"]'); await page.waitForTimeout(150);
  const pn = await txt(page, '#cbPanel');
  ok(await page.locator('#cbPanel').isVisible() && pn.includes('Root cause and fault') && pn.includes(RV1.call[1].items.find(x => x.id === '2b').lv['1']) && pn.includes('the ticket never printed'), "a call criterion opens its levels and the call's facts");
  await page.click('#cbPanel [data-cb="pclose"]'); await page.waitForTimeout(80);
  ok(await page.locator('#cbPanel').isHidden(), 'the panel closes');
  const cm = {}; RV1.call.forEach(s => s.items.forEach(x => cm[x.id] = 3)); cm['2b'] = 2; cm['3b'] = 'na';
  for (const [k, v] of Object.entries(cm)) await page.click(`#cbGrid [data-cb="pick"][data-crit="${k}"][data-v="${v}"]`);
  await page.click('#cbGrid [data-cb="submit"]'); await waitDoc(page, `calibMarks/${PAT}/items/${CIK}`, 'd.submittedAt'); await page.waitForTimeout(120);
  await page.click('#cbGrid [data-cb="compare"]'); await page.waitForTimeout(120);
  await page.click('#cbGrid [data-cb="lock"]'); await waitDoc(page, 'calibItems/' + CIK, 'd.locked');
  let W = 0, E = 0; RV1.call.forEach(s => s.items.forEach(x => { const v = cm[x.id], p = v === 'na' ? 1 : (v - 1) / 2; W += x.w; E += p * x.w }));
  const cpct = Math.round(E / W * 1000) / 10, ci = await D(page, 'calibItems/' + CIK);
  ok(Math.abs(ci.locked.pct - cpct) < 0.051 && ci.locked.verdict === B.chatVerdict(ci.locked.pct).id && ci.kind === 'call' && ci.key === CK, `call lock: the call rubric calc (${ci.locked.pct}%)`);
  await page.waitForTimeout(200);
  ok((await txt(page, '#cbCall .cbverd')).includes(fmt(ci.locked.pct) + '%') && !(await page.evaluate(k => Object.keys(window.__data).some(p => p.startsWith('chatLessons/') && p.includes(k)), CK)), 'the agreed call score shows; no chat lessons for a call');
  await shot(page, 'calib-call.png', true);
  await page.click('[data-cb="back"]'); await page.waitForTimeout(150);
  ok((await txt(page, '#cbkAgreed b')) === '1 / 10' && (await txt(page, '#cbkClaude b')) === '–', 'call KPIs: 1 agreed, no Claude column for calls');

  // ===== 8. 390px and dark
  await page.click('[data-cb="kind"][data-v="chat"]'); await page.waitForTimeout(100);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(100);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('#cbRound')).backgroundColor) !== 'rgb(255, 255, 255)' && await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--g1').trim()) === '#5fc7da', 'dark: the tab and the grader colours take the dark tokens');
  await shot(page, 'calib-dark.png', true);
  for (const wd of [390, 760]) { await page.setViewportSize({ width: wd, height: 860 }); await page.waitForTimeout(150); ok(await width(page) <= wd, `${wd}px Calibration tab (dark): no horizontal overflow (${await width(page)})`) }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(120);
  await shot(page, 'calib-390.png', true);
  await page.click(`[data-cb="open"][data-ik="${IK}"]`); await page.waitForTimeout(300);
  ok(await width(page) <= 390 && await page.evaluate(() => { const s = document.querySelector('#cbGrid .cbscroll'); return !!s && s.getBoundingClientRect().right <= 390 }), '390px audit: the grid scrolls inside its box, the page does not');
  await shot(page, 'calib-scorecard-390.png', true);
  await page.click('[data-tab="calib"]'); await page.waitForTimeout(100);
  await page.click('[data-cb="kind"][data-v="call"]'); await page.click(`[data-cb="open"][data-ik="${CIK}"]`); await page.waitForTimeout(200);
  ok(await width(page) <= 390, '390px call view: no horizontal overflow');
  ok(!errors.length, 'no console errors (Pat) ' + JSON.stringify(errors));

  // ===== 9. Howard's view: his own column, Pat's draft stays hidden
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(h => window.__switch(h), HOW).catch(() => {}); await page.waitForLoadState('load'); await page.waitForTimeout(800);
  ok(await page.evaluate(() => myId) === HOW && await page.evaluate(() => amOwner) === false, 'reloaded as Howard (not the owner)');
  await page.evaluate(() => setTab('calib')); await page.click('[data-cb="kind"][data-v="chat"]'); await page.waitForTimeout(250);
  ok((await txt(page, '#cbkTurn b')) === '9' && (await txt(page, `#cbItems tr[data-ik="${IK}"] .pill`)) === 'Agreed', "Howard's KPIs: his turn on 9, the first chat Agreed");
  await page.click(`[data-cb="open"][data-ik="chat_${S1}"]`); await page.waitForTimeout(350);
  ok(/you/i.test(await txt(page, `#cbGrid th[data-col="${HOW}"]`)) && await page.locator('#cbr-fr [data-cb="pick"]').count() > 0 && (await cell(page, 'fr', 1).innerText()).includes('Not yet'), "Howard scores in his own column; Pat's draft shows as Not yet");
  ok(!(await page.evaluate(() => (window.__denied || []).length)), 'the page never reads someone else\'s draft');
  ok(!errors.length, 'no console errors (Howard) ' + JSON.stringify(errors));
  await ctx.close(); await b.close();
  console.log(`\nui calib: ${n} checks passed`);
})().catch(e => { console.error('TEST FAILED', e); process.exit(1) });
