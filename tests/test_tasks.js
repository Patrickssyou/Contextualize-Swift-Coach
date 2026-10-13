// Linked WIRA tasks + "What Claude got" case facts, against real Sep 21–27 fixtures
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const XLSX = require('xlsx');
const { openPage, AI } = require('./mock.js');
const SHOTS = path.join(__dirname, '..', 'shots');
const log = (...a) => console.log(...a);
const waitPulled = page => page.waitForFunction(() => { const p = window.__data['pulls/2026-09-21']; return p && p.status !== 'running' }, null, { timeout: 30000 });
const qDocs = page => page.evaluate(() => Object.entries(window.__data).filter(([p]) => p.startsWith('queue/')).map(([p, d]) => ({ id: p.slice(6), ...d })));
const ANG = 'dd2c017b-ab6c-434c-b9df-1a6408ee0ee5';
const seedQ = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'seed/ld-' + ANG + '.json'), 'utf8'));

(async () => {
  const browser = await chromium.launch();
  const seed = [['meta/export', { parentId: 'DISASTERCLASS' }]];

  // ===== 1. the weekly pull links tasks
  let { page, ctx, errors } = await openPage(browser, seed, {});
  await page.goto('http://qa.test/#queue'); await waitPulled(page); await page.waitForTimeout(300);
  const pull = await page.evaluate(() => window.__data['pulls/2026-09-21']);
  log('pull:', JSON.stringify({ status: pull.status, added: pull.added, tasks: pull.tasks, tasksError: pull.tasksError, settings: pull.settings }));
  const tq = (await page.evaluate(() => window.__ld)).filter(c => c.explore === 'wira_tasks');
  log('task queries:', tq.length); tq.forEach(c => log('   ', c.n, 'rows |', c.title, '|', c.filter.slice(0, 90)));
  let Q = await qDocs(page);
  log('queue docs with tasks array:', Q.filter(q => Array.isArray(q.tasks)).length, '/', Q.length, '| total tasks', Q.reduce((t, q) => t + (q.tasks || []).length, 0), '| cases with tasks', Q.filter(q => (q.tasks || []).length).length);
  const ang = Q.find(q => q.callId === ANG);
  log('Angel 11:37 tasks:', JSON.stringify(ang.tasks.map(k => ({ id: k.id, when: k.when, min: k.min, by: k.by, mine: k.mine, cat: k.cat, title: k.title, desc: k.desc, status: k.status, pri: k.pri, closed: k.closed }))));
  const big = Q.reduce((m, q) => Math.max(m, JSON.stringify(q).length), 0); log('largest queue doc bytes:', big);
  log('queue card meta (Angel):', (await page.locator('.qcard:not(.qcases)', { hasText: 'Angel Lacsamana' }).locator('.qmeta').allInnerTexts()).map(t => t.replace(/\s+/g, ' ')).join(' || '));

  // ===== 2. score form: linked tasks + read the calls
  await page.locator('.qcard:not(.qcases)', { hasText: 'Angel Lacsamana' }).locator('.qitem').filter({ hasText: '11:37 AM' }).locator('[data-q]').click(); await page.waitForTimeout(200);
  log('tasks section:', await page.locator('#tasksWrap').isVisible(), '|', await page.locator('#tasksSum').innerText());
  log('task card:', (await page.locator('#tasksPanel .task').first().innerText()).replace(/\s*\n\s*/g, ' | '));
  await page.locator('#tasksWrap').scrollIntoViewIfNeeded(); await page.locator('#tasksWrap').screenshot({ path: path.join(SHOTS, 't1-tasks.png') });
  await page.click('[data-tab="facts"]');
  log('ai panel before:', (await page.locator('#aiPanel').innerText()).replace(/\s*\n\s*/g, ' | '));
  await page.click('#aiRead'); await page.waitForTimeout(30);
  log('ai running:', (await page.locator('#aiPanel').innerText()).replace(/\s*\n\s*/g, ' | '));
  await page.waitForSelector('#aiPanel .cmprow', { timeout: 10000 });
  const pr = await page.evaluate(() => window.__prompts[0]);
  log('prompt: tier', pr.tier, '| length', pr.input.length, '| has CALL 4', pr.input.includes('CALL 4 ·'), '| has task', pr.input.includes('TASK T1781719'), '| graded marks', (pr.input.match(/GRADED/g) || []).length, '| transcripts', (pr.input.match(/\[no transcript\]/g) || []).length, 'missing');
  const qa = await page.evaluate(id => window.__data['queue/ld-' + id].aiFacts, ANG);
  log('queue doc aiFacts saved:', !!qa, qa && JSON.stringify({ v: qa.v, calls: qa.calls, withText: qa.withText, tasks: qa.tasks, faultAgent: qa.faultAgent, faultCorrect: qa.faultCorrect }));
  // reviewer fills their own facts; chips auto-match, text rows get marked
  await page.click('[data-tab="calls"]');
  await page.fill('#fReviewer', 'Patrick'); await page.click('#gutChips [data-g="good"]');
  await page.fill('#fRootCause', 'Store stopped receiving orders and card payments; tech (Mohammed) already working on it.');
  await page.click('#faultCorrectChips [data-fc="tarro"]'); await page.click('#faultAgentChips [data-fa="none"]'); await page.click('#errorTypeChips [data-et="product"]');
  await page.click('#singleTouchChips [data-st="no"]'); await page.click('#sourceChips [data-src="call_rec"]'); await page.click('#sourceChips [data-src="wira"]');
  await page.fill('#fAction', 'Called the store, confirmed tech is on it, called the client back');
  await page.click('[data-tab="facts"]');
  await page.click('[data-m="rootCause"][data-v="same"]'); await page.click('[data-m="actionTaken"][data-v="same"]'); await page.click('[data-m="promised"][data-v="diff"]');
  log('compare rows:'); for (const t of await page.locator('#aiPanel .cmprow:not(.h)').allInnerTexts()) log('   ', t.replace(/\s*\n\s*/g, ' | ').slice(0, 220));
  log('ai head:', (await page.locator('#aiPanel .aihead').innerText()).replace(/\s*\n\s*/g, ' | '));
  await page.locator('#aiPanel').scrollIntoViewIfNeeded(); await page.locator('#aiPanel').screenshot({ path: path.join(SHOTS, 't2-compare.png') });
  // finish scoring + save
  await page.click('[data-tab="calls"]');
  await page.click('#crit-1a .head');
  for (const [k, reason] of [['3'], ['3'], ['3'], ['3'], ['3'], ['3', 'Right: tech outage'], ['3', 'Looped in the store'], ['n', 'Tech owns it'], ['2', 'Task thin'], ['3'], ['n', 'No self-serve'], ['3']]) { await page.keyboard.press(k); if (reason) { await page.waitForTimeout(30); await page.keyboard.type(reason); await page.keyboard.press('Enter') } }
  log('missing:', JSON.stringify(await page.evaluate(() => missingList().map(m => m[0]))));
  await page.click('#saveBtn'); await page.waitForTimeout(300);
  const aud = await page.evaluate(id => Object.values(window.__data).find(d => d.rubric === 'v2' && d.callId === id), ANG);
  log('saved audit:', JSON.stringify({ tasks: aud.tasks && aud.tasks.map(k => k.id), ai: !!aud.aiFacts, match: aud.factsMatch }));
  log('next call loaded:', await page.inputValue('#fCallId'), '| tasks:', await page.locator('#tasksSum').innerText(), '| ai panel:', (await page.locator('#aiPanel').innerText()).replace(/\s*\n\s*/g, ' | '));

  // ===== 3. Stop, then an error that hides the feature
  await page.click('[data-tab="facts"]');
  await page.evaluate(() => { window.__opts.sampleMs = 2000 });
  await page.click('#aiRead'); await page.waitForSelector('#aiStop'); await page.waitForTimeout(150); await page.click('#aiStop'); await page.waitForTimeout(200);
  log('after stop:', (await page.locator('#aiPanel').innerText()).replace(/\s*\n\s*/g, ' | '));
  await page.evaluate(() => { window.__opts.sampleMs = 50; window.__opts.sampleFail = 'not_granted' });
  await page.click('#aiRead'); await page.waitForTimeout(400);
  log('after not_granted:', (await page.locator('#aiPanel').innerText()).replace(/\s*\n\s*/g, ' | '), '| read button left:', await page.locator('#aiRead').count());
  await page.evaluate(() => { window.__opts.sampleFail = null });

  // ===== 4. export: linked_tasks + case_facts_compare
  await page.click('[data-tab="results"]'); await page.click('#xlsxBtn'); await page.waitForTimeout(900);
  const dl = await page.evaluate(() => window.__saved.map(s => s.bytes));
  const wb = XLSX.read(Buffer.from(dl[dl.length - 1]));
  log('sheets:', wb.SheetNames.join(','));
  const T = XLSX.utils.sheet_to_json(wb.Sheets.linked_tasks), Cm = XLSX.utils.sheet_to_json(wb.Sheets.case_facts_compare), A = XLSX.utils.sheet_to_json(wb.Sheets.audits);
  log('linked_tasks:', JSON.stringify(T.map(r => ({ task: r.task_id, timing: r.timing, minutes: r.minutes, by: r.created_by, cat: r.task_category, title: r.title, url: r.wira_url }))));
  log('case_facts_compare:'); Cm.forEach(r => log('   ', r.field.padEnd(14), '| you:', String(r.yours || '').slice(0, 50).padEnd(50), '| claude:', String(r.claude || '').slice(0, 50).padEnd(50), '|', r.match || '-', r.match_source || ''));
  const ar = A.find(r => r.call_id === ANG); log('audit row tail:', JSON.stringify({ tasks: ar.linked_task_ids, v: ar.claude_facts_version, marked: ar.claude_fields_marked, same: ar.claude_fields_same }));
  log('console errors (1-4):', JSON.stringify(errors));
  await ctx.close();

  // ===== 5. precomputed read is hidden until Show; a call with no tasks checked offers Find tasks
  const pre = Object.assign({}, seedQ, { aiFacts: Object.assign({}, AI[ANG], { v: 'facts-1', at: '2026-10-02T14:00:00.000Z', calls: 4, withText: 4, tasks: 1 }), tasks: null, tasksAt: null });
  ({ page, ctx, errors } = await openPage(browser, seed.concat([['queue/ld-' + ANG, pre], ['pulls/2026-09-21', { status: 'done', week: '2026-09-21', at: '2026-09-28T15:00:00.000Z', added: 1 }]]), {}));
  await page.goto('http://qa.test/#queue'); await page.waitForTimeout(400);
  await page.locator('[data-q]').first().click(); await page.waitForTimeout(200);
  log('opened tab:', await page.locator('[role=tab][aria-selected="true"]').getAttribute('data-tab'), '| read bar:', (await page.locator('#readBar').innerText()).replace(/\s*\n\s*/g, ' | '));
  log('precomputed panel:', (await page.locator('#aiPanel').innerText()).replace(/\s*\n\s*/g, ' | '));
  log('tasks before find:', (await page.locator('#tasksPanel').innerText()).replace(/\s*\n\s*/g, ' | '));
  await page.click('#taskFind'); await page.waitForFunction(() => document.querySelectorAll('#tasksPanel .task').length > 0, null, { timeout: 8000 });
  log('tasks after find:', await page.locator('#tasksSum').innerText(), '| queue doc tasks:', JSON.stringify(await page.evaluate(id => (window.__data['queue/ld-' + id].tasks || []).map(k => k.id), ANG)));
  await page.click('[data-tab="facts"]'); await page.click('#aiShow'); await page.waitForTimeout(100);
  log('shown rows:', await page.locator('#aiPanel .cmprow:not(.h)').count(), '| summary:', (await page.locator('.aisum').innerText()).slice(0, 120));
  // mobile + dark
  await page.emulateMedia({ colorScheme: 'dark' }); await page.setViewportSize({ width: 390, height: 860 }); await page.waitForTimeout(150);
  log('mobile scrollWidth:', await page.evaluate(() => document.documentElement.scrollWidth));
  await page.click('[data-tab="calls"]'); await page.locator('#tasksWrap').scrollIntoViewIfNeeded(); await page.screenshot({ path: path.join(SHOTS, 't3-mobile-tasks.png') });
  await page.click('[data-tab="facts"]');
  await page.locator('#aiPanel').scrollIntoViewIfNeeded(); await page.locator('#aiPanel').screenshot({ path: path.join(SHOTS, 't4-mobile-compare.png') });
  log('console errors (5):', JSON.stringify(errors));
  await ctx.close();

  // ===== 6. task lookup fails during the pull: calls still queue, tasks left unchecked
  ({ page, ctx, errors } = await openPage(browser, seed, { taskFail: true }));
  await page.goto('http://qa.test/#queue'); await waitPulled(page); await page.waitForTimeout(300);
  const p6 = await page.evaluate(() => window.__data['pulls/2026-09-21']); Q = await qDocs(page);
  log('task failure: added', p6.added, '| tasksError:', p6.tasksError, '| docs with tasks null:', Q.filter(q => q.tasks === null).length, '| status:', await page.locator('#pullStatus').innerText());
  log('console errors (6):', JSON.stringify(errors));
  await ctx.close();

  // ===== 7. no sample capability: the panel stays out of the way
  ({ page, ctx, errors } = await openPage(browser, seed.concat([['queue/ld-' + ANG, Object.assign({}, seedQ)], ['pulls/2026-09-21', { status: 'done', week: '2026-09-21', at: '2026-09-28T15:00:00.000Z', added: 1 }]]), { noSample: true }));
  await page.goto('http://qa.test/#queue'); await page.waitForTimeout(400); await page.locator('[data-q]').first().click(); await page.waitForTimeout(200);
  log('no sample: ai panel hidden', await page.locator('#aiPanel').isHidden(), '| console errors (7):', JSON.stringify(errors));
  await ctx.close();
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1) });
