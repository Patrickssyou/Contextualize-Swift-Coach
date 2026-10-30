"""Round 2 highlight windows, v2 (Oct 30): ±20 s around every finding, the save/submit/task/remark clicks on screen,
and the wrap-up after hang-up up to the agent's last screen action. Clip ends are not capped at the audio end."""
import json,glob,re,sys
SAVE=re.compile(r'save|submit|create|remark|ticket|task|confirm|update|send|note',re.I)
def windows(d):
    dur=d['dur'] or 0;sc=d.get('screen') or []
    act=[x['t'] for x in sc if x['k'] in('click','dblclick','type')]
    end=max([dur]+act)+5
    W=[[t-20,t+20] for t in (x['t'] for x in d['audit']['findings'])]
    W+=[[x['t']-8,x['t']+6] for x in sc if x['k'] in('click','dblclick') and SAVE.search(x.get('l',''))]
    post=[t for t in act if t>dur]
    if post: W.append([dur-5,max(post)+5])
    W=sorted([max(0,a),min(end,b)] for a,b in W if b>0)
    C=[]
    for a,b in W:
        if b<=a: continue
        if C and a<=C[-1][1]+4: C[-1][1]=max(C[-1][1],b)
        else: C.append([a,b])
    return [[round(a,1),round(b,1)] for a,b in C]
if __name__=='__main__':
    old=new=0;out={}
    for f in sorted(glob.glob('docs/*.json')):
        d=json.load(open(f));L=json.load(open('live_sr/srAudits/'+d['id']+'.json'))
        oc=(L.get('media') or {}).get('clips') or [];old+=sum(b-a for a,b in oc)
        c=windows(d);new+=sum(b-a for a,b in c);out[d['callId']]=c
    json.dump(out,open('clips20.json','w'))
    print('clip seconds old',round(old),'new',round(new),'ratio',round(new/old,2))
