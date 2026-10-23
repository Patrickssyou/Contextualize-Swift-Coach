const B=require('./load2.js');const fs=require('fs');
const rows=B.normRows(JSON.parse(fs.readFileSync('all_rows2.json')));const byId=new Map(rows.map(r=>[r.id,r]));
const RC=JSON.parse(fs.readFileSync('rechain2.json'));const tasks=B.taskRows(JSON.parse(fs.readFileSync('task_scan2.json')));
const res={},need=new Set();
for(const [id,L] of Object.entries(RC)){const S=byId.get(id);const own=L.filter(x=>!x.ref).map(x=>byId.get(x.id)).map(l=>({id:l.id,t0:l.t0,t1:l.t1}));
  const l=B.linkTasks({code:S.code,legs:own},tasks,{name:"",creators:[],keys:new Set(),nameKey:""},B.TASKS);res[id]=l;l.forEach(x=>need.add(x.id));
  console.log(S.name,l.map(x=>x.id+' '+tasks.find(t=>t.id===x.id).cat).join(' | '))}
fs.writeFileSync('task_links2.json',JSON.stringify(res));console.log([...need].join(','))
