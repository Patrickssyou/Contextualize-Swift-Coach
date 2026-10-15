// The Round: one week, 3 chats and 3 calls per SA, marked blind by three graders (Pat, Howard, Li Qi; all invented), compared, settled and locked.
// World A seeds a drawn round so the flow is deterministic: the Round tab, a chat and a call in the Audit tab, the mixed checklist, Back / Prev / Next,
// Learning sync, old hashes, Howard's view. World B draws (3 + 3 per SA, short SAs, items drawn before, redraw only before any submission).
// World C: only Pat has opened the desk, so Howard and Li Qi are pending columns. Rules checked against the mock's access rules:
// a draft under data/users/<id> is private, calibMarks/<uid> is written by <uid> only.
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path'), assert = require('assert');
const { openPage, learnWorld, DIR } = require('./mock.js');
const B = require('../src/chat.js');
const SH = path.join(DIR, 'shots'); fs.mkdirSync(SH, { recursive: true });
let n = 0; const ok = (c, m) => { assert.ok(c, m); n++; console.log('ok -', m) };
const fmt = p => (Math.round(p * 10) / 10).toFixed(1);
const PAT = 'u_test', HOW = 'u_howard', LIQ = 'u_liqi', people = { [PAT]: 'Pat', [HOW]: 'Howard', [LIQ]: 'Li Qi' };
const LW = '2026-10-05', PREV = '2026-09-28', NOW = '2026-10-14T16:00:00Z', WL = 'Oct 5 – 11';
const L = learnWorld(LW), aud = sid => L.list.find(x => x.sid === sid);

// the live call rubric (v2: 0–3, N/A left out), read from the template so the test follows it
const tpl = fs.readFileSync(path.join(DIR, 'src/template.html'), 'utf8');
const CALL_V2 = new Function(tpl.slice(tpl.indexOf('const NA_ANY'), tpl.indexOf('const clone = x =>')) + 'return CALL_V2')();
const V2I = CALL_V2.flatMap(s => s.items);
const callPct = m => { let W = 0, E = 0; V2I.forEach(x => { const v = m[x.id]; if (v === 'na' || v == null) return; W += x.w; E += v / 3 * x.w }); return Math.round(E / W * 1000) / 10 };

// invented calls: Ana 4 (one drawn in an earlier round, one a case with a second SA and a WIRA task), Ben 3 (+1 removed), Cleo 1, Eli 2 (one MGR), one from another week
const TXI = [];
const mkCall = (id, sa, i, o) => { o = o || {}; const cid = 'c0ffee00-0000-4000-8000-0000000001' + String(i).padStart(2, '0'), day = `2026-10-0${5 + (i % 4)}`, t = `1${i % 8}:15`;
  const legs = [{ id: cid, at: `${day}T${t}:00`, sec: 240 + i * 10, who: sa, own: true, graded: true, sampled: true, dir: 'in' }];
  if (o.team) legs.push({ id: cid.replace(/..$/, '9' + (i % 10)), at: `${day}T${t.slice(0, 2)}:25:00`, sec: 120, who: 'Mo Reyes', group: 'sa', own: false, graded: false, dir: 'out' });
  TXI.push([cid, `Agent: Thanks for calling Tarro support, this is ${sa.split(' ')[0]}.\nCaller: My pickup order from Sample Oven ${id} was not ready.\nAgent: I am calling the store now.`]);
  return ['queue/' + id, { agent: sa, type: o.mgr ? 'mgr' : 'call', kind: o.mgr ? 'MGR' : 'CL', callDate: day, callTime: t, restaurantId: 'R95' + String(i).padStart(3, '0'), restaurantName: `Sample Oven ${id}`,
    callId: cid, durationSec: 240 + i * 10, link: `https://greendot.example.test/restaurant/R95${String(i).padStart(3, '0')}`, week: o.week || LW, pos: i, source: 'lightdash', removed: !!o.removed, auditId: null, score: null,
    chain: { legs, count: legs.length, talkSec: legs.reduce((s, l) => s + l.sec, 0), agents: o.team ? 2 : 1 },
    tasks: o.team ? [{ id: 'T88' + i, title: 'Remake the pickup order', status: 'Done', url: 'https://wira.example.test/tasks/T88' + i, desc: 'The store remade the order.' }] : null,
    aiFacts: { summary: 'The caller says a pickup order was not ready on time.', rootCause: 'Ticket did not print', facts: { calls: { [cid]: ['The caller says the order was 20 minutes late', 'The SA called the store'] },
      timeline: [{ id: 'F1', src: 'Call 1', when: '0:12', who: 'Caller', kind: 'said', what: 'Says the pickup order was not ready 20 minutes after the quoted time' }, { id: 'F2', src: 'Call 1', when: '1:40', who: sa, kind: 'did', what: 'Called the store, which said the ticket never printed' }], promises: [] } } }] };
const calls = [mkCall('qana1', 'Ana Ruiz', 1), mkCall('qana2', 'Ana Ruiz', 2, { team: true }), mkCall('qana3', 'Ana Ruiz', 3), mkCall('qana4', 'Ana Ruiz', 4),
  mkCall('qben1', 'Ben Okafor', 5), mkCall('qben2', 'Ben Okafor', 6), mkCall('qben3', 'Ben Okafor', 7), mkCall('qben4', 'Ben Okafor', 8, { removed: true }),
  mkCall('qcle1', 'Cleo Marsh', 9), mkCall('qeli1', 'Eli Novak', 10, { mgr: true }), mkCall('qeli2', 'Eli Novak', 11), mkCall('qold1', 'Ana Ruiz', 12, { week: PREV })];
const Q = id => calls.find(([p]) => p === 'queue/' + id)[1];

// the learning state before this pass: an open round of 10 chats (no results), excluding the reviewed and the marked chat
const pool = L.list.filter(x => x.sid !== L.reviewed.sid && x.sid !== L.marked.sid).slice(0, 10);
const samp = x => ({ sid: x.sid, sa: x.sa, restaurant: x.restaurant, aiPct: x.pct, aiVerdict: x.verdict, aiScores: x.scores });
const oldState = { week: LW, currentCheckpoint: 'cp0', target: { verdicts: 8, pts: 5, streak: 2 }, marked: [L.marked.sid], rounds: [{ round: 1, checkpoint: 'cp0', drawnAt: LW + 'T12:00:00.000Z', status: 'open', sample: pool.map(samp), results: [], verdictMatch: null, meanAbsDiff: null, pass: null }] };
const prevRound = ['calibRounds/' + PREV, { week: PREV, drawnAt: PREV + 'T09:00:00.000Z', by: PAT, sas: ['Ana Ruiz'], items: [{ kind: 'call', key: 'qana1', sa: 'Ana Ruiz', restaurant: 'Sample Oven qana1', at: '2026-10-06T11:15' }] }];
const joined = [['calibMarks/' + PAT, { joinedAt: '2026-10-12T09:00:00.000Z', lastSeen: '2026-10-12T09:00:00.000Z' }], ['calibMarks/' + HOW, { joinedAt: '2026-10-12T09:05:00.000Z', lastSeen: '2026-10-12T09:05:00.000Z' }],
  ['calibMarks/' + LIQ, { joinedAt: '2026-10-12T09:10:00.000Z', lastSeen: '2026-10-12T09:10:00.000Z' }]];
const pulls = [['pulls/2026-10-05', { status: 'done', week: '2026-10-05', at: '2026-10-13T08:00:00.000Z', added: 12 }], ['pulls/2026-09-28', { status: 'done', week: '2026-09-28', at: '2026-10-05T08:00:00.000Z', added: 0 }]];
const base0 = L.seed.filter(([p]) => p !== 'learning/state').concat(pulls, calls);

// World A: a drawn round, in SA order: up to 3 chats then up to 3 calls each
const SAS = ['Ana Ruiz', 'Ben Okafor', 'Cleo Marsh', 'Dev Patel', 'Eli Novak', 'Faye Lund'];
const items = []; SAS.forEach(sa => { L.list.filter(x => x.sa === sa).slice(0, 3).forEach(x => items.push({ kind: 'chat', key: x.sid, sa, restaurant: x.restaurant, at: '2026-10-06T10:15:00.000Z', aiPct: x.pct }));
  calls.filter(([, q]) => q.agent === sa && !q.removed && q.week === LW).slice(0, 3).forEach(([p, q]) => items.push({ kind: 'call', key: p.split('/')[1], sa, restaurant: q.restaurantName, at: q.callDate + 'T' + q.callTime })) });
