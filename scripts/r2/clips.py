import json,glob,os
sent=set(open('clipq.txt').read().split()) if os.path.exists('clipq.txt') else set()
out={}
for f in sorted(glob.glob('docs/*.json')):
  d=json.load(open(f))
  if d['callId'] in sent:continue
  dur=d['dur'] or 0;C=[]
  for t in sorted(x['t'] for x in d['audit']['findings']):
    s,e=max(0,t-12),min(dur,t+12) if dur else t+12
    if e<=s: continue
    if C and s<=C[-1][1]+2:C[-1][1]=max(C[-1][1],e)
    else:C.append([s,e])
  out[d['callId']]=[[round(a,1),round(b,1)] for a,b in C]
open('clipq.txt','a').write('\n'.join(out)+'\n')
print("window.__cq=(window.__cq||[]).concat("+json.dumps([[k,v] for k,v in out.items()])+");if(!window.__cRun){window.__cRun=true;(async()=>{while(window.__cq.length){const [id,cl]=window.__cq.shift();try{const r=await window.srClipBuild(id,cl);window.__media[id]=r.json}catch(e){window.__mediaErr[id]=String(e).slice(0,100)}}window.__cRun=false})()};'queued '+window.__cq.length")
