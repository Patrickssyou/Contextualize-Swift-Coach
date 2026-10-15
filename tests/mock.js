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
  // several people on one QA Desk: window.__switch(uid) keeps the store and reloads as that person (sessionStorage), window.__as(uid, fn) writes as them in place
  let saved = null; try { saved = JSON.parse(sessionStorage.getItem('__mock_data') || 'null') } catch (e) {}
  if (saved) Object.assign(data, saved); else seed.forEach(([p, d]) => data[p] = d);
  const ME = (() => { try { return sessionStorage.getItem('__mock_me') } catch (e) { return null } })() || opts.me || 'u_test', OWNER = opts.owner || 'u_test';
  let actor = ME;
  window.__me = ME; window.__switch = uid => { sessionStorage.setItem('__mock_data', JSON.stringify(data)); sessionStorage.setItem('__mock_me', uid); location.reload() };
  window.__as = async (uid, fn) => { const was = actor; actor = uid; try { return await fn(db) } finally { actor = was } };
  // the access rules the page declares: data/users/<id>/ only for that person; calibMarks/<uid>/… written by <uid> only ({self}), or the owner
  const deny = (p, w) => { const s = p.split('/');
    if (s[0] === 'data' && s[1] === 'users' && s[2] && s[2] !== actor) return true;
    if (w && s[0] === 'calibMarks' && s[1] && s[1] !== actor && actor !== OWNER) return true;
    if (w && window.__opts.viewer === 'strict') return true;
    return false };
  const guard = (p, w) => { if (deny(p, w)) { window.__denied = (window.__denied || []).concat([[w ? 'write' : 'read', p, actor]]); throw { code: 'permission_denied', message: 'not allowed' } } };
  const clone = x => JSON.parse(JSON.stringify(x));
  const snap = p => ({ id: p.split('/').pop(), exists: !!data[p], data: () => data[p] ? clone(data[p]) : undefined, metadata: { fromCache: false, hasPendingWrites: false } });
  const collDocs = c => Object.keys(data).filter(p => p.startsWith(c + '/') && p.split('/').length === c.split('/').length + 1).sort().map(snap);
  // like the store, a write wakes only the listeners on that document or on its own collection
  const notify = p => { const c = p.split('/').slice(0, -1).join('/'); listeners.forEach(l => { if (l.path === (l.kind === 'doc' ? p : c)) setTimeout(l, 0) }) };
  // subscriptions: every onSnapshot is logged in __subs ({path, kind, on}); its unsubscribe really stops it
  const subs = [];
  const listen = (path, kind, l) => { const s = { path, kind, on: true }; subs.push(s); const fire = () => { if (s.on) l() }; fire.path = path; fire.kind = kind; listeners.push(fire); setTimeout(fire, 0);
    return () => { if (!s.on) return; s.on = false; const i = listeners.indexOf(fire); if (i >= 0) listeners.splice(i, 1) } };
  const qsnap = c => { const docs = collDocs(c); return { docs, size: docs.length, empty: !docs.length, docChanges: () => [], metadata: { fromCache: false, hasPendingWrites: false } } };
  const docRef = p => ({ id: p.split('/').pop(), path: p,
    async get() { guard(p, false); return snap(p) },
    async set(d) { guard(p, true); if (JSON.stringify(d).length > 256 * 1024) throw { code: 'invalid_argument', message: 'too big' }; data[p] = clone(d); notify(p) },
    async update(d) { guard(p, true); if (!data[p]) throw { code: 'invalid_argument', message: 'missing' }; Object.assign(data[p], clone(d)); notify(p) },
    async delete() { guard(p, true); delete data[p]; notify(p) },
    async acquire({ holder, ttlMs }) { const now = Date.now(), l = leases[p]; if (l && l.until > now && l.holder !== holder) return { acquired: false, expiresAt: new Date(l.until).toISOString() };
      leases[p] = { holder, until: now + (ttlMs || 30000) }; window.__leases.push([p, holder]); return { acquired: true, version: 1, holder, expiresAt: new Date(leases[p].until).toISOString() } },
    onSnapshot(next, err) { if (deny(p, false)) { setTimeout(() => err && err({ code: 'permission_denied' }), 0); return () => {} } return listen(p, 'doc', () => next(snap(p))) } });
  const db = { doc: docRef, collection(c) { return { path: c, doc: id => docRef(c + '/' + (id || Math.random().toString(36).slice(2))),
    async get() { window.__gets.push(c); guard(c + '/x', false); return qsnap(c) },
    onSnapshot(next, err) { if (deny(c + '/x', false)) { setTimeout(() => err && err({ code: 'permission_denied' }), 0); return () => {} } return listen(c, 'coll', () => next(qsnap(c))) } } } };
  window.__data = data; window.__saved = []; window.__ld = []; window.__leases = []; window.__opts = opts; window.__prompts = []; window.__slack = []; window.__subs = subs; window.__gets = [];
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
    // status changes: "wira_tasks_state_task_id equals=<ids>" (a Wid has commas, so ldVal quotes it)
    if (CH && cfg.exploreName === 'wira_tasks_state') { const m = cfg.filters.dimensions.match(/wira_tasks_state_task_id equals=(.*)$/), ids = new Set(m ? [...m[1].matchAll(/"((?:[^"\\]|\\.)*)"|([^,]+)/g)].map(x => x[1] != null ? x[1].replace(/\\(.)/g, '$1') : x[2]) : []);
      return (CH.states || []).filter(r => ids.has(String(r.wira_tasks_state_task_id))).map(r => Object.fromEntries(cfg.dimensions.map(k => [k, r[k] ?? null]))).slice(0, cap(cfg)) }
    if (CH && cfg.exploreName === 'greendot_orders_analytics_aggregate') return pick(CH.orders, f, cfg.dimensions.concat(cfg.metrics || [])).slice(0, cap(cfg));
    if (CH && cfg.dimensions.includes('asr_transcript_call_transcript') && cfg.dimensions.includes('calls_call_phone_detail')) return pick(CH.calls, f, cfg.dimensions).slice(0, cap(cfg));
    if (cfg.exploreName === 'wira_tasks') { const [a, b] = f.wira_tasks_task_created_at_est_day, field = Object.keys(f).find(k => k !== 'wira_tasks_task_created_at_est_day'), vals = new Set(f[field]);
      return extra.tasks.filter(r => { const d = r.wira_tasks_task_created_at_est.slice(0, 10); return d >= a && d <= b && vals.has(String(r[field])) }).slice(0, cap(cfg))
        .map(r => Object.fromEntries(cfg.dimensions.map(k => [k, r[k] ?? null]))) }
    if (cfg.dimensions.includes('asr_transcript_call_transcript')) return f.calls_conversation_id.filter(id => TX.has(id)).map(id => ({ calls_conversation_id: id, asr_transcript_call_transcript: TX.get(id) }));
    const [a, b] = f.calls_call_started_at_est_day; const field = Object.keys(f).find(k => k !== 'calls_call_started_at_est_day'), vals = new Set(f[field]);
    const rows = ld.filter(r => { const d = r.calls_call_started_at_est.slice(0, 10); return d >= a && d <= b && vals.has(String(r[field])) });
    return rows.slice(0, cap(cfg)) };
  const PEOPLE = opts.people || {};
  const user = { id: async () => ME, isOwner: async () => ME === OWNER, canEdit: async () => !window.__opts.viewer, can: async () => true,
    profiles: async ids => { window.__profiles = (window.__profiles || 0) + 1; return Object.fromEntries([].concat(ids).map(id => [id, { id, name: PEOPLE[id] || '' }])) } };
  // room presence: what this page sets (window.__presence), and window.__peers([{by, presence}]) to say who else is here
  let peerFns = [];
  const room = opts.room ? { presence: async patch => { (window.__presence = window.__presence || []).push(JSON.parse(JSON.stringify(patch))) },
    onPeers: fn => { peerFns.push(fn); return () => { peerFns = peerFns.filter(f => f !== fn) } }, peers: () => [], emit: async () => {}, on: () => () => {} } : null;
  window.__peers = list => { const peers = list.map(p => Object.assign({ peer: 'p_' + p.by, isMe: p.by === ME, sameTab: false, kind: 'viewer', guest: false, updatedAt: Date.now() }, p)); peerFns.forEach(f => f({ peers, joined: [], left: [], updated: [] })) };
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
  // chat passes first: the chat facts prompt also says "note-taker". The real case (CH.realSid) gets its saved replies, invented chats a small valid one.
  // One grade read per grading (CHAT.gradeRuns 1). The real case answers with CH.grade; a second read (deps.gradeRuns 2, older audits) gets CH.grade2
  const gradeReads = {};
  const chatReply = input => { if (!CH) return null;
    const sid = (input.match(/CHAT (\S+) ·/) || [])[1] || '', real = sid === String(CH.realSid), S = CH.synth;
    if (/find the order a support chat is about/.test(input)) return CH.refs || {};
    if (/auditing one WIRA support chat/.test(input)) return real ? CH.facts : S.facts;
    if (/You are the analyst for a QA lead/.test(input)) return real ? CH.analysis : S.analysis;
    if (/You are Swift Coach/.test(input)) { if (!real) return S.grade[Number(sid.slice(-1)) % S.grade.length];
      const i = gradeReads[sid] = (gradeReads[sid] || 0) + 1; return i % 2 === 1 ? CH.grade : (CH.grade2 || CH.grade) }
    return null };
  // sample: records the prompt, answers with a canned case read after a short wait (or fails / waits for Stop)
  const sample = Object.assign(async () => ({ text: '{}', truncated: false, modelTierApplied: 'default' }), {
    json: (input, o) => new Promise((resolve, reject) => { window.__prompts.push({ input, tier: o && o.modelTier, cache: o && o.cache });
      const sig = o && o.signal; if (sig) sig.addEventListener('abort', () => reject({ code: 'cancelled', message: 'stopped' }));
      setTimeout(() => { if (sig && sig.aborted) return; if (window.__opts.sampleFail) { reject({ code: window.__opts.sampleFail, message: 'mock' }); return }
        const ch = chatReply(input); if (ch) { resolve(clone(ch)); return }
        resolve(clone(/note-taker/.test(input) ? (window.__opts.factsReply || extra.factsReply || {calls:[{n:1,bullets:['Store calls about an order','Agent checks and fixes it']}],timeline:[{src:'Call 1',when:'11:37 AM',who:'Store',kind:'said',what:'Says orders are not reaching the store'},{src:'Call 1',when:'11:38 AM',who:'Agent',kind:'did',what:'Escalated to the product team'}],promises:[{src:'Call 1',who:'Agent',to:'Store',what:'Call back once fixed',by:''}]}) : (window.__opts.aiReply || extra.aiReply))) }, window.__opts.sampleMs || 150) }),
    limits: async () => ({ maxPromptBytes: 262144 }) });
  window.claude = { use: async n => (window.__opts.noSample && n === 'sample') ? null : ({ db, user, downloads, mcp, sample, room })[n] ?? null };
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
  const fx = JSON.parse(fs.readFileSync(file, 'utf8')), outOf = (t, p) => JSON.parse(fs.readFileSync(path.join(CHAT_DIR, `cases/${sid}.${t}.${p}.out.json`), 'utf8'));
  // the brain's blind run with the QA-ticket prompts (t1: facts, analysis, two grade reads with findings); without it, the older r2 run plus an invented new-format grade
  const T1 = ['facts', 'analysis', 'grade', 'grade2'].every(p => fs.existsSync(path.join(CHAT_DIR, `cases/${sid}.t1.${p}.out.json`)));
  const out = p => outOf(T1 ? 't1' : 'r2', p);
  const grades = T1 ? [outOf('t1', 'grade'), outOf('t1', 'grade2')] : inventGrades(fx, outOf('r2', 'grade'));
  const real = fx.chatRow, code = real.restaurants_unique_code, day = real.wira_project_tasks_created_at_est.slice(0, 10);
  const realSA = { name: real.wira_project_tasks_assigned_user, email: real.wira_project_tasks_agent_alias };
  const SA = [realSA, { name: 'Mara Quill', email: 'mara.quill@wondersco.com' }, { name: 'Theo Brandt', email: 'theo.brandt@wondersco.com' }];
  const addD = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  let n = 0;
  // invented status changes per chat: open/pending_reply at the start, waiting on the client from the first reply, closed 10 min later
  const states = [], plus = (t, m) => new Date(Date.parse(t) + m * 6e4).toISOString();
  const st = (wid, at, status, sub) => states.push({ wira_tasks_state_task_id: wid, wira_tasks_state_task_status: status, wira_tasks_state_task_sub_status: sub, wira_tasks_state_created_at_est: at });
  // t: {reply: minutes from the first client message to the first reply, wira: WIRA's own first-response figure}
  const mk = (sa, rest, rcode, dayOff, hm, msgs, o, t) => { n++; const id = String(9900100 + n), at = `${addD(day, dayOff)}T${hm}:00.000Z`, saIdx = msgs.findIndex(m => m[0] === 'sa');
    const reply = t && t.reply != null ? t.reply : 1.5 + n, wira = t && t.wira != null ? t.wira : reply, wid = `Wid(0,1,1,0,${id})`;
    if (saIdx >= 0) { st(wid, at, 'open', 'pending_reply'); st(wid, plus(at, reply), 'blocked', 'waiting_on_client'); st(wid, plus(at, reply + 10), 'closed', null) }
    const who = w => w === 'client' ? 'client-+15550100' + String(n).padStart(2, '0') : w === 'sa' ? sa.email : w;
    return Object.assign({ wira_project_tasks_wira_id: `Wid(0,1,1,0,${id})`, wira_project_tasks_short_wira_id: id, wira_project_tasks_created_at_est: at, wira_project_tasks_closed_at_est: null,
      wira_project_tasks_status: 'closed', wira_project_tasks_sub_status: null, wira_project_tasks_task_title: msgs[0][1].slice(0, 80),
      wira_project_tasks_task_comments: msgs.map(m => m[1]).join(' ## '), wira_project_tasks_task_commentors: msgs.map(m => who(m[0])).join(' ## '),
      wira_project_tasks_conversation_direction: 'inbound', wira_project_tasks_created_by: null, wira_project_tasks_created_by_title: null,
      wira_project_tasks_assigned_user: sa.name, wira_project_tasks_agent_alias: sa.email, wira_project_tasks_client_alias: who('client'),
      wira_project_tasks_first_response_time_minutes: saIdx < 0 ? null : wira, wira_project_tasks_first_client_message_time_est: at, wira_project_tasks_first_agent_reply_time_est: saIdx < 0 ? null : plus(at, reply),
      wira_project_tasks_shape_name: 'general-conversation', wira_project_tasks_rating: null, wira_project_tasks_wira_ticket_url: `https://wira.example.test/tasks/${id}`,
      restaurants_unique_code: rcode, restaurants_english_name: rest }, o || {}) };
  const ask = [['client', 'Hi, a delivery order from earlier never printed in the kitchen. This is Rhea.'], ['sa', 'Hi Rhea, sorry about that. Checking the order and the printer log now.'], ['sa', 'The order reached the tablet at 6:02 PM; the printer was offline. Reconnect it from Settings and it will print again.'], ['client', 'Thanks, it works now.']];
  const synth = [
    mk(SA[0], 'Lantern Slice', 'R90001', 1, '12:10', ask),
    mk(SA[1], 'Oak Street Pies', 'R90002', 0, '10:05', [['client', 'Hello, can you change our closing time to 10 PM tonight? This is Omar.'], ['sa', 'Hi Omar, done. The online menu now closes at 10 PM tonight.']]),
    mk(SA[1], 'Harbor Crust', 'R90003', 0, '13:40', ask),
    mk(SA[1], 'Harbor Crust', 'R90003', 1, '09:15', [['client', 'A customer says we charged them twice. This is Lena.'], ['sa', 'Hi Lena, checking both charges now.'], ['sa', 'Only one charge settled; the other is a hold that drops off in 3 days.']], null, { reply: 9, wira: 2.1 }),
    mk(SA[1], 'Maple Oven', 'R90004', 2, '18:30', ask),
    mk(SA[1], 'Maple Oven', 'R90004', 3, '11:00', [['client', 'Need a refund on order 12, wrong pizza. This is Dev.'], ['sa', 'Hi Dev, checking the call recording for order 12.']], null, { reply: 24 }),
    mk(SA[1], 'Oak Street Pies', 'R90002', 4, '16:20', [['client', 'Our menu prices are wrong online. This is Omar.'], ['sa', 'Hi Omar, sending the corrected prices to the menu team now.']]),
    mk(SA[1], 'Lantern Slice', 'R90001', 5, '20:45', [['client', 'Is anyone there? The phones stopped ringing.'], ['client', 'Hello?']]),
    mk(SA[2], 'Copper Kettle Pizza', 'R90005', 2, '14:00', [['dana.lowe@wondersco.com', 'Hi team, opening this for the owner: they want weekend hours added. This is Dana from accounts.'], ['client', 'Yes please, Saturday 11 to 11. This is Ivo.'], ['sa', 'Hi Ivo, Saturday hours are set to 11 AM to 11 PM.']],
      { wira_project_tasks_conversation_direction: 'outbound', wira_project_tasks_created_by: 'Dana Lowe', wira_project_tasks_created_by_title: 'Account Executive' }),
    mk(SA[2], 'Copper Kettle Pizza', 'R90005', 3, '09:30', ask)];
  const tagBase = r => Object.assign({ restaurants_cuisine_type: 'pizza', wira_project_tasks_project_name: 'conversation' }, r), tagCode = r => Object.assign({ restaurants_unique_code: code }, r);
  const synthFacts = { brief: ['The client reports an order problem in chat.', 'The SA says the order is being checked.', 'No order data is linked to check against.'], calls: [], timeline: [{ src: 'M1', when: '', who: 'Client', kind: 'said', what: 'Reports a problem with an order' }, { src: 'M2', when: '', who: 'SA', kind: 'said', what: 'Says the order is being checked' }], claims: [{ src: 'M2', claim: 'The order is being checked', check: 'cant_check', evidence: 'No order data linked' }], promises: [] };
  const synthAnalysis = { summary: 'A routine client request handled in chat.', fault: { who: 'restaurant', why: 'The issue sat with the restaurant setup.', cites: ['F1'] }, bucket: { id: 'none', why: 'Not a Tarro error.', cites: ['F1'] },
    affectedOrder: '', selfDelivery: false, deliveryFee: null, ideal: { client: 'Fix it in chat and confirm.', customer: '', escalation: { needed: false, why: 'Routine', to: '' } },
    saOffer: { amount: null, text: 'Nothing offered', cites: [] }, saPath: { match: 'yes', why: 'Fixed in chat.' }, aeInvolvement: { kind: 'none', saCouldPrevent: false, why: '' }, firstResponse: { concludedBeforeEvidence: false, why: 'Checked first.', cites: ['F2'] } };
  const g = s => ({ scores: s, reasons: Object.fromEntries(Object.keys(s).map(k => [k, 'Cites F1 and F2.'])), route: { facts: { mark: 'right', why: 'Checked.' }, analysis: { mark: 'right', why: 'Right fault.' }, solution: { mark: 'partly', why: 'Close.' }, escalation: { mark: 'right', why: 'Not needed.' } },
    wentWell: ['Replied fast', 'Checked before answering'], nextTime: [{ what: 'Closed without confirming', why: 'The client may still be stuck', do: 'Ask if it works', model: 'Can you confirm it prints now?' }], verdictWhy: 'Solid.' });
  /* a second, already-graded week (all invented): a menu-setup chat with a workflow bot line, an unknown role, WIRA request fields,
     an audit with caseType menu_setup and fault none, the reviewer's review and a calibration case; plus a chat with no SA reply */
  const sideWeek = pw => { const at = (d, hm) => `${addD(pw, d)}T${hm}:00.000Z`, P = k => `chatWeeks/${pw}/${k}`;
    const m = (n, role, name, text, author) => ({ n, author: author || '', role, name, text, internal: false, inferred: false });
    const base = (id, rest, rcode, when, msgs, o) => Object.assign({ v: 'chat-1', week: pw, picked: true, gradable: true, wid: `Wid(0,1,1,0,${id})`, sid: id, url: `https://wira.example.test/tasks/${id}`,
      at: when, closedAt: '', status: 'closed', sub: '', title: msgs[0].text.slice(0, 80), direction: 'inbound', createdBy: '', createdByTitle: '', sa: 'Mara Quill', saEmail: 'mara.quill@wondersco.com',
      clientId: 'client-+15550199', frt: 2.5, firstClientAt: when, firstReplyAt: when, intent: 'menu-change', rating: '', code: rcode, restaurant: rest, initiator: 'client', msgs, clientName: msgs[0].name }, o || {});
    const menu = base('9900901', 'Birch Lane Pizza', 'R90011', at(1, '11:20'), [
      m(1, 'client', 'Nia', 'Hi, two prices on our online menu are wrong: Large Margherita should be $16.99 and garlic knots $5.49. This is Nia.', 'client-+15550199'),
      m(2, 'bot', 'Workflow', 'Menu change request created and sent to the menu team.', 'wira-bot'),
      m(3, 'sa', 'Mara Quill', 'Hi Nia, thanks. Both prices are with the menu team; I will confirm here once they are live.', 'mara.quill@wondersco.com'),
      m(4, 'trainer', 'Quinn Reyes', 'Shadowing this chat for onboarding.', 'quinn.reyes@wondersco.com'),
      m(5, 'sa', 'Mara Quill', 'Both prices are live now: Large Margherita $16.99, garlic knots $5.49.', 'mara.quill@wondersco.com'),
      m(6, 'client', 'Nia', 'Perfect, thank you.', 'client-+15550199')],
      { fields: JSON.stringify({ item: 'Large Margherita', new_price: '16.99', second_item: 'Garlic knots', second_price: '5.49' }) });
    const silent = base('9900902', 'Fern Street Slice', 'R90012', at(3, '21:05'), [m(1, 'client', 'Client', 'Are the phones down tonight?', 'client-+15550198'), m(2, 'client', 'Client', 'Hello?', 'client-+15550198')],
      { picked: false, gradable: false, frt: null, firstReplyAt: '', sa: 'Theo Brandt', saEmail: 'theo.brandt@wondersco.com' });
    const scores = { fr: 3, ev: 3, rs: 3, fa: 'na', path: 3, amt: 'na', expl: 'na', esc: 'na', tone: 3 };
    const audit = { v: 'chat-1', sid: '9900901', wid: menu.wid, url: menu.url, week: pw, at: menu.at, sa: menu.sa, restaurant: menu.restaurant, code: menu.code, initiator: 'client', title: menu.title, frt: 2.5, clientName: 'Nia',
      tasks: [], orders: [], candidates: [], dayOrders: [], orderNote: '', orderPick: 'auto', refs: { amounts: [16.99, 5.49], tickets: [], phones: [], names: [], items: ['Large Margherita', 'garlic knots'], orderType: '' },
      calls: [], slack: [], notFound: [],
      facts: { calls: {}, timeline: [{ id: 'F1', src: 'M1', when: '', who: 'Nia (client)', kind: 'said', what: 'Asks to correct two prices on the online menu' },
        { id: 'F2', src: 'M3', when: '', who: 'Mara Quill', kind: 'did', what: 'Sent both prices to the menu team' }, { id: 'F3', src: 'M5', when: '', who: 'Mara Quill', kind: 'said', what: 'Confirms both prices are live' }],
        claims: [{ id: 'C1', src: 'M5', claim: 'Both prices are live', check: 'cant_check', evidence: 'Menu data is not in this record' }], promises: [{ id: 'P1', src: 'M3', who: 'Mara Quill', to: 'Nia', what: 'Confirm once the prices are live' }] },
      analysis: { caseType: 'menu_setup', request: 'Correct two menu prices shown online', summary: 'The client asked for two price fixes; the SA sent them to the menu team and confirmed once live.',
        fault: { who: 'none', why: 'Nothing went wrong; a plain menu request.', cites: ['F1'] }, bucket: { id: '', why: '', cites: [] }, affectedOrder: '', selfDelivery: false, deliveryFee: null,
        ideal: { client: 'Send both prices to the menu team and confirm in the chat once live.', customer: '', escalation: { needed: false, why: 'Routine request', to: '' } },
        saOffer: { amount: null, text: '', cites: [] }, saPath: { match: 'yes', why: 'Sent and confirmed.' }, aeInvolvement: { kind: 'none', saCouldPrevent: false, why: '' },
        firstResponse: { concludedBeforeEvidence: false, why: 'Acknowledged and acted.', cites: ['F2'] } },
      comp: { bucket: '', label: '', pct: null, order: '', base: null, baseLabel: 'item subtotal', fee: null, amount: null, formula: 'No policy bucket chosen', needsApproval: false, limit: 25 },
      offer: { amount: null, match: 'none', note: 'No amount offered' },
      grade: { scores, reasons: Object.fromEntries(Object.keys(scores).map(k => [k, 'Cites F1 to F3.'])), route: { facts: { mark: 'right', why: 'Restated both prices.' }, analysis: { mark: 'right', why: 'Plain request.' },
        solution: { mark: 'right', why: 'Sent and confirmed.' }, escalation: { mark: 'right', why: 'Not needed.' } }, wentWell: ['Confirmed both prices back', 'Closed the loop'], nextTime: [], verdictWhy: 'Clean request handling.' },
      pct: 100, verdict: 'great', gradedAt: at(1, '15:00'), by: 'u_test' };
    const review = { sid: '9900901', week: pw, sa: 'Mara Quill', scores, pct: 100, verdict: 'great', coaching: 'Chat 9900901 · Birch Lane Pizza — Great (100.0%)', reviewer: 'QA lead', by: 'u_test', at: at(2, '15:00') };
    const calib = { sid: '9900901', wid: menu.wid, agent: 'Mara Quill', restaurant: 'Birch Lane Pizza', code: 'R90011', date: menu.at.slice(0, 10), verdict: 'great', lessons: ['Confirm the change back once it is live'], scores, by: 'u_test', at: at(2, '15:05') };
    return [[P('chats/9900901'), menu], [P('chats/9900902'), silent], [P('audits/9900901'), audit], [P('reviews/9900901'), review], ['chatCalib/9900901', calib], [`chatWeeks/${pw}`, { week: pw, chats: 2, picked: 1 }]] };
  return { fx, realSid: String(sid), realSA, SA, code, sideWeek, synthIds: synth.map(r => r.wira_project_tasks_short_wira_id),
    chat: { realSid: String(sid), states: (fx.stateRows || []).concat(states), base: [tagBase(real)].concat(synth.map(tagBase)), rel: fx.relRows.map(tagCode), orders: fx.orderRows.map(tagCode), calls: fx.callRows.map(tagCode),
      refs: {}, facts: out('facts'), analysis: out('analysis'), grade: grades[0], grade2: grades[1], gradeSrc: T1 ? 't1' : 'invented',
      synth: { facts: synthFacts, analysis: synthAnalysis, grade: [g({ fr: 3, ev: 3, rs: 3, fa: 3, path: 3, amt: 3, expl: 'na', esc: 'na', tone: 3 }), g({ fr: 2, ev: 2, rs: 3, fa: 2, path: 2, amt: 2, expl: 2, esc: 'na', tone: 3 }), g({ fr: 1, ev: 1, rs: 2, fa: 1, path: 1, amt: 1, expl: 'na', esc: 0, tone: 2 })] } },
    policy: JSON.parse(fs.readFileSync(path.join(CHAT_DIR, 'policy_pack.json'), 'utf8')), calibration: JSON.parse(fs.readFileSync(path.join(CHAT_DIR, 'calibration.json'), 'utf8')) };
}
/* a new-format grade (criteria + findings with quotes) built at run time from an older grade and the chat itself, for when the brain's t1 run isn't on disk.
   Quotes are cut from the chat's own messages, so nothing from the real case is written here */
