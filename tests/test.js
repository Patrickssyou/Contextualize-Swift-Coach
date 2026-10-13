// Headless test of QA Desk v2 with a mocked window.claude
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const DIR = path.join(__dirname, '..');
const SHOTS = path.join(DIR, 'shots'); fs.mkdirSync(SHOTS, { recursive: true });

const SKEL_HEAD = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n';
const page_html = SKEL_HEAD + fs.readFileSync(path.join(DIR, 'dist/pizza-support-qa-desk.html'), 'utf8') + '\n</body></html>';

const V1 = [
 {"id":"amun4rw4xlehx","data":{"agent":"Velka Pasion","by":"u_VOE","callDate":"","callId":"","createdAt":"2026-09-29T20:30:22.065Z","link":"https://greendot.prod.letsdowonders.io/greendot/restaurant/R70105?caller_id=2672319250&callId=10a06864-8fbf-4a68-a7e4-812678e82872","notes":{},"queueId":null,"reviewer":"","scores":{"1a":3,"1b":3,"1c":3,"1d":2,"2a":2,"2b":2,"2c":3,"2d":3,"2e":3,"3a":3,"3b":3,"3c":3},"sections":[75,77.3,100],"take":"","total":82.5,"type":"call","updatedAt":"2026-09-29T20:30:22.066Z","week":"2026-09-21"}},
 {"id":"amun5tw20suky","data":{"agent":"Velka Pasion","by":"u_VOE","callDate":"","callId":"","createdAt":"2026-09-29T20:59:54.888Z","link":"https://greendot.prod.letsdowonders.io/greendot/restaurant/R70273?caller_id=2676485676&callId=248f60f5-27da-4441-9e78-a57ae86bafa8","notes":{},"queueId":null,"reviewer":"","scores":{"1a":2,"1b":2,"1c":2,"1d":3,"2a":3,"2b":3,"2c":3,"2d":1,"2e":3,"3a":3,"3b":1,"3c":1},"sections":[75,72.7,40],"take":"","total":65,"type":"call","updatedAt":"2026-09-29T20:59:54.888Z","week":"2026-09-21"}},
 {"id":"amun6yrlmcwqc","data":{"agent":"Christ Aragon","by":"u_VOE","callDate":"","callId":"","createdAt":"2026-09-29T21:31:42.010Z","link":"","notes":{},"queueId":null,"reviewer":"","scores":{"1a":3,"1b":1,"1c":3,"1d":3,"2a":1,"2b":3,"2c":3,"2d":3,"2e":3,"3a":3,"3b":3,"3c":3},"sections":[87.5,90.9,100],"take":"","total":92.5,"type":"call","updatedAt":"2026-09-29T21:31:42.010Z","week":"2026-09-21"}},
 {"id":"amun7nmc6dxp2","data":{"agent":"Christ Aragon","by":"u_VOE","callDate":"","callId":"","createdAt":"2026-09-29T21:51:01.590Z","link":"","notes":{},"queueId":null,"reviewer":"","scores":{"1a":3,"1b":3,"1c":3,"1d":3,"2a":2,"2b":3,"2c":3,"2d":1,"2e":3,"3a":3,"3b":3,"3c":3},"sections":[100,68.2,100],"take":"","total":82.5,"type":"call","updatedAt":"2026-09-29T21:51:01.590Z","week":"2026-09-21"}},
 {"id":"amuol9j8mzhwd","data":{"agent":"Angel Lacsamana","by":"u_VOE","callDate":"","callId":"","createdAt":"2026-09-30T20:59:45.190Z","link":"","notes":{},"queueId":null,"reviewer":"","scores":{"1a":3,"1b":2,"1c":2,"1d":3,"2a":2,"2b":3,"2c":3,"2d":1,"2e":1,"3a":3,"3b":3,"3c":2},"sections":[81.3,59.1,80],"take":"","total":68.8,"type":"call","updatedAt":"2026-09-30T20:59:45.190Z","week":"2026-09-21"}}
];

