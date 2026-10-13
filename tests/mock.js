// Shared test harness: a mocked window.claude (db, user, downloads, mcp → Lightdash, sample) serving real Sep 20–28 fixtures
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..');
const SKEL_HEAD = '<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><style>:root{color-scheme:light;box-sizing:border-box;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}html{scroll-padding-top:env(safe-area-inset-top,0px)}body{margin:0;padding:0;font:14px -apple-system,BlinkMacSystemFont,sans-serif;background:#faf9f5;color:#141413}img{max-width:100%}[hidden]:not([hidden=until-found i]){display:none!important}</style></head><body>\n';
const page_html = () => SKEL_HEAD + fs.readFileSync(path.join(DIR, 'dist/pizza-support-qa-desk.html'), 'utf8') + '\n</body></html>';
const ROWS = JSON.parse(fs.readFileSync(path.join(DIR, 'data/fixtures/q1_rows.json'), 'utf8')).concat(JSON.parse(fs.readFileSync(path.join(DIR, 'data/fixtures/q2_rows.json'), 'utf8')));
const LD = [...new Map(ROWS.map(r => [r.calls_conversation_id, r])).values()].sort((a, b) => a.calls_call_started_at_est.localeCompare(b.calls_call_started_at_est));
const TASKS = JSON.parse(fs.readFileSync(path.join(DIR, 'data/fixtures/tasks_week.json'), 'utf8'));
const TX = ['data/fixtures/transcripts_raw.json','data/fixtures/transcripts_w28.json'].flatMap(f => JSON.parse(fs.readFileSync(path.join(DIR, f), 'utf8')).result.rows.map(r => [r.calls_conversation_id, r.asr_transcript_call_transcript || '']));
const AI = JSON.parse(fs.readFileSync(path.join(DIR, 'data/fixtures/ai_facts.json'), 'utf8'));