function inventGrades(fx, old) {
  const B = require('../src/chat.js'), C = require('../src/core.js');
  const msgs = B.chatRow(fx.chatRow, { roster: C.ROSTER_DEFAULT }).msgs, sa = msgs.filter(m => m.role === 'sa');
  const quote = (m, k) => String(m.text).split(/\s+/).slice(0, k || 8).join(' ');
  const mk = second => { const scores = Object.assign({}, old.scores, second ? { tone: Math.max(0, (old.scores.tone || 0) - 1) } : {});
    const findings = B.CHAT_RUBRIC.filter(r => scores[r.id] !== 'na' && Number(scores[r.id]) < r.max).map((r, i) => { const m = sa[i % sa.length] || msgs[0];
      return { criterion: r.id, type: 'Invented finding ' + (i + 1), what: 'The SA missed part of this criterion.', why: 'It changes what the client gets.',
        evidence: [{ src: 'M' + m.n, quote: quote(m) }].concat(i === 0 ? [{ src: 'M' + m.n, quote: 'words that are not in the message' }] : []),
        should: 'Check first, then answer with the exact amount.', model: 'Hi, checking the order and the recording now; back in a few minutes.' } });
    return { criteria: Object.fromEntries(B.CHAT_RUBRIC.map(r => [r.id, { why: old.reasons[r.id] || '', score: scores[r.id] }])), route: old.route, wentWell: old.wentWell,
      findings, verdictWhy: old.verdictWhy } };
  return [mk(false), mk(true)];
}

