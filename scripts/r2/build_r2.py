"""Round 2 srAudits docs: extracted call (raw/<id8>.json) + Claude's audit (audits/<id8>.json) -> docs/<key>.json (pct/verdict from the page's own scoring)."""
import json, glob, os, statistics, math, re, subprocess, datetime
from cur import cur
BAD = re.compile(r'\bnigg\w*', re.I)
C = {c['callId'][:8]: c for c in json.load(open('calls48.json'))}
os.makedirs('docs', exist_ok=True)
built = []
for f in sorted(glob.glob('audits/*.json')):
    id8 = os.path.basename(f)[:8]; A = json.load(open(f)); o = json.load(open('raw/%s.json' % id8)); c = C[id8]
    q = json.load(open('q/%s.json' % c['key'])); q = q.get('data', q) if 'agent' not in q else q
    ag, ot = set(A.get('agentLines') or []), set(A.get('otherLines') or []); flags = {int(k): v for k, v in (A.get('flags') or {}).items()}
    lines = []
    for i, cp in enumerate(o.get('captions') or []):
        L = dict(t=cp['s'], e=cp['e'], who='agent' if i in ag else 'other' if i in ot else 'caller', txt=BAD.sub('[unclear]', cp['t']))
        if cp.get('f0') and 70 <= cp['f0'] <= 400: L['f0'] = cp['f0']
        if i in flags: L['flag'] = flags[i]
        lines.append(L)
    dur = (o.get('voice') or {}).get('dur') or (max([l['e'] for l in lines]) if lines else 0)
    A_ = [l for l in lines if l['who'] == 'agent']; Cl = [l for l in lines if l['who'] != 'agent']
    tsum = lambda L: sum(max(0, l['e'] - l['t']) for l in L)
    f0s = [l['f0'] for l in A_ if l.get('f0')]; med = statistics.median(f0s) if f0s else None
    sd = statistics.pstdev([12 * math.log2(x / med) for x in f0s]) if len(f0s) > 2 else None
    wps = lambda L: round(sum(len(l['txt'].split()) for l in L) / max(1, tsum(L)), 1) if L else None
    scr = cur(o) if o.get('screen') and o.get('voice') else []
    idle = [x for x in scr if x['k'] == 'idle']
    stats = dict(agentTalkPct=round(100 * tsum(A_) / dur) if dur else None, callerTalkPct=round(100 * tsum(Cl) / dur) if dur else None, agentF0=round(med) if med else None,
                 agentF0sd=round(sd, 1) if sd is not None else None, agentWps=wps(A_), callerWps=wps(Cl), idleSec=round(sum(x['d'] for x in idle)), idleN=len(idle),
                 actions=len([x for x in scr if x['k'] in ('click', 'dblclick', 'type')]), typed=len([x for x in scr if x['k'] == 'type']))
    screen = [dict(t=x['t'], k=x['k'], l=('Phone number' if x['l'].startswith('•••') and x['k'] == 'type' else x['l'])[:90], **({'v': x['v'][:120]} if x.get('v') else {}), **({'d': x['d']} if x.get('d') else {})) for x in scr]
    d0 = datetime.date.fromisoformat(c['date'])
    doc = dict(id=c['key'], callId=c['callId'], sa=c['sa'], alias=A.get('alias') or c['sa'].split()[0], restaurant=c['restaurant'], kind=c['kind'], date=d0.strftime('%b ') + str(d0.day),
               dur=dur, stats=stats, lines=lines, screen=screen, silences=(o.get('voice') or {}).get('silences') or [], audit=A['audit'], at=o.get('at'), v=1, round=c['pool'],
               grade=dict(scores=A['grade']['scores'], reasons=A['grade'].get('reasons') or {}, rubric='call-v4', v='sr-grade-2', by='claude', at=datetime.datetime.utcnow().isoformat() + 'Z', lessons=32))
    built.append(doc)
json.dump([dict(id=d['id'], kind=d['kind'], scores=d['grade']['scores']) for d in built], open('pct_in.json', 'w'))
subprocess.run(['node', '/tmp/claude-0/-home-claude/1b142488-5d26-5ec4-ac9b-9c6af59eb289/scratchpad/sr/t/pct.js', 'pct_in.json', 'pct_out.json'], check=True, capture_output=True)
P = {x['id']: x for x in json.load(open('pct_out.json'))}
for d in built:
    d['grade']['pct'] = P[d['id']]['pct']; d['grade']['verdict'] = P[d['id']]['verdict']
    json.dump(d, open('docs/%s.json' % d['id'], 'w'))
    print(d['id'][3:11], d['sa'][:14].ljust(14), d['kind'], str(d['grade']['pct']).rjust(5), d['grade']['verdict'], len(json.dumps(d)) // 1024, 'KB', len(d['audit']['findings']), 'findings')
