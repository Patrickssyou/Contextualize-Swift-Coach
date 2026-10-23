const B=require('./load.js');const fs=require('fs');
const rows=B.normRows(JSON.parse(fs.readFileSync('all_rows.json')));const byId=new Map(rows.map(r=>[r.id,r]));
const out=JSON.parse(fs.readFileSync('out.json')),RC=JSON.parse(fs.readFileSync('rechain.json'));
const tasks=B.taskRows(JSON.parse(fs.readFileSync('task_scan.json')));
const res={},need=new Set();
for(const [k,q] of out.queue){const own=RC[q.callId].filter(x=>!x.ref).map(x=>byId.get(x.id)).map(l=>({id:l.id,t0:l.t0,t1:l.t1}));
  const ag={name:q.agent,creators:[],keys:new Set(),nameKey:B.normWho(q.agent)};
  const l=B.linkTasks({code:q.restaurantId,legs:own},tasks,ag,B.TASKS);res[q.callId]=l;l.forEach(x=>need.add(x.id));
  console.log(q.agent.padEnd(15),q.kind,q.callDate,q.restaurantId,l.map(x=>`${x.id} ${x.when} ${x.min}m ${tasks.find(t=>t.id===x.id).cat} by=${tasks.find(t=>t.id===x.id).by}`).join(' | '))}
fs.writeFileSync('task_links.json',JSON.stringify(res));console.log([...need].join(','))