/* The Learning world (all invented): 14 graded chats across 6 SAs in week lw, each audit tagged checkpoint cp0, brainRuns/cp0 with a grades doc per chat,
   one chat already reviewed and one already marked (both must never be drawn), and learning/state for that week. */
function learnWorld(lw) {
  const B = require('../src/chat.js');
  const SAS = ['Ana Ruiz', 'Ben Okafor', 'Cleo Marsh', 'Dev Patel', 'Eli Novak', 'Faye Lund'], per = [4, 3, 2, 2, 2, 1];
  const SC = [{ ev: 3, path: 3 }, { ev: 2, path: 3 }, { ev: 1, path: 3 }, { ev: 2, path: 1 }, { ev: 3, path: 2 }];
  const addD = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10), P = k => `chatWeeks/${lw}/${k}`;
  const seed = [], list = []; let n = 0;
  SAS.forEach((sa, si) => { for (let j = 0; j < per[si]; j++) { n++;
    const sid = String(9930000 + n), at = `${addD(lw, n % 6)}T${String(9 + (n % 8)).padStart(2, '0')}:15:00.000Z`, rest = `Test Kitchen ${n}`, code = 'R93' + String(n).padStart(3, '0');
    const em = sa.toLowerCase().replace(' ', '.') + '@wondersco.com', wid = `Wid(0,1,1,0,${sid})`, url = `https://wira.example.test/tasks/${sid}`;
    const msgs = [{ n: 1, author: 'client-+15550300', role: 'client', name: 'Rae', text: `Hi, please set our Sunday hours to 11 AM to 9 PM. This is Rae from ${rest}.`, internal: false, inferred: false },
      { n: 2, author: em, role: 'sa', name: sa, text: 'Hi Rae, done: Sunday is now 11 AM to 9 PM.', internal: false, inferred: false }];
    const chat = { v: 'chat-1', week: lw, picked: false, gradable: true, wid, sid, url, at, closedAt: '', status: 'closed', sub: '', title: msgs[0].text.slice(0, 80), direction: 'inbound', createdBy: '', createdByTitle: '',
      sa, saEmail: em, clientId: 'client-+15550300', frt: 2, firstClientAt: at, firstReplyAt: at, intent: 'hours', rating: '', code, restaurant: rest, initiator: 'client', msgs, clientName: 'Rae' };
    const scores = Object.assign({ fr: 3, ev: 3, rs: 3, fa: 'na', path: 3, amt: 'na', expl: 'na', esc: 'na', tone: 3 }, SC[n % SC.length]), pct = B.chatScore(scores), verdict = B.chatVerdict(pct).id;
    const audit = { v: 'chat-1', sid, wid, url, week: lw, at, sa, restaurant: rest, code, initiator: 'client', title: chat.title, frt: 2, clientName: 'Rae', checkpoint: 'cp0',
      tasks: [], orders: [], candidates: [], dayOrders: [], orderNote: '', orderPick: 'auto', refs: {}, calls: [], slack: [], notFound: [],
      facts: { calls: {}, timeline: [{ id: 'F1', src: 'M1', when: '', who: 'Rae (client)', kind: 'said', what: 'Asks to set Sunday hours to 11 AM to 9 PM' }, { id: 'F2', src: 'M2', when: '', who: sa, kind: 'said', what: 'Says Sunday hours are set' }], claims: [], promises: [] },
      analysis: { caseType: 'hours_service', request: 'Set Sunday hours', summary: 'The client asked for new Sunday hours; the SA set them.', fault: { who: 'none', why: 'A plain request.', cites: ['F1'] } },
      grade: { scores, reasons: Object.fromEntries(Object.keys(scores).map(k => [k, 'Cites F1 and F2.'])), route: { facts: { mark: 'right', why: 'Clear.' }, analysis: { mark: 'right', why: 'Plain.' }, solution: { mark: 'right', why: 'Set.' }, escalation: { mark: 'right', why: 'Not needed.' } }, wentWell: ['Fast'], nextTime: [], verdictWhy: 'Fine.' },
      pct, verdict, gradedAt: `${addD(lw, 7)}T10:00:00.000Z`, by: 'main' };
    seed.push([P('chats/' + sid), chat], [P('audits/' + sid), audit], [`brainRuns/cp0/grades/${sid}`, { sid, sa, restaurant: rest, pct, verdict, scores, priority: pct < 100 ? 'P2' : null, caseType: 'hours_service', fault: 'none' }]);
    list.push({ sid, sa, restaurant: rest, pct, verdict, scores }) } });
  const reviewed = list[0], marked = list[4];
  seed.push([P('reviews/' + reviewed.sid), { sid: reviewed.sid, week: lw, sa: reviewed.sa, scores: reviewed.scores, pct: reviewed.pct, verdict: reviewed.verdict, coaching: '', reviewer: 'QA lead', by: 'u_test', at: `${addD(lw, 8)}T09:00:00.000Z` }]);
  const mix = {}; list.forEach(x => mix[x.verdict] = (mix[x.verdict] || 0) + 1);
  const perSA = {}; SAS.forEach(sa => { const l = list.filter(x => x.sa === sa), v = {}; l.forEach(x => v[x.verdict] = (v[x.verdict] || 0) + 1); perSA[sa] = { n: l.length, avgPct: Math.round(l.reduce((t, x) => t + x.pct, 0) / l.length * 10) / 10, verdicts: v } });
  const cp0 = { id: 'cp0', round: 0, at: `${addD(lw, 7)}T10:00:00.000Z`, brain: 'chat-2', model: 'test-model', week: lw, chats: list.length, graded: list.length, avgPct: Math.round(list.reduce((t, x) => t + x.pct, 0) / list.length * 10) / 10,
    verdicts: mix, perSA, lessonsUsed: 2, learned: [{ kind: 'rule', text: 'A plain hours request has no fault to attribute.', crit: 'fa' }, { kind: 'lesson', text: 'Confirming the change back counts as the restatement.', sid: list[1].sid, crit: 'rs' }], notes: 'Checkpoint 0: the first full pass.' };
  seed.push(['brainRuns/cp0', cp0], ['learning/state', { week: lw, target: { verdicts: 8, pts: 5, streak: 2 }, marked: [marked.sid], rounds: [] }]);
  return { seed, list, reviewed, marked, SAS, cp0 };
}
/* Reinforce and order status (all invented): one graded chat in week rw with two findings (ev 2/3, tone 2/3), a voided order (no pick up),
   a fully refunded order, and that day's orders with one voided and one draft. */
