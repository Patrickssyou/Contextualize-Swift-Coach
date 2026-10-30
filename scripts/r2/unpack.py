import json,glob,os
ids=set(c['callId'] for c in json.load(open('calls48.json')))
n=0
for f in glob.glob('srraw2/srRaw/*.json'):
  d=json.load(open(f));d=d.get('data',d) if 'json' not in d else d
  if d['id'] not in ids:continue
  o=json.loads(d['json']);p='raw/%s.json'%d['id'][:8]
  if not os.path.exists(p):json.dump(o,open(p,'w'));n+=1
print('new',n,'total',len(os.listdir('raw')))