const MOCK = ([seed, ld, opts, extra]) => {
  const data = {}; const listeners = []; const leases = {};
  seed.forEach(([p, d]) => data[p] = d);
  const clone = x => JSON.parse(JSON.stringify(x));
  const snap = p => ({ id: p.split('/').pop(), exists: !!data[p], data: () => data[p] ? clone(data[p]) : undefined, metadata: { fromCache: false, hasPendingWrites: false } });
  const collDocs = c => Object.keys(data).filter(p => p.startsWith(c + '/') && p.split('/').length === c.split('/').length + 1).sort().map(snap);
  const notify = () => listeners.forEach(l => setTimeout(l, 0));
  const docRef = p => ({ id: p.split('/').pop(), path: p,
    async get() { return snap(p) },
    async set(d) { if (JSON.stringify(d).length > 256 * 1024) throw { code: 'invalid_argument', message: 'too big' }; data[p] = clone(d); notify() },
    async update(d) { if (!data[p]) throw { code: 'invalid_argument', message: 'missing' }; Object.assign(data[p], clone(d)); notify() },
    async delete() { delete data[p]; notify() },
    async acquire({ holder, ttlMs }) { const now = Date.now(), l = leases[p]; if (l && l.until > now && l.holder !== holder) return { acquired: false, expiresAt: new Date(l.until).toISOString() };
      leases[p] = { holder, until: now + (ttlMs || 30000) }; window.__leases.push([p, holder]); return { acquired: true, version: 1, holder, expiresAt: new Date(leases[p].until).toISOString() } },
    onSnapshot(next) { const l = () => next(snap(p)); listeners.push(l); setTimeout(l, 0); return () => {} } });
  const db = { doc: docRef, collection(c) { return { path: c, doc: id => docRef(c + '/' + (id || Math.random().toString(36).slice(2))),
    onSnapshot(next) { const l = () => { const docs = collDocs(c); next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: {} }) }; listeners.push(l); setTimeout(l, 0); return () => {} } } } };
  window.__data = data; window.__saved = []; window.__ld = []; window.__leases = []; window.__opts = opts; window.__prompts = []; window.__slack = [];
  const TX = new Map(extra.tx);
  // Lightdash: apply "day inBetween=a,b AND field equals=v1,v2" to the fixture rows, cap at __opts.cap
  const parse = expr => { const out = {}; expr.split(' AND ').forEach(r => { const m = r.match(/^(\S+) (inBetween|equals)=(.*)$/); if (!m) throw { code: 'tool_error', message: 'bad filter ' + r };
    out[m[1]] = m[3].split(',').map(v => v.replace(/^"|"$/g, '')) }); return out };
  const queries = {};
  const cap = cfg => Math.min(cfg.limit || 1e9, window.__opts.cap || 1000);
  const run = cfg => { const f = parse(cfg.filters.dimensions);
    if (cfg.exploreName === 'wira_tasks') { const [a, b] = f.wira_tasks_task_created_at_est_day, field = Object.keys(f).find(k => k !== 'wira_tasks_task_created_at_est_day'), vals = new Set(f[field]);
      return extra.tasks.filter(r => { const d = r.wira_tasks_task_created_at_est.slice(0, 10); return d >= a && d <= b && vals.has(String(r[field])) }).slice(0, cap(cfg))
        .map(r => Object.fromEntries(cfg.dimensions.map(k => [k, r[k] ?? null]))) }
    if (cfg.dimensions.includes('asr_transcript_call_transcript')) return f.calls_conversation_id.filter(id => TX.has(id)).map(id => ({ calls_conversation_id: id, asr_transcript_call_transcript: TX.get(id) }));
    const [a, b] = f.calls_call_started_at_est_day; const field = Object.keys(f).find(k => k !== 'calls_call_started_at_est_day'), vals = new Set(f[field]);
    const rows = ld.filter(r => { const d = r.calls_call_started_at_est.slice(0, 10); return d >= a && d <= b && vals.has(String(r[field])) });
    return rows.slice(0, cap(cfg)) };
  const user = { id: async () => 'u_test', isOwner: async () => true, canEdit: async () => !window.__opts.viewer, can: async () => true };
  const downloads = { save: async ({ filename, data }) => { window.__saved.push({ filename, bytes: Array.from(data instanceof Uint8Array ? data : new Uint8Array(data)) }); return { status: 'saved' } } };
  const mcp = { listTools: async () => ({ servers: [], fileArgs: true }),
    callTool: async (server, tool, input) => {
      if (server === 'Slack') { window.__slack.push({ tool, input });
        if (window.__opts.slackFail) throw { code: window.__opts.slackFail, message: 'mock' };
        if (tool === 'slack_search_public') return { content: [], payload: { results: (extra.slack && extra.slack.search[(input.keywords || [])[0]]) || '# Search Results for: \n\nNo results' } };
        if (tool === 'slack_read_thread') return { content: [], payload: { messages: (extra.slack && extra.slack.threads[input.message_ts]) || '' } };
        throw { code: 'bad_request' } }
      if (server !== 'Lightdash') throw { code: 'bad_request' };
      if (window.__opts.fail) { window.__ld.push({ tool, fail: window.__opts.fail }); throw { code: window.__opts.fail, message: 'mock ' + window.__opts.fail, server: 'Lightdash' } }
      if (tool === 'run_metric_query') { const cfg = input.queryConfig;
        if (window.__opts.taskFail && cfg.exploreName === 'wira_tasks') { window.__ld.push({ tool, fail: 'tool_error', explore: 'wira_tasks' }); throw { code: 'tool_error', message: 'mock task failure' } }
        const rows = run(cfg); window.__ld.push({ tool, explore: cfg.exploreName, filter: cfg.filters.dimensions.slice(0, 120), n: rows.length, limit: cfg.limit, project: input.projectUuid, title: input.title });
        const uuid = 'q' + window.__ld.length;
        if (window.__opts.slow) { queries[uuid] = { rows, polls: 2 }; return { content: [], payload: { result: { status: 'running', queryUuid: uuid, nextPollAfterMs: 20, heartbeatAt: new Date().toISOString() } } } }
        return { content: [], payload: { result: { status: 'done', queryUuid: uuid, rows, fields: {}, exploreUrl: null } } } }
      if (tool === 'get_query_result') { const q = queries[input.queryUuid]; window.__ld.push({ tool, uuid: input.queryUuid });
        if (!q) return { content: [], payload: { result: { status: 'expired', queryUuid: input.queryUuid, error: 'unknown query' } } };
        if (q.polls-- > 0) return { content: [], payload: { result: { status: 'running', queryUuid: input.queryUuid, nextPollAfterMs: 20 } } };
        return { content: [], payload: { result: { status: 'done', queryUuid: input.queryUuid, rows: q.rows, fields: {}, exploreUrl: null } } } }
      throw { code: 'bad_request' } } };
  // sample: records the prompt, answers with a canned case read after a short wait (or fails / waits for Stop)
  const sample = Object.assign(async () => ({ text: '{}', truncated: false, modelTierApplied: 'default' }), {
    json: (input, o) => new Promise((resolve, reject) => { window.__prompts.push({ input, tier: o && o.modelTier });
      const sig = o && o.signal; if (sig) sig.addEventListener('abort', () => reject({ code: 'cancelled', message: 'stopped' }));
      setTimeout(() => { if (sig && sig.aborted) return; if (window.__opts.sampleFail) reject({ code: window.__opts.sampleFail, message: 'mock' }); else resolve(clone(/note-taker/.test(input) ? (window.__opts.factsReply || extra.factsReply || {calls:[{n:1,bullets:['Store calls about an order','Agent checks and fixes it']}],timeline:[{src:'Call 1',when:'11:37 AM',who:'Store',kind:'said',what:'Says orders are not reaching the store'},{src:'Call 1',when:'11:38 AM',who:'Agent',kind:'did',what:'Escalated to the product team'}],promises:[{src:'Call 1',who:'Agent',to:'Store',what:'Call back once fixed',by:''}]}) : (window.__opts.aiReply || extra.aiReply))) }, window.__opts.sampleMs || 150) }),
    limits: async () => ({ maxPromptBytes: 262144 }) });
  window.claude = { use: async n => (window.__opts.noSample && n === 'sample') ? null : ({ db, user, downloads, mcp, sample })[n] ?? null };
};

async function openPage(browser, seed, opts, viewport, more) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
  const page = await ctx.newPage(); await page.clock.setFixedTime(new Date('2026-10-02T12:00:00Z')); const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|ERR_FAILED/.test(m.text())) errors.push(m.text()) });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  const html = page_html();
  await page.route('**/*', async route => { const u = route.request().url();
    if (u.startsWith('http://qa.test/')) return route.fulfill({ contentType: 'text/html', body: html });
    if (u.includes('xlsx.full.min.js')) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(DIR, 'node_modules/xlsx/dist/xlsx.full.min.js')) });
    return route.abort() });
  await page.addInitScript(MOCK, [seed, LD, opts || {}, { tasks: TASKS, tx: TX, aiReply: AI['dd2c017b-ab6c-434c-b9df-1a6408ee0ee5'], slack: (more && more.slack) || null }]);
  return { page, ctx, errors };
}
module.exports = { MOCK, openPage, LD, TASKS, TX, AI, DIR };
