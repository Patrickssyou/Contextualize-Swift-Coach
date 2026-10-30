import json,sys,re
NOISE=re.compile(r'^(div|span|button|input|td|tr|svg|path|li|field|i|a|p|img)$|expand_more Date|^Type / to search$|^Search by order number$|^History history$|^Restaurant$|skip inactive|^Close Calls Other|^home ')
def cur(o):
    dur=o['voice']['dur'];out=[];last=None
    for x in o['screen']['timeline']:
        if not(-15<=x['t']<=dur+90):continue
        l=(x.get('l') or '').strip();v=(x.get('v') or '').strip()
        if x['k'] in('click','dblclick') and (NOISE.search(l) or len(l)>64): 
            if len(l)>64 and not NOISE.search(l): l=l[:60]+'…'
            else: continue
        if x['k']=='type' and (not v or NOISE.search(l) or l.startswith('react-aria')): continue
        if x['k']=='load': continue
        key=(x['k'],l,v)
        if key==last: continue
        last=key;out.append({'t':x['t'],'k':x['k'],'l':l,'v':v})
    for a,d in o['screen']['idle']:
        if -15<=a<=dur+90: out.append({'t':a,'k':'idle','l':'No clicks, typing or scrolling','d':d})
    return sorted(out,key=lambda z:z['t'])
if __name__=='__main__':
    o=json.load(open('raw/'+sys.argv[1]+'.json'))
    C=[(c['s'],f"C{i} {c['t']}") for i,c in enumerate(o['captions'])]
    S=[(x['t'],f"   S {x['k']}: {x['l']}"+(f" = {x['v']}" if x.get('v') else '')+(f" ({x['d']}s)" if x.get('d') else '')) for x in cur(o)]
    for t,s in sorted(C+S): print(f"{int(t//60)}:{int(t%60):02d} {s}")
    print('dur',o['voice']['dur'],'silences',o['voice']['silences'])