const chatItems = items.filter(x => x.kind === 'chat'), callItems = items.filter(x => x.kind === 'call');
const roundA = ['calibRounds/' + LW, { week: LW, drawnAt: '2026-10-13T09:00:00.000Z', by: PAT, sas: SAS, items }];
const stateA = Object.assign({}, oldState, { rounds: [Object.assign({}, oldState.rounds[0], { status: 'replaced', replacedAt: '2026-10-13T09:00:00.000Z' }),
  { round: 2, week: LW, checkpoint: 'cp0', drawnAt: '2026-10-13T09:00:00.000Z', status: 'open', sample: chatItems.map(x => samp(aud(x.key))), results: [], verdictMatch: null, meanAbsDiff: null, pass: null }] });
// the chat under test: Claude at ev 3 / path 3 (Dev's first)
const S0 = '9930010', IK = 'chat_' + S0, IDX0 = items.findIndex(x => x.key === S0);
const base = { fr: 3, ev: 1, rs: 3, fa: 'na', path: 3, amt: 'na', expl: 'na', esc: 'na', tone: 3 };
const howM = Object.assign({}, base, { ev: 2, path: 2 }), liqM = Object.assign({}, base, { rs: 2 });
const seedA = base0.concat([['learning/state', stateA], prevRound, roundA], joined,
  [[`calibMarks/${HOW}/items/${IK}`, { kind: 'chat', key: S0, marks: howM, notes: { ev: 'Opened the schedule eventually, partial credit.', path: 'Should have confirmed the old hours first.' }, submittedAt: '2026-10-13T10:00:00.000Z', updatedAt: '2026-10-13T10:00:00.000Z' }]]);

const txt = (page, s) => page.locator(s).innerText();
const width = page => page.evaluate(() => document.documentElement.scrollWidth);
const D = (page, p) => page.evaluate(p => window.__data[p] ? JSON.parse(JSON.stringify(window.__data[p])) : null, p);
const waitDoc = (page, p, fn, t) => page.waitForFunction(([p, f]) => { const d = window.__data[p]; return f ? !!d && new Function('d', 'return ' + f)(d) : !!d }, [p, fn || ''], { timeout: t || 5000 });
const cell = (page, crit, i) => page.locator(`#cbr-${crit} > td`).nth(i);        // 0 Claude, 1 Pat, 2 Howard, 3 Li Qi (joined in that order)
const shot = async (page, name, full) => { await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true }); await page.waitForTimeout(120); await page.screenshot({ path: path.join(SH, name), fullPage: !!full }) };
const gridShot = async (page, name) => { await page.evaluate(() => { const t = document.getElementById('toast'); if (t) t.hidden = true; document.getElementById('cs-score').scrollIntoView({ block: 'start' }) }); await page.waitForTimeout(120);
  await page.locator('#cs-score').screenshot({ path: path.join(SH, name) }) };
const asUser = (page, uid, op) => page.evaluate(([uid, op]) => window.__as(uid, async db => { try { await new Function('db', 'return (async () => {' + op + '})()')(db); return 'ok' } catch (e) { return e && e.code || String(e) } }), [uid, op]);
const subDoc = (kind, key, marks) => ({ kind, key, marks, notes: {}, submittedAt: '2026-10-14T11:00:00.000Z', updatedAt: '2026-10-14T11:00:00.000Z' });
const callMarks = v => Object.fromEntries(V2I.map(x => [x.id, v]));
const tab = page => page.evaluate(() => tab);

