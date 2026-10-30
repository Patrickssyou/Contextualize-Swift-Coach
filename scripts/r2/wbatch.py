import json,glob,os,sys
done=set(open('written.txt').read().split()) if os.path.exists('written.txt') else set()
w=[]
for f in sorted(glob.glob('docs/*.json')):
  k=os.path.basename(f)[:-5]
  if k in done:continue
  w.append({'op':'set','collection':'srAudits','doc_id':k,'file_path':os.path.abspath(f)})
print(json.dumps(w))