function reinforceWorld(rw) {
  const P = k => `chatWeeks/${rw}/${k}`, sid = '9940001', at = `${rw}T18:10:00.000Z`, em = 'ivo.lark@wondersco.com', wid = `Wid(0,1,1,0,${sid})`, url = `https://wira.example.test/tasks/${sid}`;
  const m = (n, role, name, text, author) => ({ n, author, role, name, text, internal: false, inferred: false });
  const msgs = [m(1, 'client', 'Jo', 'Hi, a customer never picked up order 4471 and we want it off our books. This is Jo at Quarry Hill Pizza.', 'client-+15550401'),
    m(2, 'sa', 'Ivo Lark', 'Hi Jo, I voided 4471 and refunded 4470 in full as you asked.', em),
    m(3, 'client', 'Jo', 'Thanks.', 'client-+15550401')];
  const chat = { v: 'chat-1', week: rw, picked: true, gradable: true, wid, sid, url, at, closedAt: '', status: 'closed', sub: '', title: msgs[0].text.slice(0, 80), direction: 'inbound', createdBy: '', createdByTitle: '',
    sa: 'Ivo Lark', saEmail: em, clientId: 'client-+15550401', frt: 2, firstClientAt: at, firstReplyAt: at, intent: 'order', rating: '', code: 'R94001', restaurant: 'Quarry Hill Pizza', initiator: 'client', msgs, clientName: 'Jo' };
  const orders = [
    { id: 'ord-4471', label: 'O1', ticket: '4471', type: 'PICKUP', source: 'online_ordering', at: `${rw}T17:05:00.000Z`, items: 21.5, tax: 1.83, tip: 0, other: 0, total: 23.33, status: 'voided', voidWhy: 'NO_PICK_UP', pay: 'unpaid', refunded: 0, refundType: '' },
    { id: 'ord-4470', label: 'O2', ticket: '4470', type: 'PICKUP', source: 'phone', at: `${rw}T16:40:00.000Z`, items: 22.5, tax: 2, tip: 0, other: 0, total: 24.5, status: 'submitted', voidWhy: '', pay: 'fully_refunded', refunded: 24.5, refundType: 'full' }];
  const dayOrders = [{ id: 'ord-4472', ticket: '4472', type: 'DELIVERY', source: 'online_ordering', at: `${rw}T17:20:00.000Z`, total: 31.1, items: 27, status: 'voided' },
    { id: 'ord-4473', ticket: '4473', type: 'PICKUP', source: 'phone', at: `${rw}T17:30:00.000Z`, total: 12.4, items: 11, status: 'draft' },
    { id: 'ord-4474', ticket: '4474', type: 'PICKUP', source: 'phone', at: `${rw}T17:45:00.000Z`, total: 18.75, items: 17, status: 'submitted' }];
  const scores = { fr: 3, ev: 2, rs: 3, fa: 'na', path: 3, amt: 'na', expl: 'na', esc: 'na', tone: 2 };
  const reasons = { fr: 'Replied at once (F2).', ev: 'Voided O1 without checking the pickup time first (F2).', rs: 'Restated the order number (F2).', fa: '', path: 'Void and refund were right (F2).', amt: '', expl: '', esc: '', tone: 'Short but clear (F2).' };
  const findings = [
    { id: 'ev', priority: 'P2', label: 'Gathered the evidence', type: 'Did not check the order', score: 2, what: 'Voided the order without opening it.', why: 'A wrong void loses a sale.', should: 'Open the order and check the pickup time first.', model: 'Checking 4471 now.', evidence: [{ src: 'M2', quote: 'I voided 4471', ok: true }] },
    { id: 'tone', priority: 'P3', label: 'Reply quality', type: 'Too brief', score: 2, what: 'One line for two actions.', why: 'The client may miss the refund.', should: 'Name both actions on their own lines.', model: '', evidence: [{ src: 'M2', quote: 'refunded 4470 in full', ok: true }] }];
  const audit = { v: 'chat-1', sid, wid, url, week: rw, at, sa: chat.sa, restaurant: chat.restaurant, code: chat.code, initiator: 'client', title: chat.title, frt: 2, clientName: 'Jo',
    tasks: [], orders, candidates: [], dayOrders, orderNote: '', orderPick: 'auto', refs: {}, calls: [], slack: [], notFound: [],
    facts: { calls: {}, timeline: [{ id: 'F1', src: 'M1', when: '', who: 'Jo (client)', kind: 'said', what: 'Asks to void order 4471, never picked up' }, { id: 'F2', src: 'M2', when: '', who: 'Ivo Lark', kind: 'did', what: 'Voided 4471 and refunded 4470 in full' }], claims: [], promises: [] },
    analysis: { caseType: 'order_issue', request: 'Void an order that was never picked up', summary: 'The client asked to void an unpicked order; the SA voided it and refunded another.', fault: { who: 'none', why: 'The customer did not pick up.', cites: ['F1'] } },
    grade: { scores, reasons, findings, route: { facts: { mark: 'partly', why: 'Did not open the order.' }, analysis: { mark: 'right', why: 'Plain request.' }, solution: { mark: 'right', why: 'Voided.' }, escalation: { mark: 'right', why: 'Not needed.' } }, wentWell: ['Fast'], nextTime: [], verdictWhy: 'Fine.' },
    pct: 87.9, verdict: 'good', gradedAt: `${rw}T19:00:00.000Z`, by: 'main' };
  return { sid, findings, seed: [[P('chats/' + sid), chat], [P('audits/' + sid), audit], [`chatWeeks/${rw}`, { week: rw, chats: 1, picked: 1 }]] };
}
module.exports = { MOCK, openPage, LD, TASKS, TX, AI, DIR, chatWorld, learnWorld, reinforceWorld };