const MOCK = (seed) => {
  const data = {}; const listeners = [];
  seed.forEach(([p, d]) => data[p] = d);
  const clone = x => JSON.parse(JSON.stringify(x));
  const snap = p => ({ id: p.split('/').pop(), exists: !!data[p], data: () => data[p] ? clone(data[p]) : undefined, metadata: { fromCache: false, hasPendingWrites: false } });
  const collDocs = c => Object.keys(data).filter(p => p.startsWith(c + '/') && p.split('/').length === c.split('/').length + 1).sort().map(snap);
  const notify = () => listeners.forEach(l => setTimeout(l, 0));
  const docRef = p => ({ id: p.split('/').pop(), path: p,
    async get() { return snap(p) },
    async set(d) { data[p] = clone(d); notify() },
    async update(d) { if (!data[p]) throw { code: 'invalid_argument', message: 'missing' }; Object.assign(data[p], clone(d)); notify() },
    async delete() { delete data[p]; notify() },
    onSnapshot(next) { const l = () => next(snap(p)); listeners.push(l); setTimeout(l, 0); return () => {} } });
  const db = { doc: docRef, collection(c) { return { path: c, doc: id => docRef(c + '/' + (id || Math.random().toString(36).slice(2))),
    onSnapshot(next) { const l = () => { const docs = collDocs(c); next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }) }; listeners.push(l); setTimeout(l, 0); return () => {} } } } };
  window.__data = data; window.__saved = []; window.__mcp = []; let fileN = 0;
  const user = { id: async () => 'u_test', isOwner: async () => true, canEdit: async () => true, can: async () => true };
  const downloads = { save: async ({ filename, data }) => { window.__saved.push({ filename, bytes: Array.from(data instanceof Uint8Array ? data : new Uint8Array(data)) }); return { status: 'saved' } } };
  const mcp = { listTools: async () => ({ servers: [], fileArgs: true }),
    callTool: async (server, tool, input) => { if (window.__failDrive) throw { code: 'needs_reauth', message: 'expired' }; window.__mcp.push({ server, tool, input: { ...input, base64Content: input.base64Content ? (typeof input.base64Content === 'string' ? 'b64:' + input.base64Content.length : 'file') : undefined } });
      if (tool === 'create_file') { fileN++; const id = 'file' + fileN; const folder = input.contentMimeType === 'application/vnd.google-apps.folder';
        return { content: [], payload: { id, title: input.title, mimeType: input.contentMimeType, parentId: input.parentId || 'root', viewUrl: folder ? `https://drive.google.com/drive/folders/${id}` : `https://docs.google.com/spreadsheets/d/${id}/edit` } } }
      if (tool === 'update_file') return { content: [], payload: { id: input.fileId, title: input.title } };
      throw { code: 'bad_request' } } };
  window.claude = { use: async n => ({ db, user, downloads, mcp })[n] ?? null };
};

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage(); await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z'));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()) });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  await page.route('**/*', async route => {
    const u = route.request().url();
    if (u.startsWith('http://qa.test/')) return route.fulfill({ contentType: 'text/html', body: page_html });
    if (u.includes('xlsx.full.min.js')) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(DIR, 'node_modules/xlsx/dist/xlsx.full.min.js')) });
    return route.abort();
  });
  const seed = V1.map(a => ['audits/' + a.id, a.data]).concat([['meta/export', { parentId: 'DISASTERCLASS' }]]);
  await page.addInitScript(MOCK, seed);
  await page.goto('http://qa.test/#score');
  await page.waitForTimeout(400);

  const log = (...a) => console.log(...a);
  const txt = async sel => (await page.locator(sel).first().innerText()).trim();

  // ---- initial state
  log('header:', await txt('.brand span'));
  log('board sub:', await txt('#boardSub'));
  log('missing:', JSON.stringify(await page.evaluate(() => missingList().map(m => m[0]))));
  await page.screenshot({ path: path.join(SHOTS, '01-empty-form.png'), fullPage: false });

  // ---- type switch arming (score one then switch)
  await page.click('#crit-1a .opt[data-v="3"]');
  await page.click('#typeChips [data-t="mgr"]');
  log('armed chip:', await txt('#typeChips [data-t="mgr"]'));
  await page.click('#typeChips [data-t="mgr"]');
  log('after switch type mgr, 3b label:', (await txt('#crit-3b .ttl')).slice(0, 40), '| scores:', await page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('qa.draft.v2')).scores)));
  await page.click('#typeChips [data-t="call"]');
  log('back to call, armed?', await page.locator('#typeChips .arm').count());

  // ---- details
  await page.click('#agentChips [data-a="Velka Pasion"]');
  await page.fill('#fLink', 'https://greendot.prod.letsdowonders.io/greendot/restaurant/R70273?caller_id=2676485676&callId=248f60f5-27da-4441-9e78-a57ae86bafa8');
  log('parsed rid/callId:', await page.inputValue('#fRid'), await page.inputValue('#fCallId'));
  await page.fill('#fDate', '2026-09-29');
  await page.fill('#fReviewer', 'Patrick');
  log('score before gut:', await txt('#bigScore'));
  await page.click('#gutChips [data-g="ok"]');

  // ---- facts
  await page.fill('#fRootCause', 'Menu modifier mapped to the wrong SKU in Greendot; Tarro menu build error.');
  await page.click('#faultCorrectChips [data-fc="tarro"]');
  await page.click('#faultAgentChips [data-fa="restaurant"]');
  await page.click('#errorTypeChips [data-et="process"]');
  await page.click('#singleTouchChips [data-st="yes"]');
  await page.click('#sourceChips [data-src="greendot"]');
  await page.click('#sourceChips [data-src="wira"]');
  await page.fill('#fPromised', 'Credit on next invoice');

  // ---- keyboard scoring: 1a=3 1b=3 1c=NA 1d=2(reason) 2a=3 2b=1(reason) 2c=3(reason) 2d=NA(reason) 2e=0(reason) 3a=3 3b=2(reason) 3c=3
  await page.click('#crit-1a .head');
  const seq = [['3'], ['3'], ['n'], ['2', 'Paused twice without updating the client'], ['3'], ['1', 'Blamed the restaurant; the SKU mapping was ours'], ['3', 'Issued the right credit right away'], ['n', 'One-off menu build issue, already fixed in GD'], ['0', 'No ticket logged'], ['3'], ['2', 'Mentioned CMA but no steps'], ['3']];
  for (const [k, reason] of seq) {
    await page.keyboard.press(k === 'n' ? 'n' : k);
    if (reason) { await page.waitForTimeout(30); const focused = await page.evaluate(() => document.activeElement && document.activeElement.dataset.note); if (!focused) { log('!! reason not focused after', k); }
      await page.keyboard.type(reason); await page.keyboard.press('Enter'); }
  }
  log('scored:', await txt('#scoredCount'));
  log('big score:', await txt('#bigScore'), '| sub:', await txt('#boardSub'));
  log('missing after scoring:', JSON.stringify(await page.evaluate(() => missingList().map(m => m[0]))));
  log('save enabled:', await page.isEnabled('#saveBtn'), '| hint:', await txt('#saveHint'));
  await page.screenshot({ path: path.join(SHOTS, '02-filled-form.png'), fullPage: true });
  await page.click('#saveBtn');
  await page.waitForTimeout(300);
  const saved = await page.evaluate(() => Object.entries(window.__data).filter(([p, d]) => p.startsWith('audits/') && d.rubric === 'v2').map(([p, d]) => d));
  log('saved v2 audits:', saved.length);
  const s0 = saved[0];
  log(JSON.stringify({ week: s0.week, rid: s0.restaurantId, callId: s0.callId, total: s0.total, sections: s0.sections, dims: s0.dims, na: s0.naCount, gut: s0.gut, scores: s0.scores, notesKeys: Object.keys(s0.notes), facts: s0.facts }, null, 0));

  // expected total by hand
  const W = { '1a': .025, '1b': .025, '1c': .05, '1d': .1, '2a': .05, '2b': .2, '2c': .1, '2d': .15, '2e': .05, '3a': .1, '3b': .05, '3c': .1 };
  let E = 0, Wt = 0; for (const [k, v] of Object.entries(s0.scores)) { if (v === 'na') continue; E += v / 3 * W[k]; Wt += W[k] } log('expected total:', Math.round(E / Wt * 1000) / 10);

  // ---- results for week Sep 28
  await page.click('[data-tab="results"]');
  await page.click('#wkNext');
  await page.waitForTimeout(100);
  log('week label:', await txt('#wkLabel'));
  log('kpis:', (await page.locator('.kpis').innerText()).replace(/\n+/g, ' | '));
  await page.screenshot({ path: path.join(SHOTS, '03-results.png'), fullPage: true });

  // ---- add an AE audit + a second SA audit directly to test aggregates
  await page.evaluate(() => {
    const base = JSON.parse(JSON.stringify(Object.values(window.__data).find(d => d.rubric === 'v2')));
    window.claude.use('db').then(db => {
      db.doc('audits/aAE1').set(Object.assign({}, base, { agent: 'Maria Santos', role: 'ae', gut: 'good', total: 70, dims: { communication: 80, investigation: 50, resolution: 75 }, facts: Object.assign({}, base.facts, { faultAgent: 'tarro' }) }));
    });
  });
  await page.waitForTimeout(200);
  log('agent rows:', await page.locator('#resBody table').first().locator('tbody tr').count(), '| SA vs AE present:', await page.locator('text=Super Agents vs AEs').count());
  log('gut disagree section:', await page.locator('text=Gut call disagrees with score').count());

  // ---- v1 older section + rescore
  await page.click('#wkPrev');
  await page.waitForTimeout(100);
  log('older summary:', await txt('details.older summary'));
  await page.click('details.older summary');
  await page.click('[data-rescore="amun5tw20suky"]');
  await page.waitForTimeout(100);
  log('rescore form:', await txt('#boardFor'), '| rid:', await page.inputValue('#fRid'), '| link set:', !!(await page.inputValue('#fLink')));
  await page.click('#resetBtn'); await page.click('#resetBtn');

  // ---- queue paste
  await page.click('[data-tab="queue"]');
  await page.click('#importBox summary');
  await page.fill('#qPaste', [
    'Brix Estrope (3 of 3)',
    'https://greendot.prod.letsdowonders.io/greendot/restaurant/R70411?caller_id=1&callId=c-111\tSep 22 10:14\tBrix Estrope\t4m 12s\tCL\tClient asking about a missed order',
    'https://greendot.prod.letsdowonders.io/greendot/restaurant/R70412?callId=c-222\t2026-09-24 16:05\tBrix Estrope\t7m 40s\tMGR\tWrong quote time on a rushed order',
    'https://greendot.prod.letsdowonders.io/greendot/restaurant/R70413?callId=c-333\t9/26/2026 09:00\tBrix Estrope\t2m 03s\tDE\tVoided order, claims not printed',
    'https://greendot.prod.letsdowonders.io/greendot/restaurant/R70414?callId=c-444\tSep 25 11:30\tBrix Estrope\t3m 10s\tClient moved from chat, wants 1/2 off coupon applied\tCL',
    'https://greendot.prod.letsdowonders.io/greendot/restaurant/R70415?callId=c-555\tSep 23 08:00\tBrix Estrope\t5m 00s\tDriver late\tDE MGR',
  ].join('\n'));
  log('queue preview:', await txt('#qPreview'));
  await page.click('#qAdd');
  await page.waitForTimeout(300);
  const q = await page.evaluate(() => Object.entries(window.__data).filter(([p]) => p.startsWith('queue/')).map(([p, d]) => [d.agent, d.type, d.callDate, d.restaurantId, d.callId, d.week]));
  log('queue docs:', JSON.stringify(q));
  await page.screenshot({ path: path.join(SHOTS, '04-queue.png'), fullPage: true });
  log('queue order:', JSON.stringify(await page.locator('.qitem .qmeta').allInnerTexts()));
  await page.locator('[data-q]').nth(1).click();
  await page.waitForTimeout(100);
  log('from queue -> type:', await page.locator('#typeChips [aria-pressed="true"]').innerText(), '| date:', await page.inputValue('#fDate'), '| rid:', await page.inputValue('#fRid'), '| hint:', await txt('#saveHint'));
  log('mgr 3c label:', (await txt('#crit-3c .ttl')).slice(0, 30));
  log('opened tab:', await page.locator('[role=tab][aria-selected="true"]').getAttribute('data-tab'));
  await page.click('[data-tab="score"]'); await page.click('#resetBtn'); await page.click('#resetBtn');

  // ---- downloads
  await page.click('[data-tab="results"]');
  await page.click('#xlsxBtn');
  await page.waitForTimeout(800);
  const dl = await page.evaluate(() => window.__saved.map(s => ({ filename: s.filename, bytes: s.bytes })));
  log('download:', dl.length ? dl[0].filename + ' ' + dl[0].bytes.length + ' bytes' : 'NONE');
  if (dl.length) {
    const buf = Buffer.from(dl[0].bytes); fs.writeFileSync(path.join(DIR, 'shots', 'export-test.xlsx'), buf);
    const wb = XLSX.read(buf);
    log('sheets:', wb.SheetNames.join(','));
    for (const n of wb.SheetNames) { const rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1 }); log(n, 'rows:', rows.length - 1, '| cols:', rows[0].length); }
    const aud = XLSX.utils.sheet_to_json(wb.Sheets.audits);
    log('audits sample v1:', JSON.stringify(aud.find(r => r.rubric_version === 'v1')).slice(0, 400));
    log('audits sample v2:', JSON.stringify(aud.find(r => r.rubric_version === 'v2' && r.agent_role === 'super_agent')).slice(0, 900));
    const sc = XLSX.utils.sheet_to_json(wb.Sheets.scores);
    log('scores v2 2d row:', JSON.stringify(sc.find(r => r.rubric_version === 'v2' && r.criterion_id === '2d')));
    log('scores v2 2e row:', JSON.stringify(sc.find(r => r.rubric_version === 'v2' && r.criterion_id === '2e')));
    const ru = XLSX.utils.sheet_to_json(wb.Sheets.rubric);
    log('rubric rows by version:', JSON.stringify(ru.reduce((a, r) => (a[r.rubric_version] = (a[r.rubric_version] || 0) + 1, a), {})));
    log('rubric v2 mgr 3b:', JSON.stringify(ru.find(r => r.rubric_version === 'v2' && r.interaction_type === 'mgr_de' && r.criterion_id === '3b')));
    // v1 totals recomputed must match stored
    const v1rows = aud.filter(r => r.rubric_version === 'v1').map(r => [r.agent, r.total_pct]);
    log('v1 recomputed totals:', JSON.stringify(v1rows));
  }

  // ---- drive export twice
  await page.click('#gsBtn'); await page.waitForTimeout(800);
  log('status1:', await txt('#gsStatus'));
  await page.click('#gsBtn'); await page.waitForTimeout(800);
  log('status2:', await txt('#gsStatus'));
  const calls = await page.evaluate(() => window.__mcp);
  calls.forEach(c => log('mcp:', c.tool, JSON.stringify(c.input)));
  log('meta/export:', JSON.stringify(await page.evaluate(() => window.__data['meta/export'])));

  // ---- edit saved v2 audit round-trip
  await page.click('#wkNext'); await page.waitForTimeout(100);
  await page.locator('#resBody [data-edit]').last().click(); await page.waitForTimeout(100);
  log('edit form:', await txt('#boardFor'), '| total:', await txt('#bigScore'), '| missing:', JSON.stringify(await page.evaluate(() => missingList().map(m => m[0]))), '| facts sources:', await page.locator('#sourceChips [aria-pressed="true"]').count());

  // ---- dark + mobile screenshots, overflow
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: path.join(SHOTS, '05-edit-dark.png'), fullPage: false });
  await page.setViewportSize({ width: 400, height: 860 });
  await page.waitForTimeout(150);
  const ov1 = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.screenshot({ path: path.join(SHOTS, '06-mobile-dark-score.png'), fullPage: false });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.click('[data-tab="results"]'); await page.waitForTimeout(100);
  const ov2 = await page.evaluate(() => document.documentElement.scrollWidth);
  await page.screenshot({ path: path.join(SHOTS, '07-mobile-results.png'), fullPage: true });
  await page.click('[data-tab="queue"]'); await page.waitForTimeout(100);
  const ov3 = await page.evaluate(() => document.documentElement.scrollWidth);
  log('mobile scrollWidth score/results/queue:', ov1, ov2, ov3);
  await page.setViewportSize({ width: 1000, height: 900 });
  await page.click('[data-tab="score"]'); await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SHOTS, '08-1000px.png'), fullPage: false });

  // ---- re-score a v1 audit end to end
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('#resetBtn'); await page.click('#resetBtn');
  await page.click('[data-tab="results"]'); await page.click('#wkPrev'); await page.waitForTimeout(100);
  if (!(await page.locator('details.older[open]').count())) await page.click('details.older summary');
  await page.click('[data-rescore="amun4rw4xlehx"]'); await page.waitForTimeout(100);
  await page.fill('#fDate', '2026-09-23'); await page.fill('#fReviewer', 'Patrick');
  await page.click('#gutChips [data-g="good"]');
  await page.fill('#fRootCause', 'Inquiry about payout timing'); await page.click('#faultCorrectChips [data-fc="no_error"]');
  await page.click('#singleTouchChips [data-st="yes"]'); await page.click('#sourceChips [data-src="call_rec"]');
  await page.click('#crit-1a .head');
  for (const k of ['3','3','n','3','3']) await page.keyboard.press(k);
  await page.keyboard.press('n'); await page.keyboard.type('Inquiry only'); await page.keyboard.press('Enter');
  await page.keyboard.press('3'); await page.keyboard.type('Answered payout date correctly'); await page.keyboard.press('Enter');
  await page.keyboard.press('n'); await page.keyboard.type('Nothing to fix long term'); await page.keyboard.press('Enter');
  for (const k of ['3','3','3','3']) await page.keyboard.press(k);
  log('rescore missing:', JSON.stringify(await page.evaluate(() => missingList().map(m => m[0]))), '| score:', await txt('#bigScore'));
  await page.click('#saveBtn'); await page.waitForTimeout(300);
  await page.click('[data-tab="results"]'); await page.click('#wkPrev'); await page.waitForTimeout(100);
  if (!(await page.locator('details.older[open]').count())) await page.click('details.older summary');
  log('rescored pills:', await page.locator('details.older .pill.good').count(), '| v2 week of rescored:', await page.evaluate(() => Object.values(window.__data).filter(d => d.replaces).map(d => d.week + ' ' + d.total).join(',')));

  // ---- export error stays visible after a snapshot
  await page.evaluate(() => { window.__failDrive = true });
  await page.click('#gsBtn'); await page.waitForTimeout(400);
  await page.evaluate(() => window.claude.use('db').then(db => db.doc('queue/zz').set({ week: '2026-01-05', agent: 'x', link: 'https://x.y' })));
  await page.waitForTimeout(200);
  log('export error after snapshot:', await txt('#gsStatus'));

  // ---- mobile: empty form bottom bar + results criteria rows
  await page.setViewportSize({ width: 400, height: 860 });
  await page.click('[data-tab="score"]'); await page.click('#resetBtn'); await page.click('#resetBtn'); await page.waitForTimeout(100);
  await page.screenshot({ path: path.join(SHOTS, '09-mobile-empty.png'), fullPage: false });
  await page.click('#mbSave'); await page.waitForTimeout(400);
  log('mobile save jumps to:', await page.evaluate(() => document.activeElement && (document.activeElement.id || document.activeElement.className)));
  await page.click('[data-tab="results"]'); await page.click('#wkNext'); await page.waitForTimeout(150);
  const crit = page.locator('.critbar').first(); await crit.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(SHOTS, '10-mobile-critbars.png'), fullPage: false });
  log('mobile scrollWidth results:', await page.evaluate(() => document.documentElement.scrollWidth));
  log('console errors:', JSON.stringify(errors));
  await browser.close();
})().catch(e => { console.error('TEST FAILED', e); process.exit(1) });