(async () => {
  const b = await chromium.launch();
  let { page, ctx, errors } = await openPage(b, seedA, { people, room: true, sampleMs: 30 }, { width: 1280, height: 900 }, { now: NOW, tx: TXI });
  await page.goto('http://qa.test/'); await page.waitForTimeout(700);

  // ===== 1. one workspace, the Round first
  const areas = (await page.locator('.tabs.areas [data-area]').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  const subs = (await page.locator('#sub-chats button').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  ok(areas.length === 3 && areas[0] === 'Audits' && /^Results/.test(areas[1]) && /^Database/.test(areas[2]), 'one Audits area beside Results and Database (Chats and Calls merged)');
  ok(subs.length === 6 && ['Round', 'Audit', 'Dashboard', 'Learning', 'Brain', 'Call tools'].every((x, i) => subs[i].includes(x)) && /^1/.test(subs[0]) && /^2/.test(subs[1]), 'tabs: 1 Round, 2 Audit, Dashboard, Learning, Brain, Call tools');
  ok(await tab(page) === 'calib' && await page.evaluate(() => location.hash) === '#calib' && await page.locator('#sub-calls').isHidden(), 'the page opens on the Round tab');
  ok((await txt(page, '#cbRound h2')) === 'Week ' + WL && (await txt(page, '#cbSum')) === `${items.length} items · you: 0 of ${items.length} done` && items.length === 22, `Round header: "Week ${WL}" and "22 items · you: 0 of 22 done"`);
  const groups = await page.locator('#cbItems .cbsa').evaluateAll(x => x.map(g => ({ sa: g.dataset.sa, n: g.querySelectorAll('.cbirow').length, calls: g.querySelectorAll('.cbirow[data-kind="call"]').length })));
  ok(JSON.stringify(groups.map(g => g.sa)) === JSON.stringify(SAS) && groups[0].n === 6 && groups[0].calls === 3 && groups[3].calls === 0, 'grouped by SA: Ana has 3 chats and 3 calls; Dev no calls');
  const short = (await txt(page, '#cbShort')).replace(/\s+/g, ' ');
  ok(/Cleo 2 of 3 chats, 1 of 3 calls/.test(short) && /Dev 2 of 3 chats, 0 of 3 calls/.test(short) && /Faye 1 of 3 chats, 0 of 3 calls/.test(short) && !/Ana|Ben/.test(short), 'short SAs show "2 of 3" for what they lack');
  const rowA = await page.locator(`#cbItems .cbirow[data-ik="chat_${chatItems[0].key}"]`).innerText(), rowC = await page.locator('#cbItems .cbirow[data-ik="call_qana1"]').innerText();
  ok(rowA.includes(chatItems[0].restaurant) && rowA.includes('Claude ' + fmt(aud(chatItems[0].key).pct) + '%') && rowC.includes('Sample Oven qana1') && /CL · 4:10/.test(rowC.replace(/\s+/g, ' ')) && /Oct 6/.test(rowC), 'rows: a chat shows Claude\'s score, a call its type and length, both their date');
  ok(await page.locator(`#cbItems .cbirow[data-ik="${IK}"] .cbdot.done`).count() === 1 && (await txt(page, `#cbItems .cbirow[data-ik="${IK}"] .pill`)) === 'Scoring' && (await txt(page, '#st-calib')) === '22', "Howard's dot is filled on his item; the tab counts my 22");
  ok(await page.locator('#cbRedraw, #cbDraw').count() === 0 && await page.locator('#cbGrBtn').isVisible(), 'a grader has submitted: no Redraw; Graders for the owner');
  await page.click('[data-cb="filt"][data-v="call"]'); await page.waitForTimeout(100);
  ok(await page.locator('#cbItems .cbirow').count() === 9 && await page.locator('#cbItems .cbirow[data-kind="chat"]').count() === 0 && await page.locator('#cbItems .cbsa').count() === 4, 'Calls: the 9 calls, SAs without calls drop out');
  await page.click('[data-cb="filt"][data-v="chat"]'); await page.waitForTimeout(100);
  ok(await page.locator('#cbItems .cbirow').count() === 13 && await page.locator('#cbItems .cbirow[data-kind="call"]').count() === 0, 'Chats: the 13 chats');
  await page.click('[data-cb="filt"][data-v="all"]'); await page.click('[data-cb="mine"]'); await page.waitForTimeout(100);
  ok(await page.locator('#cbItems .cbirow').count() === 22 && (await page.locator('[data-cb="mine"]').getAttribute('aria-pressed')) === 'true', 'Mine to do: all 22 before I submit anything');
  await page.click('[data-cb="mine"]');
  await page.evaluate(h => window.__peers([{ by: h, presence: { tab: 'calib', item: null } }]), HOW); await page.waitForTimeout(150);
  ok(/You and Howard are here/.test(await txt(page, '#cbRound .cbhd')), 'presence: "You and Howard are here" in the header');
  // Continue opens the first item I haven't submitted; Back returns to the Round
  ok((await txt(page, '#cbGo')).startsWith('Start'), 'Start before anything is done');
  await page.click('#cbGo'); await page.waitForTimeout(350);
  ok(await tab(page) === 'chat' && await page.evaluate(() => chatSel) === items[0].key && (await txt(page, '#navBack')).includes('Round'), 'Start opens the first item; Back names the Round');
  await page.click('#navBack'); await page.waitForTimeout(250);
  ok(await tab(page) === 'calib', 'Back returns to the Round tab');

  // ===== 2. a round chat in the Audit tab: the shared grid, blind
  await page.click(`[data-cb="open"][data-ik="${IK}"]`); await page.waitForTimeout(400);
  ok(await tab(page) === 'chat' && await page.evaluate(() => location.hash) === `#chat/${LW}/${S0}` && await page.locator('#cbGrid').count() === 1 && (await txt(page, '#cbGrid .cbmeta')).includes(`Week ${WL} · ${IDX0 + 1} of 22`), 'a round chat opens in Audit with the calibration grid');
  ok(await page.locator('.ccrit').count() === 0 && await page.locator('[data-contest],[data-reinforce]').count() === 0 && await page.locator('#tkFinds').count() === 0, 'no solo scorecard, no Contest or Reinforce, no Findings');
  await page.evaluate(([h, ik]) => window.__peers([{ by: h, presence: { tab: 'chat', item: ik } }]), [HOW, IK]); await page.waitForTimeout(150);
  ok(/You and Howard are here/.test(await txt(page, '#cbGrid .cbmeta')) && await page.evaluate(() => (window.__presence || []).some(p => p.tab === 'chat' && p.item)), "presence on the item's scorecard");
  ok((await txt(page, '#cbr-ev > td >> nth=0')).trim() === '3' && (await cell(page, 'ev', 2).innerText()).includes('✓ Scored') && (await cell(page, 'ev', 3).innerText()).includes('Not yet'), "blind: Claude's mark shows, Howard ✓ Scored, Li Qi Not yet");
  ok(await page.locator('#cbGrid [data-cb="peek"]').count() === 0 && await page.locator('#cbGrid [data-cb="submit"]').isDisabled() && (await txt(page, '#cbFilled')) === '0/9', 'no Reveal before you submit; Submit off at 0/9');
  await page.click('#cbGrid [data-psrc="ev"]'); await page.waitForTimeout(200);
  ok(await page.locator('#chPanel').isVisible() && (await txt(page, '#chpTitle')) === 'Gathered the evidence', "a chat criterion opens its sources panel");
  await page.click('#chpClose'); await page.waitForTimeout(100);
  // scoring: the draft is private, then Submit
  for (const [k, v] of Object.entries(base)) await page.click(`#cbGrid [data-cb="pick"][data-crit="${k}"][data-v="${v}"]`);
  await page.click('#cbGrid [data-cb="note"][data-crit="ev"]'); await page.fill('[data-cbnote="ev"]', 'Set the hours without checking the schedule.');
  await page.click('#cbGrid button[data-cb="note"][data-crit="ev"]:not(.cbnotebtn)');
  const DP = `data/users/${PAT}/calib_${IK}`;
  await waitDoc(page, DP, `d.marks.ev===1&&d.marks.tone===3&&/schedule/.test(d.notes.ev)`);
  ok(!(await D(page, `calibMarks/${PAT}/items/${IK}`)) && (await txt(page, '#cbFilled')) === '9/9', 'marks save to your private draft (debounced), not shared');
  ok(await asUser(page, HOW, `await db.doc('${DP}').get()`) === 'permission_denied' && await asUser(page, HOW, `await db.doc('calibMarks/${PAT}/items/x').set({a:1})`) === 'permission_denied', "Howard can't read Pat's draft or write Pat's marks");
  await page.click('#cbGrid [data-cb="submit"]'); await waitDoc(page, `calibMarks/${PAT}/items/${IK}`, 'd.submittedAt'); await page.waitForTimeout(150);
  const sub = await D(page, `calibMarks/${PAT}/items/${IK}`);
  ok(JSON.stringify(sub.marks) === JSON.stringify(base) && sub.kind === 'chat' && sub.key === S0 && !JSON.stringify(sub).includes('Pat'), 'Submit copies the draft to calibMarks/<you>/items/<item> (ids only)');
  await page.click(`#cbGrid th[data-col="${HOW}"] [data-cb="peek"]`); await page.waitForTimeout(100);
  ok((await cell(page, 'ev', 2).innerText()).trim().startsWith('2') && (await cell(page, 'ev', 3).innerText()).includes('Not yet'), "Reveal shows Howard's marks only");
  await page.click(`#cbGrid th[data-col="${HOW}"] [data-cb="peek"]`);
  await asUser(page, LIQ, `await db.doc('calibMarks/${LIQ}/items/${IK}').set(${JSON.stringify(Object.assign(subDoc('chat', S0, liqM), { notes: { rs: 'Missed the closing time in the restatement.' } }))})`);
  await page.waitForFunction(l => !!document.querySelector(`#cbGrid th[data-col="${l}"] [data-cb="peek"]`), LIQ, { timeout: 3000 });
  ok(true, "Li Qi submits from her own view: her Reveal appears live");
  // compare, settle, lock
  await page.click('#cbGrid [data-cb="compare"]'); await page.waitForTimeout(150);
  ok((await txt(page, '#cbr-fr .cbsp')) === 'Match' && (await txt(page, '#cbr-ev .cbsp')) === '1 apart' && (await txt(page, '#cbToSettle')) === '3', 'Compare all: spread pills, 3 rows to settle');
  await asUser(page, HOW, `await db.doc('calibItems/${IK}/rows/ev').set({mark:1,note:'Evidence comes before any action.',by:'${HOW}',at:'2026-10-14T15:30:00.000Z'})`);
  await page.waitForFunction(() => { const c = document.querySelector('#cbr-ev .cbag'); return c && c.innerText.trim().startsWith('1') }, null, { timeout: 3000 });
  const settle = async (crit, mark, note) => { if (!(await page.locator(`#cbr-${crit}.open`).count())) await page.click(`#cbr-${crit} > td >> nth=0`); await page.waitForTimeout(80);
    await page.click(`#cbGrid [data-cb="apick"][data-crit="${crit}"][data-v="${mark}"]`); await page.fill(`[data-cbag="${crit}"]`, note); await page.click(`#cbGrid [data-cb="asave"][data-crit="${crit}"]`);
    await waitDoc(page, `calibItems/${IK}/rows/${crit}`, `d.note===${JSON.stringify(note)}`); await page.waitForTimeout(120) };
  await settle('path', 3, 'Setting the hours was the right path.'); await settle('rs', 3, 'Confirmed back in M2.'); await settle('tone', 3, 'Clear and kind, not just polite.');
  ok((await txt(page, '#cbToSettle')) === '0' && await page.locator('#cbGrid [data-cb="lock"]').isEnabled(), 'every row agreed (one live from Howard): Lock on');
  const agreed = Object.assign({}, base, { ev: 1, path: 3, rs: 3, tone: 3 }), pct = B.chatScore(agreed), vd = B.chatVerdict(pct);
  await page.click('#cbGrid [data-cb="lock"]'); await waitDoc(page, 'calibItems/' + IK, 'd.locked');
  const it = await D(page, 'calibItems/' + IK);
  ok(it.locked.pct === pct && it.locked.verdict === vd.id && it.round === LW && JSON.stringify(it.locked.marks) === JSON.stringify(agreed), `Lock writes the agreed score (${pct}%, ${vd.label}) for the week's round`);
  await page.waitForFunction(p => !!window.__data[p], `chatLessons/${S0}_tone`, { timeout: 5000 });
  const les = await page.evaluate(s => Object.fromEntries(Object.entries(window.__data).filter(([p]) => p.startsWith(`chatLessons/${s}_`)).map(([p, d]) => [p.split('_').pop(), d])), S0);
  ok(Object.keys(les).sort().join() === 'ev,path,rs,tone' && les.ev.kind === 'contest' && les.ev.from === '3/3' && les.ev.to === '1/3' && les.ev.by === 'panel' && les.ev.round === 2, 'lessons: a contest where the panel moved Claude, tagged with the Learning round');
  // Learning sync: the round records the panel's agreed score
  const st = await D(page, 'learning/state'), res = st.rounds[1].results;
  ok(res.length === 1 && res[0].sid === S0 && res[0].yourPct === pct && res[0].aiPct === aud(S0).pct && st.rounds[0].status === 'replaced', "Learning: the open round records Claude vs the panel's agreed score");
  await page.waitForTimeout(250);
  ok((await txt(page, '#tkPct')) === fmt(pct) + '%' && (await txt(page, '#cbAgPct')) === fmt(pct) + '%' && (await txt(page, '#cbSent')).includes('Gathered the evidence: Claude 3, agreed 1'), 'the ticket shows the agreed score; sent to the coach');
  await gridShot(page, 'calib-scorecard-agreed.png');
  await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, 'audit-chat.png');

  // ===== 3. a call in the Audit tab: Ticket → Evidence → Scorecard → Coaching
  await page.click('[data-tab="calib"]'); await page.waitForTimeout(200);
  await page.click('[data-cb="open"][data-ik="call_qana2"]'); await page.waitForTimeout(400);
  ok(await tab(page) === 'chat' && await page.evaluate(() => callSel) === 'qana2' && await page.evaluate(() => location.hash) === `#call/${LW}/qana2`, 'a round call opens in the Audit tab (#call/<week>/<id>)');
  ok(await page.locator('#cTicket').isVisible() && await page.locator('#cs-ev').isVisible() && await page.locator('#cs-score').isVisible() && await page.locator('#cs-coach').isVisible(), 'four sections: Ticket, Evidence, Scorecard, Coaching');
  const tk = (await txt(page, '#cbTkPan-ticket')).replace(/\s+/g, ' ');
  ok((await txt(page, '#cTicket .tkid')).includes('Sample Oven qana2') && tk.includes('Ana Ruiz') && tk.includes('R95002') && /CALL TYPE CL/i.test(tk) && /TALK TIME 6:20/i.test(tk) && /LINKED CALLS 2 calls/i.test(tk) && /TEAM Case with Mo Reyes/i.test(tk) && /WIRA TASKS 1 linked/i.test(tk) && await page.locator('#cbTkPan-ticket .tkrec').count() === 2,
    'Ticket: SA, restaurant and code, call type, talk time, linked calls, the other SA on the case, tasks, recordings');
  ok((await page.locator('#cTicket [role=tab]').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim()).join('|') === 'Ticket|Transcript 2', 'tabs: Ticket | Transcript');
  await page.click('#cbTkTab-tx');
  await page.waitForFunction(() => /My pickup order from Sample Oven qana2/.test((document.getElementById('cbTkPan-tx') || {}).innerText || ''), null, { timeout: 4000 });
  ok(await page.locator('#cbTkPan-ticket').isHidden() && await page.locator('#cbTkPan-tx .cbtxleg').count() === 2 && (await txt(page, '#cbTkPan-tx')).includes('Caller: My pickup order') && await page.locator('#cbTkPan-tx a.tkrec').count() === 2, 'Transcript: each linked call with its recording and the speaker-labelled text');
  await page.evaluate(() => document.getElementById('cTicket').scrollIntoView({ block: 'start' })); await shot(page, 'audit-call-transcript.png');
  await page.click('#cbTkTab-ticket'); await page.waitForTimeout(80);
  const br = await page.locator('#cbEvBrief li').allInnerTexts();
  ok(br.length >= 1 && br.length <= 5 && br[0].includes('not ready on time') && await page.locator('#cbEvSrcs .evrow[data-ek="call"] a.rec').count() === 2 && await page.locator('#cbEvSrcs .evrow[data-ek="task"]').count() === 1 && await page.locator('#cbEvSrcs .evrow[data-ek="gd"]').count() === 1, 'Evidence: What happened from the AI facts; a row per call with ▶ Recording, the WIRA task, GreenDot');
  ok(await page.locator('#cbEvFull').isHidden(), 'full sources folded');
  await page.click('#cbEvMore'); await page.waitForTimeout(80);
  ok(await page.locator('#cbEvFull').isVisible() && await page.locator('#cbEvFull .legs li').count() === 2 && (await txt(page, '#cbEvFull')).includes('the ticket never printed') && (await txt(page, '#cbEvFull')).includes('The store remade the order.'), 'Timeline and full sources: the legs, the facts timeline, the task');
  await page.click('#cbEvMore');
  ok(await page.locator('#cbGrid tbody tr[id^="cbr-"]').count() === 12 && (await txt(page, '#cbr-1a > td >> nth=0')).trim() === '–' && await page.locator('#cbr-1a [data-cb="pick"]').count() === 5 && await page.locator('#cbr-1a [data-cb="pick"][data-v="0"]').count() === 1, 'call grid on the live rubric: 12 rows, marks 0–3 and N/A, Claude –');
  await page.click('#cbGrid [data-cb="panel"][data-crit="2b"]'); await page.waitForTimeout(150);
  const pn = await txt(page, '#cbPanel');
  ok(await page.locator('#cbPanel').isVisible() && pn.includes('Root cause and fault') && pn.includes(V2I.find(x => x.id === '2b').lv[0]) && pn.includes(V2I.find(x => x.id === '2b').lv[3]) && pn.includes('the ticket never printed'), "a call criterion opens the panel: its 0–3 levels and the call's facts");
  // rail vs the panel at 1280: the checklist folds above the ticket
  const ov = () => page.evaluate(() => { const p = document.getElementById('cbPanel').getBoundingClientRect(), r = document.getElementById('cbRail').getBoundingClientRect(), t = document.getElementById('cTicket').getBoundingClientRect();
    return { hit: r.right > p.left && r.left < p.right && r.bottom > p.top && r.top < p.bottom, above: r.bottom <= t.top, body: getComputedStyle(document.getElementById('cbRailBody')).display } });
  let o = await ov();
  ok(!o.hit && o.above && o.body === 'none', '1280px with the panel open: the checklist folds to a toggle above the ticket, no overlap');
  await page.click('#cbRail .cbrtog'); await page.waitForTimeout(100); o = await ov();
  ok(!o.hit && o.body !== 'none', 'opened, the list stays clear of the panel');
  await page.click('#cbRail .cbrtog'); await page.click('#cbPanel [data-cb="pclose"]'); await page.waitForTimeout(100);
  ok(await page.locator('#cbPanel').isHidden(), 'the panel closes');
  const cm = callMarks(3); cm['2b'] = 1; cm['2d'] = 2; cm['3b'] = 'na';
  for (const [k, v] of Object.entries(cm)) await page.click(`#cbGrid [data-cb="pick"][data-crit="${k}"][data-v="${v}"]`);
  await page.click('#cbGrid [data-cb="note"][data-crit="2b"]'); await page.fill('[data-cbnote="2b"]', 'Blamed the store before checking the ticket printer.');
  await page.click('#cbGrid button[data-cb="note"][data-crit="2b"]:not(.cbnotebtn)');
  await page.click('#cbGrid [data-cb="submit"]'); await waitDoc(page, `calibMarks/${PAT}/items/call_qana2`, 'd.submittedAt'); await page.waitForTimeout(120);
  await page.click('#cbGrid [data-cb="compare"]'); await page.waitForTimeout(120);
  await page.click('#cbGrid [data-cb="lock"]'); await waitDoc(page, 'calibItems/call_qana2', 'd.locked');
  const ci = await D(page, 'calibItems/call_qana2'), cpct = callPct(cm);
  ok(ci.locked.pct === cpct && ci.kind === 'call' && ci.key === 'qana2' && ci.round === LW, `call lock: the live rubric's calc, N/A left out (${cpct}%)`);
  await page.waitForTimeout(250);
  ok((await txt(page, '#tkPct')) === fmt(cpct) + '%' && (await txt(page, '#cvPct')) === fmt(cpct) + '%' && (await txt(page, '#cs-score .qans')).includes('Agreed'), 'the ticket and board show the agreed call score');
  const fix = await page.locator('#cbFixes .fixcard').evaluateAll(x => x.map(c => ({ id: c.dataset.fix, t: c.innerText })));
  ok(await page.locator('#cbWell .cbwchip').count() === 9 && fix.length === 2 && fix[0].id === '2b' && fix[0].t.includes('Blamed the store before checking') && fix[0].t.includes('1/3') && fix[1].id === '2d' && await page.locator('#cbCoachCopy').count() === 1,
    'Coaching from the agreed marks: what went well (9 rows at 3), a card per row below full marks with its note, Copy all');
  ok(!(await page.evaluate(() => Object.keys(window.__data).some(p => p.startsWith('chatLessons/') && p.includes('qana2')))), 'no chat lessons for a call');
  await page.evaluate(() => window.scrollTo(0, 0)); await shot(page, 'audit-call.png');

  // ===== 4. the mixed checklist and Prev / Next across chats and calls
  const R = await page.locator('#cbRail .cbrrow').evaluateAll(x => x.map(r => ({ ik: r.dataset.ik, kind: r.dataset.kind, st: r.dataset.st, cur: r.classList.contains('cur') })));
  ok(R.length === 22 && await page.locator('#cbRail .cbrgrp').count() === 6 && R.filter(r => r.kind === 'call').length === 9 && await page.locator('#cbRail .cbrrow[data-kind="call"] .cbkic.call').count() === 9 && R.find(r => r.cur).ik === 'call_qana2', 'the checklist: 22 items by SA, an icon per kind, the open call highlighted');
  const qi = items.findIndex(x => x.key === 'qana2');
  ok((await txt(page, '#navPos')) === `Week ${WL} · ${qi + 1} of 22`, 'Prev / Next run through the round');
  await page.click('#navPrev'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => callSel) === 'qana1', 'Prev: the call before');
  await page.click('#navPrev'); await page.waitForTimeout(350);
  ok(await page.evaluate(() => callSel) === null && await page.evaluate(() => chatSel) === items[qi - 2].key && await page.locator('#cbGrid').count() === 1, 'Prev again crosses from calls to the last Ana chat');
  await page.click('#navNext'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => callSel) === 'qana1' && (await txt(page, '#navBack')).includes(items[qi - 2].restaurant), 'Next steps back to the call; Back names the chat');
  await page.click('#navBack'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => chatSel) === items[qi - 2].key && await page.evaluate(() => callSel) === null, 'Back returns to that chat');
  // the four statuses
  const [cA, cB, cC] = [items[0], items[1], items[2]];
  await asUser(page, PAT, `await db.doc('calibMarks/${PAT}/items/chat_${cA.key}').set(${JSON.stringify(subDoc('chat', cA.key, base))})`);
  for (const u of [HOW, LIQ]) await asUser(page, u, `await db.doc('calibMarks/${u}/items/chat_${cA.key}').set(${JSON.stringify(subDoc('chat', cA.key, base))})`);
  await asUser(page, PAT, `await db.doc('calibMarks/${PAT}/items/chat_${cB.key}').set(${JSON.stringify(subDoc('chat', cB.key, base))})`);
  await page.waitForTimeout(300);
  const st2 = Object.fromEntries((await page.locator('#cbRail .cbrrow').evaluateAll(x => x.map(r => [r.dataset.ik, [r.dataset.st, r.innerText.replace(/\s+/g, ' ')]]))));
  ok(st2['chat_' + cA.key][0] === 'done' && /All in/.test(st2['chat_' + cA.key][1]) && st2['chat_' + cB.key][0] === 'wait' && /Waiting on others/.test(st2['chat_' + cB.key][1]) && st2['chat_' + cC.key][0] === 'mine' && /Yours to do/.test(st2['chat_' + cC.key][1]) && st2.call_qana2[0] === 'agreed' && st2.call_qana2[1].includes('Agreed ' + fmt(cpct) + '%'),
    'statuses: all in, waiting on others, yours to do, agreed with the score');
  ok((await txt(page, '#cbRailDone')) === '4 of 22 done (you)', '"4 of 22 done (you)"');
  ok(await page.evaluate(() => { const s = document.querySelector('#view-chat .cside'), r = document.getElementById('cbRail').getBoundingClientRect(), c = document.querySelector('#view-chat .ccol').getBoundingClientRect(); return getComputedStyle(s).position === 'sticky' && r.left >= c.right }), '1280px: the checklist sits in the sticky right column');
  // 390px: the toggle above the ticket
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(200);
  o = await page.evaluate(() => { const r = document.getElementById('cbRail').getBoundingClientRect(), t = document.getElementById('cTicket').getBoundingClientRect(); return { above: r.bottom <= t.top, body: getComputedStyle(document.getElementById('cbRailBody')).display } });
  ok(o.above && o.body === 'none' && await width(page) <= 390, '390px chat: a Round checklist toggle above the ticket, no overflow');
  await page.evaluate(() => openCall('qana2')); await page.waitForTimeout(300);
  ok(await width(page) <= 390 && await page.evaluate(() => [...document.querySelectorAll('#cTicket, #cs-ev, #cs-coach, #chNav button')].every(e => e.getBoundingClientRect().right <= 391)), '390px call audit: no horizontal overflow');
  await shot(page, 'audit-call-390.png', true);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(120);
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('cTicket')).backgroundColor) !== 'rgb(255, 255, 255)' && await width(page) <= 390, 'dark: the call audit takes the dark tokens');
  await page.setViewportSize({ width: 1280, height: 900 }); await page.waitForTimeout(150);
  await shot(page, 'audit-call-dark.png');
  await page.emulateMedia({ colorScheme: 'light' });

  // ===== 5. Learning lists the round's chats; the Round tab after two agreed items
  await page.click('[data-tab="learn"]'); await page.waitForTimeout(200);
  ok(await page.locator('#lrRound .lrrow').count() === 13 && (await txt(page, '#lrRound .bhd h2')) === 'Round 2' && await page.locator('#lrRound [data-go="calib"]').count() === 1 && await page.locator('#lrDraw').count() === 0, "Learning: Round 2 lists the week's 13 chats; drawing happens in the Round tab");
  await page.click('[data-tab="calib"]'); await page.waitForTimeout(250);
  ok((await txt(page, '#cbkAgreed b')) === '2 / 22' && (await txt(page, '#cbkAgreed .hint')).startsWith('1 chat · 1 call') && (await txt(page, '#cbSum')).endsWith('you: 4 of 22 done') && (await txt(page, '#cbGo')).startsWith('Continue'), 'KPIs split by kind; header and Continue move on');
  ok((await txt(page, '#cbkSame b')) === Math.round(18 / 21 * 100) + '%' && (await txt(page, '#cbkClaude b')) === Math.round(B.CHAT_RUBRIC.filter(r => String(aud(S0).scores[r.id]) === String(agreed[r.id])).length / 9 * 100) + '%', 'Same mark and Claude vs agreed');
  ok(await page.locator('#cbDisChat .cbbar').count() >= 3 && /hint/.test(await page.locator('#cbDisCall').getAttribute('class')) && await page.locator('#cbEach .cbbar').count() === 4, 'Where we disagree most, split by Chats and Calls; each grader vs agreed');
  await page.click('#cbGo'); await page.waitForTimeout(300);
  ok(await page.evaluate(() => chatSel) === cC.key, 'Continue opens the first item I haven\'t submitted');
  await page.click('[data-tab="calib"]'); await page.waitForTimeout(200);
  await shot(page, 'round-tab.png', true);
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(200);
  ok(await width(page) <= 390 && await page.evaluate(() => [...document.querySelectorAll('#cbItems .cbirow')].every(e => e.getBoundingClientRect().right <= 390)), '390px Round tab: rows stack, no horizontal overflow');
  await shot(page, 'round-tab-390.png', true);
  await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(120);
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('#cbRound')).backgroundColor) !== 'rgb(255, 255, 255)' && await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--g1').trim()) === '#5fc7da' && await width(page) <= 390, 'dark: the Round tab and the grader colours take the dark tokens');
  await shot(page, 'round-tab-390-dark.png', true);
  await page.emulateMedia({ colorScheme: 'light' }); await page.setViewportSize({ width: 1280, height: 900 });
  ok(!errors.length, 'no console errors (Pat) ' + JSON.stringify(errors));

  // ===== 6. old hashes and Call tools
  await page.click('[data-calltools]'); await page.waitForTimeout(200);
  ok(await tab(page) === 'queue' && await page.locator('#sub-calls').isVisible() && (await page.locator('[data-calltools]').getAttribute('aria-current')) === 'page', 'Call tools opens Snapshot with its own row (Snapshot, Calls, Facts)');
  for (const [h, t, extra] of [['#calls', 'calls'], ['#queue', 'queue'], ['#facts', 'facts'], ['#chats', 'chats'], ['#calib', 'calib'], ['#round', 'calib'], ['#learn', 'learn'], ['#score', 'calls'],
    [`#chat/${LW}/${S0}`, 'chat', () => page.evaluate(() => callSel === null && chatSel === '9930010')], [`#call/${LW}/qana3`, 'chat', () => page.evaluate(() => callSel === 'qana3' && !!document.querySelector('#cTicket[data-call="qana3"]'))]]) {
    await page.goto('http://qa.test/' + h); await page.reload(); await page.waitForTimeout(600);
    ok(await tab(page) === t && (await page.locator('#sub-calls').isVisible()) === ['calls', 'queue', 'facts'].includes(t) && (!extra || await extra()), `${h} still opens ${t}`) }
  ok(!errors.length, 'no console errors (hashes) ' + JSON.stringify(errors));

  // ===== 7. Howard's view: not the owner
  await page.goto('http://qa.test/#calib'); await page.reload(); await page.waitForTimeout(600);
  await page.evaluate(h => window.__switch(h), HOW).catch(() => {}); await page.waitForLoadState('load'); await page.waitForTimeout(800);
  ok(await page.evaluate(() => myId) === HOW && await page.evaluate(() => amOwner) === false && await tab(page) === 'calib', 'reloaded as Howard (not the owner), on the Round');
  ok(await page.locator('#cbGrBtn, #cbDraw, #cbRedraw').count() === 0, 'no Graders, Draw or Redraw for him');
  await page.click(`[data-cb="open"][data-ik="chat_${cC.key}"]`); await page.waitForTimeout(350);
  ok(/you/i.test(await txt(page, `#cbGrid th[data-col="${HOW}"]`)) && await page.locator('#cbr-fr [data-cb="pick"]').count() > 0, 'Howard scores in his own column');
  ok(!(await page.evaluate(() => (window.__denied || []).length)), "the page never reads someone else's draft");
  ok(!errors.length, 'no console errors (Howard) ' + JSON.stringify(errors));
  await ctx.close();

  // ===== 8. World B: the draw
  {
    const seedB = base0.concat([['learning/state', oldState], prevRound], joined);
    ({ page, ctx, errors } = await openPage(b, seedB, { people, room: true, sampleMs: 30 }, { width: 1280, height: 900 }, { now: NOW, tx: TXI }));
    await page.goto('http://qa.test/'); await page.waitForTimeout(700);
    await page.evaluate(h => window.__switch(h), HOW).catch(() => {}); await page.waitForLoadState('load'); await page.waitForTimeout(700);
    ok((await txt(page, '#cbNone')) === 'No round for this week yet.' && await page.locator('#cbDraw').count() === 0, 'no round: the line only for a grader who is not the owner');
    await page.evaluate(p => window.__switch(p), PAT).catch(() => {}); await page.waitForLoadState('load'); await page.waitForTimeout(800);
    ok((await txt(page, '#cbNone')) === 'No round for this week yet.' && await page.locator('#cbDraw').isVisible(), 'the owner sees Draw');
    await page.click('#cbDraw'); await waitDoc(page, 'calibRounds/' + LW);
    const rd = await D(page, 'calibRounds/' + LW), cnt = (sa, k) => rd.items.filter(x => x.sa === sa && x.kind === k).length;
    ok(rd.week === LW && rd.by === PAT && JSON.stringify(rd.sas) === JSON.stringify(SAS) && rd.items.length === 22, 'Draw writes calibRounds/<week>: 22 items for the 6 SAs');
    ok(['Ana Ruiz', 'Ben Okafor'].every(sa => cnt(sa, 'chat') === 3 && cnt(sa, 'call') === 3) && cnt('Cleo Marsh', 'chat') === 2 && cnt('Cleo Marsh', 'call') === 1 && cnt('Dev Patel', 'call') === 0 && cnt('Eli Novak', 'call') === 2 && cnt('Faye Lund', 'chat') === 1, '3 chats and 3 calls per SA; a short SA gets what exists');
    const anaChats = rd.items.filter(x => x.sa === 'Ana Ruiz' && x.kind === 'chat').map(x => x.key), anaCalls = rd.items.filter(x => x.sa === 'Ana Ruiz' && x.kind === 'call').map(x => x.key).sort();
    ok(anaChats.includes(L.list[0].sid) && JSON.stringify(anaCalls) === '["qana2","qana3","qana4"]', 'items not drawn before come first (the one Ana chat outside the old Learning round; her calls skip the one drawn last week)');
    ok(!rd.items.some(x => x.key === 'qben4' || x.key === 'qold1') && rd.items.filter(x => x.kind === 'chat').every(x => x.aiPct === aud(x.key).pct), 'removed and other-week calls are never drawn; chats carry Claude\'s score at draw');
    let stB = await D(page, 'learning/state');
    ok(stB.rounds.length === 2 && stB.rounds[0].status === 'replaced' && stB.rounds[0].replacedAt && stB.rounds[1].status === 'open' && stB.rounds[1].week === LW && stB.week === LW && stB.rounds[1].sample.length === 13
      && stB.rounds[1].sample.every(x => { const a = aud(x.sid); return x.aiPct === a.pct && x.aiVerdict === a.verdict && JSON.stringify(x.aiScores) === JSON.stringify(a.scores) }), 'Learning: the old open round is marked replaced (kept), the new one lists the 13 chats with Claude at draw');
    await page.waitForTimeout(250);
    ok((await txt(page, '#cbSum')) === '22 items · you: 0 of 22 done' && await page.locator('#cbRedraw').isVisible() && await page.locator('#cbRdConfirm').count() === 0, 'the round shows; Redraw while nobody has submitted');
    await page.click('#cbRedraw'); await page.waitForTimeout(100);
    ok(await page.locator('#cbRdConfirm').isVisible() && (await txt(page, '#cbRdConfirm')).includes('Replace this week\'s 22 items'), 'Redraw asks in the page first');
    await page.click('#cbRdConfirm [data-cb="redraw"]'); await page.waitForTimeout(100);
    ok(await page.locator('#cbRdConfirm').count() === 0 && (await D(page, 'calibRounds/' + LW)).drawnAt === rd.drawnAt, 'Cancel leaves the round alone');
    await page.click('#cbRedraw'); await page.click('#cbRdGo');
    await page.waitForFunction(() => window.__data['learning/state'].rounds.length === 3, null, { timeout: 5000 }); await page.waitForTimeout(200);
    stB = await D(page, 'learning/state');
    ok(stB.rounds.length === 3 && stB.rounds[1].status === 'replaced' && stB.rounds[2].status === 'open' && (await D(page, 'calibRounds/' + LW)).items.length === 22, 'Redraw replaces the round and its Learning round');
    const first = (await D(page, 'calibRounds/' + LW)).items[0];
    await asUser(page, HOW, `await db.doc('calibMarks/${HOW}/items/${first.kind}_${first.key}').set(${JSON.stringify(subDoc(first.kind, first.key, {}))})`); await page.waitForTimeout(250);
    ok(await page.locator('#cbRedraw').count() === 0, 'once anyone submits, no Redraw');
    ok(!errors.length, 'no console errors (draw) ' + JSON.stringify(errors));
    await ctx.close();
  }

  // ===== 9. World C: expected graders. Only Pat has opened it (and his name doesn't resolve: the owner counts as Pat)
  {
    const seedC = base0.concat([['learning/state', stateA], prevRound, roundA, joined[0]]);
    ({ page, ctx, errors } = await openPage(b, seedC, { people: { [HOW]: 'Howard', [LIQ]: 'Li Qi' }, room: true, sampleMs: 30 }, { width: 1280, height: 900 }, { now: NOW, tx: TXI }));
    await page.goto('http://qa.test/'); await page.waitForTimeout(700);
    ok(await page.locator(`#cbItems .cbirow[data-ik="${IK}"] .cbdot`).count() === 3 && await page.locator(`#cbItems .cbirow[data-ik="${IK}"] .cbdot.pend`).count() === 2, 'the list: three dots per item, two pending');
    await page.click(`[data-cb="open"][data-ik="${IK}"]`); await page.waitForTimeout(400);
    const ph = await page.locator('#cbGrid thead th.pend').allInnerTexts();
    ok(ph.length === 2 && /Howard/i.test(ph[0]) && /Li Qi/i.test(ph[1]) && await page.locator('#cbGrid thead th.pend .cbav.pend').count() === 2 && (await page.locator('#cbGrid thead th.pend .cbav').nth(1).innerText()) === 'LQ', 'one joined grader: two pending columns, Howard and Li Qi, dashed initials');
    ok((await cell(page, 'ev', 2).innerText()).includes("Hasn't opened it") && /0 of 3/.test(await txt(page, '#cbGrid .cbstatus')), '"Hasn\'t opened it"; the status counts to 3');
    await gridShot(page, 'calib-pending.png');
    for (const [k, v] of Object.entries(base)) await page.click(`#cbGrid [data-cb="pick"][data-crit="${k}"][data-v="${v}"]`);
    await page.click('#cbGrid [data-cb="submit"]'); await waitDoc(page, `calibMarks/${PAT}/items/${IK}`, 'd.submittedAt'); await page.waitForTimeout(150);
    ok(/1 of 3/.test(await txt(page, '#cbGrid .cbstatus')), 'after submit: 1 of 3 submitted');
    await page.click('#cbGrid [data-cb="compare"]'); await page.waitForTimeout(120); await page.click('#cbGrid [data-cb="lock"]'); await waitDoc(page, 'calibItems/' + IK, 'd.locked');
    await page.click('[data-tab="calib"]'); await page.waitForTimeout(250);
    const each = await page.locator('#cbEach .cbbar').allInnerTexts();
    ok(each.length === 4 && /Howard/.test(each[1]) && /–/.test(each[1]) && /Li Qi/.test(each[2]) && await page.locator('#cbEach .cbav.pend').count() === 2, 'Each grader vs agreed: Howard and Li Qi listed, empty');
    await page.click('#cbGrBtn'); await page.waitForTimeout(100);
    ok((await page.inputValue('#cbGrIn')) === 'Pat, Howard, Li Qi', 'the editor starts from the default names');
    await page.fill('#cbGrIn', 'Pat, Howard, Li Qi, Mara'); await page.click('#cbGrEd [data-cb="grsave"]');
    await waitDoc(page, 'settings/calibGraders', 'd.expected.length===4'); await page.waitForTimeout(200);
    ok(JSON.stringify((await D(page, 'settings/calibGraders')).expected) === '["Pat","Howard","Li Qi","Mara"]' && await page.locator(`#cbItems .cbirow[data-ik="call_qana1"] .cbdot.pend`).count() === 3, 'Save writes settings/calibGraders; a fourth pending dot');
    await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
    await page.click('#cbGrBtn'); await page.waitForTimeout(100);
    ok(await width(page) <= 390 && await page.evaluate(() => document.getElementById('cbGrEd').getBoundingClientRect().right <= 390), '390px: the graders editor fits');
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.evaluate(h => window.__switch(h), HOW).catch(() => {}); await page.waitForLoadState('load'); await page.waitForTimeout(800);
    await page.click('[data-cb="open"][data-ik="call_qana1"]'); await page.waitForTimeout(400);
    const ph2 = await page.locator('#cbGrid thead th.pend').allInnerTexts();
    ok(await page.locator('#cbGrid thead th[data-col]').count() === 4 && ph2.length === 2 && /Li Qi/i.test(ph2[0]) && /Mara/i.test(ph2[1]) && /Pat/i.test(await txt(page, `#cbGrid th[data-col="${PAT}"]`)), "Howard's view of a call: Pat (owner, by join order), Howard, then Li Qi and Mara pending");
    ok(!errors.length, 'no console errors (pending graders) ' + JSON.stringify(errors));
    await ctx.close();
  }

  // ===== 10. World D: Claude grades calls. qana1 comes pre-graded (callGrades/qana1), the rest are not; gradeCall is the mock's stand-in
  {
    const QG = 'qana1', cgScores = Object.assign(callMarks(3), { '2b': 2, '2d': 1, '3b': 'na' }), cgPct = callPct(cgScores);
    const cgF = { timeline: [{ id: 'F1', src: 'Call 1', when: '0:12', who: 'Caller', kind: 'said', what: 'Says the pickup order was not ready' },
      { id: 'F2', src: 'Call 1', when: '1:40', who: 'Ana Ruiz', kind: 'did', what: 'Called the store, which said the ticket never printed' },
      { id: 'F3', src: 'Call 1', when: '3:05', who: 'Ana Ruiz', kind: 'said', what: 'Says someone will call back about the printer' }], claims: [], promises: [] };
    const grade = (s, why) => ({ scores: s, reasons: Object.fromEntries(Object.keys(s).map(k => [k, why[k] || 'Handled as expected (F1).'])), cites: { '2b': ['F2'], '2d': ['F2', 'F3'] },
      wentWell: ['Called the store at once', 'Kept the caller updated'], fixes: [{ id: '2b', what: "Took the store's word that the ticket never printed.", should: 'Check the printer log before naming the fault.' },
        { id: '2d', what: 'No fix for the next order.', should: 'Log a WIRA task for the printer.' }], summary: 'Quick and polite; blamed the store without checking.' });
    const G1 = grade(cgScores, { '2b': 'Named the store as the fault without checking the printer.', '2d': 'Promised a callback with no time.' });
    const cgDoc = Object.assign({ v: 1, at: '2026-10-13T20:00:00.000Z', by: 'claude-checkpoint', items: V2I.map(x => x.id), F: cgF, A: { summary: 'The ticket did not print.' } }, G1);
    const oldLessons = Array.from({ length: 22 }, (_, i) => [`callLessons/qold${i}_1a`, { kind: 'contest', item: 'call', queueId: 'qold' + i, crit: '1a', from: '3/3', to: '2/3', reason: 'Old lesson', by: 'panel', at: `2026-09-${String(10 + (i % 18)).padStart(2, '0')}T10:00:00.000Z` }]);
    const seedD = base0.concat([['learning/state', stateA], prevRound, roundA, ['callGrades/' + QG, cgDoc]], joined, oldLessons);
    const G3 = grade(Object.assign(callMarks(2), { '1a': 3 }), {});
    ({ page, ctx, errors } = await openPage(b, seedD, { people, room: true, sampleMs: 30, gradeCall: true, callFacts: cgF, callGrade: G3 }, { width: 1280, height: 900 }, { now: NOW, tx: TXI }));
    await page.goto('http://qa.test/'); await page.waitForTimeout(700);
    const nCG = () => page.evaluate(() => Object.keys(window.__data).filter(p => p.startsWith('callGrades/')).length);
    // the Round tab: call rows carry Claude's score, read once with get(), never a live listener on the whole collection
    await page.waitForFunction(q => /Claude \d/.test((document.querySelector(`#cbItems .cbirow[data-ik="call_${q}"]`) || {}).innerText || ''), QG, { timeout: 4000 });
    ok((await txt(page, `#cbItems .cbirow[data-ik="call_${QG}"]`)).replace(/\s+/g, ' ').includes(`CL · 4:10 · Claude ${fmt(cgPct)}%`) && (await txt(page, '#cbItems .cbirow[data-ik="call_qana3"]')).includes('Claude –'), `Round rows: a graded call shows Claude ${fmt(cgPct)}%, an ungraded one "Claude –"`);
    ok(!(await page.evaluate(() => window.__subs.some(s => s.path === 'callGrades' && s.on))), 'no listener on the callGrades collection (docs are big)');
    ok((await txt(page, '#cbGradeAll')).replace(/\s+/g, ' ') === "Grade the round's calls (8)", "the owner gets \"Grade the round's calls (8)\"");
    // the call audit: Claude's column, score, draft coaching
    await page.click(`[data-cb="open"][data-ik="call_${QG}"]`); await page.waitForTimeout(400);
    ok(await page.evaluate(q => window.__subs.some(s => s.path === 'callGrades/' + q && s.kind === 'doc' && s.on), QG), 'the open call watches only its own grade doc');
    ok((await txt(page, '#cbr-2b > td >> nth=0')).trim() === '2' && (await txt(page, '#cbr-2d > td >> nth=0')).trim() === '1' && (await txt(page, '#cbr-3b > td >> nth=0')).trim() === 'N/A' && (await txt(page, '#cbr-1a > td >> nth=0')).trim() === '3', "Claude's column shows its marks per row");
    ok((await txt(page, '#tkClaude')).replace(/\s+/g, ' ').includes(`Claude's score ${fmt(cgPct)}%`) && (await txt(page, '#cvClaude')) === fmt(cgPct) + '%' && (await txt(page, '#cbGradeBtn')) === 'Re-grade', "Claude's score in the ticket header and board (live rubric calc); Re-grade");
    ok(await page.locator('#cbDraftTag').isVisible() && (await txt(page, '#cs-coach .qans')).includes("Claude's draft") && await page.locator('#cbDWell li').count() === 2 && await page.locator('#cbDFixes .fixcard').count() === 2
      && (await page.locator('#cbDFixes .fixcard').first().getAttribute('data-fix')) === '2b' && (await txt(page, '#cbDFixes .fixcard >> nth=0')).includes('Check the printer log'), "Coaching before the lock: Claude's draft (went well, fixes)");
    await page.click('#cbGrid [data-cb="panel"][data-crit="2b"]'); await page.waitForTimeout(150);
    const pc = (await txt(page, '#cbPClaude')).replace(/\s+/g, ' ');
    ok(pc.includes('Claude: 2 · Named the store as the fault without checking the printer. · F2') && await page.locator('#cbPClaude .cbcited li').count() === 1 && pc.includes('the ticket never printed'), 'facts panel: "Claude: 2 · reason · F2" with the cited fact from its F list');
    ok(await page.locator('#cbPanel .cbfacts:not(.cbcited) li.cited').count() === 1, 'the cited fact is marked in the full list');
    await page.evaluate(() => document.getElementById('cs-score').scrollIntoView({ block: 'start' })); await shot(page, 'audit-call-claude.png');
    await page.click('#cbPanel [data-cb="pclose"]');
    // score, compare: Claude's reason and cites in the Settle card; settle 2d (kept) with a note; lock
    const pm = Object.assign(callMarks(3), { '2b': 1, '2d': 1, '3b': 'na' });
    for (const [k, v] of Object.entries(pm)) await page.click(`#cbGrid [data-cb="pick"][data-crit="${k}"][data-v="${v}"]`);
    await page.click('#cbGrid [data-cb="note"][data-crit="2b"]'); await page.fill('[data-cbnote="2b"]', 'Blamed the store before checking the printer.');
    await page.click('#cbGrid button[data-cb="note"][data-crit="2b"]:not(.cbnotebtn)');
    await page.click('#cbGrid [data-cb="submit"]'); await waitDoc(page, `calibMarks/${PAT}/items/call_${QG}`, 'd.submittedAt'); await page.waitForTimeout(120);
    await page.click('#cbGrid [data-cb="compare"]'); await page.waitForTimeout(120);
    await page.click('#cbr-2b > td >> nth=0'); await page.waitForTimeout(100);
    const card = (await page.locator('#cbGrid .cbdet .cbnt').first().innerText()).replace(/\s+/g, ' ');
    ok(/Claude · 2/.test(card) && card.includes('without checking the printer') && card.includes('F2'), "Settle card: Claude's mark, reason and cited facts");
    await page.click('#cbr-2b > td >> nth=0');
    await page.click('#cbr-2d > td >> nth=0'); await page.waitForTimeout(80);
    await page.click('#cbGrid [data-cb="apick"][data-crit="2d"][data-v="1"]'); await page.fill('[data-cbag="2d"]', 'No callback time promised.'); await page.click('#cbGrid [data-cb="asave"][data-crit="2d"]');
    await waitDoc(page, `calibItems/call_${QG}/rows/2d`, 'd.note==="No callback time promised."'); await page.waitForTimeout(120);
    await page.click('#cbGrid [data-cb="lock"]'); await waitDoc(page, 'calibItems/call_' + QG, 'd.locked');
    await page.waitForFunction(q => !!window.__data[`callLessons/${q}_2d`], QG, { timeout: 4000 });
    const cl = await page.evaluate(q => Object.fromEntries(Object.entries(window.__data).filter(([p]) => p.startsWith(`callLessons/${q}_`)).map(([p, d]) => [p.split('_').pop(), d])), QG);
    ok(Object.keys(cl).sort().join() === '2b,2d' && cl['2b'].kind === 'contest' && cl['2b'].from === '2/3' && cl['2b'].to === '1/3' && cl['2b'].reason === 'Blamed the store before checking the printer.' && cl['2b'].by === 'panel' && cl['2b'].queueId === QG && cl['2b'].label === 'Root cause and fault'
      && cl['2d'].kind === 'reinforce' && cl['2d'].from === '1/3' && cl['2d'].to === '1/3' && cl['2d'].reason === 'No callback time promised.', 'lock writes callLessons: a contest where agreed ≠ Claude, a reinforce where equal with a note');
    await page.waitForTimeout(200);
    ok(await page.locator('#cbDraftTag').count() === 0 && await page.locator('#cbFixes .fixcard').count() === 2 && (await txt(page, '#cbSent')).includes('Root cause and fault: Claude 2, agreed 1'), 'after the lock, coaching comes from the agreed marks; sent to the coach');
    // Grade with Claude on an ungraded call: transcripts through Lightdash, sample with cache off, the newest 20 lessons, one doc written
    await page.evaluate(() => openCall('qana3')); await page.waitForTimeout(400);
    ok((await txt(page, '#tkClaude')).includes('Not graded yet') && (await txt(page, '#cvClaude')) === 'Not graded yet' && (await txt(page, '#cbGradeBtn')) === 'Grade with Claude' && (await txt(page, '#cbr-1a > td >> nth=0')).trim() === '–', '"Not graded yet" and Grade with Claude on an ungraded call');
    await page.evaluate(() => { window.__opts.sampleMs = 250 });
    await page.click('#cbGradeBtn');
    await page.waitForFunction(() => /Grading/.test((document.getElementById('cbGrRun') || {}).innerText || ''), null, { timeout: 3000 });
    ok(await page.locator('#cbGrStop').isVisible(), 'a progress line with Stop while it runs');
    await waitDoc(page, 'callGrades/qana3', '', 6000); await page.waitForTimeout(200);
    const g3 = await D(page, 'callGrades/qana3'), gc3 = await page.evaluate(() => window.__gradeCalls[0]), pr = await page.evaluate(() => window.__prompts.filter(p => /^MOCK CALL/.test(p.input)));
    ok(g3.by === PAT && g3.items.length === 12 && JSON.stringify(g3.scores) === JSON.stringify(G3.scores) && g3.F.timeline.length === 3 && g3.summary === G3.summary && g3.at, 'Grade writes callGrades/<queueId> {v, at, by, items, scores, reasons, cites, wentWell, fixes, summary, F, A}');
    ok(gc3.id === 'qana3' && gc3.tx === 1 && gc3.items.length === 12 && gc3.lessons.length === 20 && gc3.lessons.slice(0, 2).sort().join() === `${QG}_2b,${QG}_2d` && pr.length === 2 && pr.every(p => p.cache === false && p.tier === 'default'), 'gradeCall gets the transcript, the rubric, the newest 20 call lessons; sample with cache off');
    ok((await txt(page, '#cbGradeBtn')) === 'Re-grade' && (await txt(page, '#tkClaude')).includes(fmt(callPct(G3.scores)) + '%'), 'then Re-grade and Claude\'s score');
    // Reopen withdraws the call lessons
    await page.evaluate(q => openCall(q), QG); await page.waitForTimeout(400);
    await page.click('#cbGrid [data-cb="reopen"]'); await page.waitForFunction(q => !window.__data[`calibItems/call_${q}`].locked, QG, { timeout: 4000 }); await page.waitForTimeout(200);
    ok(!(await page.evaluate(q => Object.keys(window.__data).some(p => p.startsWith(`callLessons/${q}_`)), QG)) && await page.locator('#cbDraftTag').isVisible(), 'Reopen withdraws the call lessons; the draft coaching is back');
    // lock again for the Round KPIs
    await page.click('#cbGrid [data-cb="lock"]'); await waitDoc(page, 'calibItems/call_' + QG, 'd.locked'); await page.waitForTimeout(200);
    // the Round tab: KPIs and each grader vs agreed now include Claude on calls; the batch with Stop
    await page.click('[data-tab="calib"]'); await page.waitForTimeout(300);
    ok((await txt(page, '#cbkClaude b')) === Math.round(11 / 12 * 100) + '%' && (await txt(page, '#cbkClaude .hint')).includes('calls 92%') && await page.locator('#cbEach .cbbar[data-g="claude"]').count() === 1, 'Claude vs agreed counts calls (11 of 12 rows); Claude in each grader vs agreed');
    ok((await txt(page, '#cbItems .cbirow[data-ik="call_qana3"]')).includes(`Claude ${fmt(callPct(G3.scores))}%`) && (await txt(page, '#cbGradeAll')).includes('(7)'), 'the new grade shows in the round; 7 left');
    await shot(page, 'round-tab-calls.png', true);
    const before = await nCG();
    await page.evaluate(() => { window.__opts.sampleMs = 500 });
    await page.click('#cbGradeAll');
    await page.waitForFunction(() => /Grading 1 of 7/.test((document.getElementById('cbRoundRun') || {}).innerText || ''), null, { timeout: 3000 });
    ok(await page.locator('#cbRoundStop').isVisible() && await page.locator('#cbGradeAll').count() === 0, 'the batch shows "Grading 1 of 7 · …" and Stop');
    await page.waitForFunction(n => Object.keys(window.__data).filter(p => p.startsWith('callGrades/')).length > n, before, { timeout: 6000 });
    await page.waitForFunction(() => /Grading 2 of 7/.test((document.getElementById('cbRoundRun') || {}).innerText || ''), null, { timeout: 3000 });
    await page.click('#cbRoundStop');
    await page.waitForFunction(() => /Stopped · 1 graded/.test((document.getElementById('cbRoundNote') || {}).innerText || ''), null, { timeout: 3000 }); await page.waitForTimeout(700);
    ok(await nCG() === before + 1 && (await txt(page, '#cbGradeAll')).includes('(6)'), 'Stop cancels the call in hand: one graded, 6 left');
    ok(await page.evaluate(() => window.__gradeCalls.length) === 3, 'one call at a time, never retried');
    // 390px and dark
    await page.evaluate(q => openCall(q), QG); await page.waitForTimeout(400);
    await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(200);
    ok(await width(page) <= 390 && await page.evaluate(() => ['tkClaude', 'cbGradeBox', 'cs-coach'].every(id => document.getElementById(id).getBoundingClientRect().right <= 391)), '390px: Claude\'s score, the grade box and coaching fit');
    await page.click('#cbGrid [data-cb="panel"][data-crit="2b"]'); await page.waitForTimeout(150);
    ok(await width(page) <= 390 && await page.evaluate(() => document.getElementById('cbPClaude').getBoundingClientRect().right <= 391), '390px: the panel\'s Claude line fits');
    await page.click('#cbPanel [data-cb="pclose"]');
    await page.emulateMedia({ colorScheme: 'dark' }); await page.waitForTimeout(120);
    ok(await page.evaluate(() => getComputedStyle(document.getElementById('cTicket')).backgroundColor) !== 'rgb(255, 255, 255)' && await width(page) <= 390, 'dark at 390px');
    await shot(page, 'audit-call-claude-390-dark.png', true);
    await page.emulateMedia({ colorScheme: 'light' }); await page.setViewportSize({ width: 1280, height: 900 });
    ok(!errors.length, 'no console errors (Claude on calls) ' + JSON.stringify(errors));
    await ctx.close();
  }
  await b.close();
  console.log(`\nui calib: ${n} checks passed`);
})().catch(e => { console.error('TEST FAILED', e); process.exit(1) });
