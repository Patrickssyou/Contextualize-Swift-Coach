// Headless test of the weekly Lightdash pull + call chains, with a mocked window.claude serving real Sep 20–28 rows
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const DIR = path.join(__dirname, '..');
const SHOTS = path.join(DIR, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });
const { openPage } = require('./mock.js');
const log = (...a) => console.log(...a);
const waitPulled = page => page.waitForFunction(() => { const p = window.__data['pulls/2026-09-21']; return p && p.status !== 'running' }, null, { timeout: 20000 });
const qDocs = page => page.evaluate(() => Object.entries(window.__data).filter(([p]) => p.startsWith('queue/')).map(([p, d]) => ({ id: p.slice(6), ...d })));

(async () => {
  const browser = await chromium.launch();
  const seed = [['meta/export', { parentId: 'DISASTERCLASS' }]];

  // ===== 1. auto pull on open (owner), polling path
  let { page, ctx, errors } = await openPage(browser, seed, { slow: true });
  await page.goto('http://qa.test/#queue');
  await waitPulled(page); await page.waitForTimeout(300);
  const pull = await page.evaluate(() => window.__data['pulls/2026-09-21']);
  log('pull doc:', JSON.stringify({ status: pull.status, added: pull.added, partial: pull.partial, rows: pull.rows, counts: pull.counts }));
  const calls = await page.evaluate(() => window.__ld);
  log('lightdash calls:', calls.filter(c => c.tool === 'run_metric_query').length, 'queries,', calls.filter(c => c.tool === 'get_query_result').length, 'polls');
  calls.filter(c => c.tool === 'run_metric_query').forEach(c => log('  q:', c.n, 'rows | limit', c.limit, '|', c.filter));
  let Q = await qDocs(page);
  const Q0 = Q.map(q => q.id).sort();
  const by = {}; Q.forEach(q => { (by[q.agent] = by[q.agent] || []).push(q.kind) }); log('queue by agent:', JSON.stringify(by));
  log('status line:', await page.locator('#pullStatus').innerText(), '| button:', await page.locator('#pullBtn').innerText());
  // Angel's R89617 11:37 chain
  const ang = Q.find(q => q.callId === 'dd2c017b-ab6c-434c-b9df-1a6408ee0ee5');
  log('Angel 11:37:', ang ? JSON.stringify({ link: ang.link, type: ang.type, kind: ang.kind, date: ang.callDate, time: ang.callTime, rid: ang.restaurantId, name: ang.restaurantName, dur: ang.durationSec, chain: { count: ang.chain.count, span: ang.chain.spanSec, talk: ang.chain.talkSec, own: ang.chain.ownSec, agents: ang.chain.agents } }) : 'MISSING');
  if (ang) ang.chain.legs.forEach(l => log('   ', l.sampled ? '*' : ' ', l.at.slice(11), l.who.padEnd(16), l.dir, l.party.padEnd(8), l.sec + 's', l.own ? 'own' : '', l.before ? 'before' : ''));
  const allLegs = Q.flatMap(q => (q.chain && q.chain.legs) || []);
  log('groups in queued chains:', JSON.stringify(allLegs.reduce((m, l) => (m[l.group] = (m[l.group] || 0) + 1, m), {})), '| manuel/wilhelm legs:', allLegs.filter(l => ['mopenagd', 'zzwsuaboksan'].includes(l.login)).length, '| no-login legs:', allLegs.filter(l => !l.login).length);
  const ctxQ = Q.find(q => q.chain && q.chain.legs.some(l => l.group === 'crt')) || Q.find(q => q.chain && q.chain.legs.some(l => !l.graded));
  if (ctxQ) { log('chain with context (' + ctxQ.agent + ', ' + ctxQ.restaurantName + '):'); ctxQ.chain.legs.forEach(l => log('   ', l.sampled ? '*' : ' ', l.at.slice(11), l.who.padEnd(18), (l.group || '').padEnd(7), l.graded ? 'graded' : 'context')) }
  log('leases:', JSON.stringify(await page.evaluate(() => window.__leases.length)));
  await page.screenshot({ path: path.join(SHOTS, 'p1-queue.png'), fullPage: true });
  // expand Angel's chain in the UI
  const card = page.locator('.qcard:not(.qcases)', { hasText: 'Angel Lacsamana' });
  log('Angel card header:', (await card.locator('h3').innerText()).replace(/\n/g, ' | '));
  const det = card.locator('details.chain').first();
  log('Angel chain summary:', await det.locator('summary').innerText());
  await det.locator('summary').click(); await page.waitForTimeout(100);
  log('legs shown:', await det.locator('.leg').count(), '| first leg:', (await det.locator('.leg').first().innerText()).replace(/\s+/g, ' '));
  // snapshot re-render keeps it open
  await page.evaluate(() => window.claude.use('db').then(db => db.doc('meta/ping').set({ t: 1 })));
  await page.evaluate(() => window.claude.use('db').then(db => db.collection('queue').doc('zz-other-week').set({ week: '2026-01-05', agent: 'x', link: 'https://x.y' })));
  await page.waitForTimeout(150);
  log('chain still open after snapshot:', await card.locator('details.chain[open]').count());
  await card.screenshot({ path: path.join(SHOTS, 'p2-angel-card.png') });

  // context chain in the queue card and on the score form
  if (ctxQ) {
    const det2 = page.locator(`details.chain[data-chain="${ctxQ.id}"]`);
    await det2.locator('summary').click(); await page.waitForTimeout(100);
    const item = det2.locator('xpath=..');
    await item.screenshot({ path: path.join(SHOTS, 'p6-context-chain-card.png') });
    log('context card summary:', await det2.locator('summary').innerText());
    await item.locator('[data-q]').click(); await page.waitForTimeout(150);
    await page.locator('#chainWrap').scrollIntoViewIfNeeded();
    await page.locator('#chainWrap').screenshot({ path: path.join(SHOTS, 'p7-context-chain-form.png') });
    log('context graded line:', await page.locator('.chaingraded').innerText());
    await page.click('#resetBtn'); await page.click('#resetBtn');
    await page.click('[data-tab="queue"]'); await page.waitForTimeout(100);
  }
  // ===== 2. score it: chain panel on the form
  const angItem = card.locator('.qitem').filter({ hasText: '11:37 AM' });
  await angItem.locator('[data-q]').click(); await page.waitForTimeout(150);
  log('form: agent', await page.locator('#agentChips [aria-pressed="true"]').innerText(), '| type', await page.locator('#typeChips [aria-pressed="true"]').innerText(), '| rid', await page.inputValue('#fRid'), '| callId', await page.inputValue('#fCallId'), '| date', await page.inputValue('#fDate'));
  log('graded line:', await page.locator('.chaingraded').innerText());
  log('chain panel:', await page.locator('#chainWrap').isVisible(), '|', await page.locator('#chainSum').innerText(), '|', (await page.locator('.chainhead').innerText()).replace(/\s+/g, ' '));
  await page.screenshot({ path: path.join(SHOTS, 'p3-score-chain.png'), fullPage: false });
  // complete + save the audit
  await page.fill('#fReviewer', 'Patrick'); await page.click('#gutChips [data-g="good"]');
  await page.fill('#fRootCause', 'Client called about a wrong item; Angel confirmed with the store manager and called the client back.');
  await page.click('#faultCorrectChips [data-fc="restaurant"]'); await page.click('#faultAgentChips [data-fa="restaurant"]');
  await page.click('#singleTouchChips [data-st="yes"]'); await page.click('#sourceChips [data-src="call_rec"]');
  await page.click('#crit-1a .head');
  const seq = [['3'], ['3'], ['3'], ['3'], ['3'], ['3', 'Right fault: store packed the wrong item'], ['3', 'Credit issued on the callback'], ['n', 'One-off packing error'], ['3'], ['3'], ['2', 'Mentioned CMA, no steps'], ['3']];
  for (const [k, reason] of seq) { await page.keyboard.press(k); if (reason) { await page.waitForTimeout(30); await page.keyboard.type(reason); await page.keyboard.press('Enter') } }
  log('save enabled:', await page.isEnabled('#saveBtn'), '| missing:', JSON.stringify(await page.evaluate(() => missingList().map(m => m[0]))));
  await page.click('#saveBtn'); await page.waitForTimeout(300);
  const aud = await page.evaluate(() => Object.values(window.__data).find(d => d.rubric === 'v2' && d.callId === 'dd2c017b-ab6c-434c-b9df-1a6408ee0ee5'));
  log('saved audit:', aud ? JSON.stringify({ week: aud.week, kind: aud.kind, source: aud.source, name: aud.restaurantName, time: aud.callTime, dur: aud.durationSec, chain: aud.chain && aud.chain.count, total: aud.total, queueId: aud.queueId }) : 'NONE');
  log('next loaded:', await page.locator('#boardFor').innerText(), '| callId', await page.inputValue('#fCallId'), '| chain shown:', await page.locator('#chainWrap').isVisible(), '|', await page.locator('#chainSum').innerText(), '| toast:', await page.locator('#toast').innerText());

  // ===== 3. remove one Brix call, pull again fills the gap without bringing it back
  await page.click('[data-tab="queue"]'); await page.waitForTimeout(100);
  const brix = page.locator('.qcard:not(.qcases)', { hasText: 'Brix Estrope' });
  const firstBrix = await brix.locator('[data-qdel]').first().getAttribute('data-qdel');
  await brix.locator('[data-qdel]').first().click(); await brix.locator('[data-qdel]').first().click(); await page.waitForTimeout(200);
  log('removed doc:', JSON.stringify(await page.evaluate(id => { const d = window.__data['queue/' + id]; return d && { removed: d.removed, agent: d.agent } }, firstBrix)));
  log('Brix card after remove:', (await brix.locator('h3').innerText()).replace(/\n/g, ' | '));
  const before = (await page.evaluate(() => window.__ld.length));
  await page.click('#pullBtn'); await waitPulled(page); await page.waitForFunction(() => !document.querySelector('#pullBtn').disabled, null, { timeout: 20000 }); await page.waitForTimeout(200);
  Q = await qDocs(page);
  const brixLive = Q.filter(q => q.agent === 'Brix Estrope' && !q.removed);
  log('after pull again: Brix live', brixLive.length, 'kinds', brixLive.map(q => q.kind).join(','), '| removed one back?', brixLive.some(q => q.id === firstBrix), '| total live', Q.filter(q => !q.removed && q.week === '2026-09-21').length, '| new ld calls', (await page.evaluate(() => window.__ld.length)) - before);
  log('status:', await page.locator('#pullStatus').innerText(), '| toast:', await page.locator('#toast').innerText());
  // results KPI target uses the queue
  await page.click('[data-tab="results"]'); await page.waitForTimeout(100);
  log('kpi audits:', (await page.locator('.kpi').nth(1).innerText()).replace(/\n+/g, ' | '));

  // ===== 4. export carries the chain columns
  await page.click('#xlsxBtn'); await page.waitForTimeout(800);
  const dl = await page.evaluate(() => window.__saved.map(s => s.bytes));
  if (dl.length) { const wb = XLSX.read(Buffer.from(dl[0])); const rows = XLSX.utils.sheet_to_json(wb.Sheets.audits);
    log('sheets:', wb.SheetNames.join(','));
    const lk = XLSX.utils.sheet_to_json(wb.Sheets.linked_calls);
    log('linked_calls rows for Angel audit:'); lk.filter(x => x.sampled_call_id === 'dd2c017b-ab6c-434c-b9df-1a6408ee0ee5').forEach(x => log('   ', JSON.stringify(x)));
    log('export cols tail:', Object.keys(rows[0]).slice(-9).join(','));
    const r = rows.find(x => x.call_id === 'dd2c017b-ab6c-434c-b9df-1a6408ee0ee5');
    log('export row:', JSON.stringify({ restaurant_name: r.restaurant_name, call_kind: r.call_kind, call_time_et: r.call_time_et, sample_source: r.sample_source, chain_calls: r.chain_calls, chain_span_sec: r.chain_span_sec, chain_talk_sec: r.chain_talk_sec, chain_agent_talk_sec: r.chain_agent_talk_sec, ids: String(r.chain_call_ids).split(';').length, total: r.total_pct }));
  } else log('no download');

  // ===== 4b. database tab
  await page.click('[data-tab="data"]'); await page.waitForTimeout(150);
  log('db bar:', (await page.locator('.dbbar .hint').innerText()));
  log('db summary:', (await page.locator('.dbsum tbody').innerText()).replace(/\t/g, ' ').replace(/\n/g, ' | '));
  log('db sampled rows:', await page.locator('.dbtbl tbody tr').count());
  log('db statuses (sampled view):', JSON.stringify(await page.locator('.dbtbl .st').allInnerTexts().then(a => a.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {}))));
  await page.screenshot({ path: path.join(SHOTS, 'p8-database.png'), fullPage: true });
  await page.click('[data-dbmode="a"]'); await page.waitForTimeout(100);
  log('db all rows:', await page.locator('.dbtbl tbody tr').count(), '| statuses:', JSON.stringify(await page.locator('.dbtbl .st').allInnerTexts().then(a => a.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {}))));
  await page.selectOption('#dbAgent', 'Angel Lacsamana'); await page.waitForTimeout(100);
  log('Angel rows (all):'); for (const t of await page.locator('.dbtbl tbody tr').allInnerTexts()) log('   ', t.replace(/\s+/g, ' '));
  const before2 = await page.evaluate(() => window.__saved.length);
  await page.click('#dbCsv'); await page.waitForTimeout(300);
  const csv = await page.evaluate(n => { const s = window.__saved[n]; return s ? { name: s.filename, text: new TextDecoder().decode(new Uint8Array(s.bytes)) } : null }, before2);
  log('csv:', csv ? csv.name + ' | ' + csv.text.split('\n').length + ' lines | ' + csv.text.split('\n')[0] : 'NONE');
  if (csv) log('csv row 1:', csv.text.split('\n')[1]);
  await page.selectOption('#dbAgent', ''); await page.click('[data-dbmode="s"]');
  // play all + timeline in the queue card
  await page.click('[data-tab="queue"]'); await page.waitForTimeout(100);
  const pa = await page.locator('.qitem a', { hasText: 'Play all' }).first().getAttribute('href');
  log('play all link:', pa, '| timelines in cards:', await page.locator('details.chain .tline').count());

  // ===== 5. reopen: no second auto pull
  const p2 = await ctx.newPage(); // same context shares nothing in-memory; check that a done pull doc stops auto-run
  await p2.close();
  log('console errors (1-4):', JSON.stringify(errors));

  // dark + mobile screenshots of the queue
  await page.click('[data-tab="queue"]');
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
  const card2 = page.locator('.qcard:not(.qcases)', { hasText: 'Angel Lacsamana' }); await card2.scrollIntoViewIfNeeded();
  if (!(await card2.locator('details.chain[open]').count())) await card2.locator('details.chain summary').first().click();
  await page.waitForTimeout(100);
  log('mobile scrollWidth queue:', await page.evaluate(() => document.documentElement.scrollWidth));
  await page.screenshot({ path: path.join(SHOTS, 'p4-mobile-dark-queue.png'), fullPage: true });
  await page.click('[data-tab="score"]'); await page.locator('[data-tab="queue"]').click(); await page.locator('.qcard:not(.qcases)', { hasText: 'Angel Lacsamana' }).locator('[data-q]').first().click(); await page.waitForTimeout(150);
  await page.locator('#chainWrap').scrollIntoViewIfNeeded();
  log('mobile scrollWidth score:', await page.evaluate(() => document.documentElement.scrollWidth));
  await page.screenshot({ path: path.join(SHOTS, 'p5-mobile-dark-chain.png'), fullPage: false });
  await ctx.close();

  // ===== 6. row cap: with every query capped at 120 rows the splits must give the same picks
  ({ page, ctx, errors } = await openPage(browser, seed, { viewer: true }));
  await page.goto('http://qa.test/#queue'); await page.waitForTimeout(500);
  await page.evaluate(() => { PULL.cap = 120; window.__opts.cap = 120 });
  await page.click('#pullBtn'); await waitPulled(page); await page.waitForTimeout(200);
  const capped = (await qDocs(page)).map(q => q.id).sort();
  const calls6 = await page.evaluate(() => window.__ld.filter(c => c.tool === 'run_metric_query'));
  log('capped run:', calls6.length, 'queries, max rows', Math.max(...calls6.map(c => c.n)), '| full answers', calls6.filter(c => c.n >= 120).length, '| partial:', (await page.evaluate(() => window.__data['pulls/2026-09-21'].partial)), '| same picks as uncapped:', JSON.stringify(Q0) === JSON.stringify(capped), '| total', capped.length);
  log('console errors (6):', JSON.stringify(errors));
  await ctx.close();

  // ===== 7. Lightdash not connected: message, no stuck doc, back-off on reload, manual pull later
  ({ page, ctx, errors } = await openPage(browser, seed, { fail: 'server_not_connected' }));
  await page.goto('http://qa.test/#queue'); await page.waitForTimeout(800);
  log('not connected:', await page.locator('#pullStatus').innerText(), '| pulls doc:', JSON.stringify(await page.evaluate(() => window.__data['pulls/2026-09-21'] || null)), '| ld calls', await page.evaluate(() => window.__ld.length));
  log('backoff stored:', await page.evaluate(() => localStorage.getItem('qa.pull.wait') ? 'yes' : 'no'));
  await page.reload(); await page.waitForTimeout(800);
  log('after reload ld calls (expect 0):', await page.evaluate(() => window.__ld.length), '| status:', await page.locator('#pullStatus').innerText());
  await page.evaluate(() => { window.__opts.fail = null });
  await page.click('#pullBtn'); await waitPulled(page); await page.waitForTimeout(200);
  log('manual pull after connect:', (await qDocs(page)).length, 'queued |', await page.locator('#pullStatus').innerText());
  log('console errors (7):', JSON.stringify(errors));
  await ctx.close();

  // ===== 8. view-only viewer: no auto pull; tool error message
  ({ page, ctx, errors } = await openPage(browser, seed, { viewer: true }));
  await page.goto('http://qa.test/#queue'); await page.waitForTimeout(800);
  log('viewer: ld calls', await page.evaluate(() => window.__ld.length), '| status:', await page.locator('#pullStatus').innerText(), '| button enabled:', await page.isEnabled('#pullBtn'));
  await page.evaluate(() => { window.__opts.fail = 'tool_error' });
  await page.click('#pullBtn'); await page.waitForTimeout(500);
  log('tool error:', await page.locator('#pullStatus').innerText(), '| doc:', JSON.stringify(await page.evaluate(() => { const d = window.__data['pulls/2026-09-21']; return d && { status: d.status, error: d.error } })));
  // an open week shows when it opens
  await page.click('#wkNext'); await page.waitForTimeout(100);
  log('open week:', await page.locator('#pullStatus').innerText(), '| button enabled:', await page.isEnabled('#pullBtn'));
  log('console errors (8):', JSON.stringify(errors));
  await ctx.close();

  // ===== 9. already-pulled week on open: no new queries
  ({ page, ctx, errors } = await openPage(browser, seed.concat([['pulls/2026-09-21', { status: 'done', week: '2026-09-21', at: '2026-09-28T15:00:00.000Z', added: 28 }]]), {}));
  await page.goto('http://qa.test/#queue'); await page.waitForTimeout(800);
  log('pre-pulled: ld calls', await page.evaluate(() => window.__ld.length), '| status:', await page.locator('#pullStatus').innerText(), '| button:', await page.locator('#pullBtn').innerText());
  await ctx.close();
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1) });
