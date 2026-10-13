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
  // chats (extra.chat): any number of "field equals=a,b" clauses plus "<field>_day inBetween=a,b" on the field's date, projected to the asked fields
  const CH = extra.chat;
  const pick = (rows, f, keys) => rows.filter(r => Object.entries(f).every(([k, vals]) => {
    if (/_day$/.test(k)) { const d = String(r[k.replace(/_day$/, '')] || '').slice(0, 10); return d >= vals[0] && d <= vals[1] }
    return vals.includes(String(r[k])) })).map(r => Object.fromEntries(keys.map(k => [k, r[k] ?? null])));
  const run = cfg => { const f = parse(cfg.filters.dimensions);
    if (CH && cfg.exploreName === 'wira_project_tasks') return pick(CH.base.concat(CH.rel), f, cfg.dimensions).slice(0, cap(cfg));
    if (CH && cfg.exploreName === 'greendot_orders_analytics_aggregate') return pick(CH.orders, f, cfg.dimensions.concat(cfg.metrics || [])).slice(0, cap(cfg));
    if (CH && cfg.dimensions.includes('asr_transcript_call_transcript') && cfg.dimensions.includes('calls_call_phone_detail')) return pick(CH.calls, f, cfg.dimensions).slice(0, cap(cfg));
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
  // chat passes first: the chat facts prompt also says "note-taker". The real case (CH.realSid) gets its saved replies, invented chats a small valid one
  const chatReply = input => { if (!CH) return null;
    const sid = (input.match(/CHAT (\S+) ·/) || [])[1] || '', real = sid === String(CH.realSid), S = CH.synth;
    if (/find the order a support chat is about/.test(input)) return CH.refs || {};
    if (/auditing one WIRA support chat/.test(input)) return real ? CH.facts : S.facts;
    if (/You are the analyst for a QA lead/.test(input)) return real ? CH.analysis : S.analysis;
    if (/You are Swift Coach/.test(input)) return real ? CH.grade : S.grade[Number(sid.slice(-1)) % S.grade.length];
    return null };
  // sample: records the prompt, answers with a canned case read after a short wait (or fails / waits for Stop)
  const sample = Object.assign(async () => ({ text: '{}', truncated: false, modelTierApplied: 'default' }), {
    json: (input, o) => new Promise((resolve, reject) => { window.__prompts.push({ input, tier: o && o.modelTier });
      const sig = o && o.signal; if (sig) sig.addEventListener('abort', () => reject({ code: 'cancelled', message: 'stopped' }));
      setTimeout(() => { if (sig && sig.aborted) return; if (window.__opts.sampleFail) { reject({ code: window.__opts.sampleFail, message: 'mock' }); return }
        const ch = chatReply(input); if (ch) { resolve(clone(ch)); return }
        resolve(clone(/note-taker/.test(input) ? (window.__opts.factsReply || extra.factsReply || {calls:[{n:1,bullets:['Store calls about an order','Agent checks and fixes it']}],timeline:[{src:'Call 1',when:'11:37 AM',who:'Store',kind:'said',what:'Says orders are not reaching the store'},{src:'Call 1',when:'11:38 AM',who:'Agent',kind:'did',what:'Escalated to the product team'}],promises:[{src:'Call 1',who:'Agent',to:'Store',what:'Call back once fixed',by:''}]}) : (window.__opts.aiReply || extra.aiReply))) }, window.__opts.sampleMs || 150) }),
    limits: async () => ({ maxPromptBytes: 262144 }) });
  window.claude = { use: async n => (window.__opts.noSample && n === 'sample') ? null : ({ db, user, downloads, mcp, sample })[n] ?? null };
};

async function openPage(browser, seed, opts, viewport, more) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1280, height: 900 } });
  const page = await ctx.newPage(); await page.clock.setFixedTime(new Date((more && more.now) || '2026-10-02T12:00:00Z')); const errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/fonts\.googleapis|ERR_FAILED/.test(m.text())) errors.push(m.text()) });
  page.on('pageerror', e => errors.push('PAGEERROR ' + e.message));
  const html = page_html();
  await page.route('**/*', async route => { const u = route.request().url();
    if (u.startsWith('http://qa.test/')) return route.fulfill({ contentType: 'text/html', body: html });
    if (u.includes('xlsx.full.min.js')) return route.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(DIR, 'node_modules/xlsx/dist/xlsx.full.min.js')) });
    return route.abort() });
  await page.addInitScript(MOCK, [seed, LD, opts || {}, { tasks: TASKS, tx: TX, aiReply: AI['dd2c017b-ab6c-434c-b9df-1a6408ee0ee5'], slack: (more && more.slack) || null, chat: (more && more.chat) || null }]);
  return { page, ctx, errors };
}

/* The chat world for the chat UI tests: the real case in data/chats/cases/<sid>.json (git-ignored) plus invented chats.
   Invented chats use fake people and restaurants; the real case's SA, restaurant and text are read at run time and never written into this file. */
const CHAT_DIR = path.join(DIR, 'data/chats');
function chatWorld(sid) {
  const file = path.join(CHAT_DIR, `cases/${sid}.json`);
  if (!fs.existsSync(file)) return null;
  const fx = JSON.parse(fs.readFileSync(file, 'utf8')), out = p => JSON.parse(fs.readFileSync(path.join(CHAT_DIR, `cases/${sid}.r2.${p}.out.json`), 'utf8'));
  const real = fx.chatRow, code = real.restaurants_unique_code, day = real.wira_project_tasks_created_at_est.slice(0, 10);
  const realSA = { name: real.wira_project_tasks_assigned_user, email: real.wira_project_tasks_agent_alias };
  const SA = [realSA, { name: 'Mara Quill', email: 'mara.quill@wondersco.com' }, { name: 'Theo Brandt', email: 'theo.brandt@wondersco.com' }];
  const addD = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  let n = 0;
  const mk = (sa, rest, rcode, dayOff, hm, msgs, o) => { n++; const id = String(9900100 + n), at = `${addD(day, dayOff)}T${hm}:00.000Z`, saIdx = msgs.findIndex(m => m[0] === 'sa');
    const who = w => w === 'client' ? 'client-+15550100' + String(n).padStart(2, '0') : w === 'sa' ? sa.email : w;
    return Object.assign({ wira_project_tasks_wira_id: `Wid(0,1,1,0,${id})`, wira_project_tasks_short_wira_id: id, wira_project_tasks_created_at_est: at, wira_project_tasks_closed_at_est: null,
      wira_project_tasks_status: 'closed', wira_project_tasks_sub_status: null, wira_project_tasks_task_title: msgs[0][1].slice(0, 80),
      wira_project_tasks_task_comments: msgs.map(m => m[1]).join(' ## '), wira_project_tasks_task_commentors: msgs.map(m => who(m[0])).join(' ## '),
      wira_project_tasks_conversation_direction: 'inbound', wira_project_tasks_created_by: null, wira_project_tasks_created_by_title: null,
      wira_project_tasks_assigned_user: sa.name, wira_project_tasks_agent_alias: sa.email, wira_project_tasks_client_alias: who('client'),
      wira_project_tasks_first_response_time_minutes: saIdx < 0 ? null : 1.5 + n, wira_project_tasks_first_client_message_time_est: at, wira_project_tasks_first_agent_reply_time_est: saIdx < 0 ? null : at,
      wira_project_tasks_shape_name: 'general-conversation', wira_project_tasks_rating: null, wira_project_tasks_wira_ticket_url: `https://wira.example.test/tasks/${id}`,
      restaurants_unique_code: rcode, restaurants_english_name: rest }, o || {}) };
  const ask = [['client', 'Hi, a delivery order from earlier never printed in the kitchen. This is Rhea.'], ['sa', 'Hi Rhea, sorry about that. Checking the order and the printer log now.'], ['sa', 'The order reached the tablet at 6:02 PM; the printer was offline. Reconnect it from Settings and it will print again.'], ['client', 'Thanks, it works now.']];
  const synth = [
    mk(SA[0], 'Lantern Slice', 'R90001', 1, '12:10', ask),
    mk(SA[1], 'Oak Street Pies', 'R90002', 0, '10:05', [['client', 'Hello, can you change our closing time to 10 PM tonight? This is Omar.'], ['sa', 'Hi Omar, done. The online menu now closes at 10 PM tonight.']]),
    mk(SA[1], 'Harbor Crust', 'R90003', 0, '13:40', ask),
    mk(SA[1], 'Harbor Crust', 'R90003', 1, '09:15', [['client', 'A customer says we charged them twice. This is Lena.'], ['sa', 'Hi Lena, checking both charges now.'], ['sa', 'Only one charge settled; the other is a hold that drops off in 3 days.']]),
    mk(SA[1], 'Maple Oven', 'R90004', 2, '18:30', ask),
    mk(SA[1], 'Maple Oven', 'R90004', 3, '11:00', [['client', 'Need a refund on order 12, wrong pizza. This is Dev.'], ['sa', 'Hi Dev, checking the call recording for order 12.']]),
    mk(SA[1], 'Oak Street Pies', 'R90002', 4, '16:20', [['client', 'Our menu prices are wrong online. This is Omar.'], ['sa', 'Hi Omar, sending the corrected prices to the menu team now.']]),
    mk(SA[1], 'Lantern Slice', 'R90001', 5, '20:45', [['client', 'Is anyone there? The phones stopped ringing.'], ['client', 'Hello?']]),
    mk(SA[2], 'Copper Kettle Pizza', 'R90005', 2, '14:00', [['dana.lowe@wondersco.com', 'Hi team, opening this for the owner: they want weekend hours added. This is Dana from accounts.'], ['client', 'Yes please, Saturday 11 to 11. This is Ivo.'], ['sa', 'Hi Ivo, Saturday hours are set to 11 AM to 11 PM.']],
      { wira_project_tasks_conversation_direction: 'outbound', wira_project_tasks_created_by: 'Dana Lowe', wira_project_tasks_created_by_title: 'Account Executive' }),
    mk(SA[2], 'Copper Kettle Pizza', 'R90005', 3, '09:30', ask)];
  const tagBase = r => Object.assign({ restaurants_cuisine_type: 'pizza', wira_project_tasks_project_name: 'conversation' }, r), tagCode = r => Object.assign({ restaurants_unique_code: code }, r);
  const synthFacts = { calls: [], timeline: [{ src: 'M1', when: '', who: 'Client', kind: 'said', what: 'Reports a problem with an order' }, { src: 'M2', when: '', who: 'SA', kind: 'said', what: 'Says the order is being checked' }], claims: [{ src: 'M2', claim: 'The order is being checked', check: 'cant_check', evidence: 'No order data linked' }], promises: [] };
  const synthAnalysis = { summary: 'A routine client request handled in chat.', fault: { who: 'restaurant', why: 'The issue sat with the restaurant setup.', cites: ['F1'] }, bucket: { id: 'none', why: 'Not a Tarro error.', cites: ['F1'] },
    affectedOrder: '', selfDelivery: false, deliveryFee: null, ideal: { client: 'Fix it in chat and confirm.', customer: '', escalation: { needed: false, why: 'Routine', to: '' } },
    saOffer: { amount: null, text: 'Nothing offered', cites: [] }, saPath: { match: 'yes', why: 'Fixed in chat.' }, aeInvolvement: { kind: 'none', saCouldPrevent: false, why: '' }, firstResponse: { concludedBeforeEvidence: false, why: 'Checked first.', cites: ['F2'] } };
  const g = s => ({ scores: s, reasons: Object.fromEntries(Object.keys(s).map(k => [k, 'Cites F1 and F2.'])), route: { facts: { mark: 'right', why: 'Checked.' }, analysis: { mark: 'right', why: 'Right fault.' }, solution: { mark: 'partly', why: 'Close.' }, escalation: { mark: 'right', why: 'Not needed.' } },
    wentWell: ['Replied fast', 'Checked before answering'], nextTime: [{ what: 'Closed without confirming', why: 'The client may still be stuck', do: 'Ask if it works', model: 'Can you confirm it prints now?' }], verdictWhy: 'Solid.' });
  return { fx, realSid: String(sid), realSA, SA, code, synthIds: synth.map(r => r.wira_project_tasks_short_wira_id),
    chat: { realSid: String(sid), base: [tagBase(real)].concat(synth.map(tagBase)), rel: fx.relRows.map(tagCode), orders: fx.orderRows.map(tagCode), calls: fx.callRows.map(tagCode),
      refs: {}, facts: out('facts'), analysis: out('analysis'), grade: out('grade'),
      synth: { facts: synthFacts, analysis: synthAnalysis, grade: [g({ fr: 3, ev: 3, rs: 3, fa: 3, path: 3, amt: 3, expl: 'na', esc: 'na', tone: 3 }), g({ fr: 2, ev: 2, rs: 3, fa: 2, path: 2, amt: 2, expl: 2, esc: 'na', tone: 3 }), g({ fr: 1, ev: 1, rs: 2, fa: 1, path: 1, amt: 1, expl: 'na', esc: 0, tone: 2 })] } },
    policy: JSON.parse(fs.readFileSync(path.join(CHAT_DIR, 'policy_pack.json'), 'utf8')), calibration: JSON.parse(fs.readFileSync(path.join(CHAT_DIR, 'calibration.json'), 'utf8')) };
}
module.exports = { MOCK, openPage, LD, TASKS, TX, AI, DIR, chatWorld };
