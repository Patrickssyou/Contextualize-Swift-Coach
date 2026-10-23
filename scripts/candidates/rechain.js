const B=require('./load.js');const fs=require('fs');
const all=JSON.parse(fs.readFileSync('all_rows.json'));const rows=B.normRows(all);const byId=new Map(rows.map(r=>[r.id,r]));
const out=JSON.parse(fs.readFileSync('out.json'));const o=B.PULL;
const f=t=>new Date(t).toISOString().slice(5,16).replace('T',' ');
const res={};
for(const [k,q] of out.queue){const S=byId.get(q.callId),me=S.login,L=new Set([me]);
  let legs=B.buildChain(S,rows,L,o);
  // internal calls with the candidate count only at a restaurant already in the chain
  const rids=new Set(legs.filter(l=>!(l.phone||'').match(/^[a-z]/i)||l.login===me).map(l=>l.rid).filter(Boolean));
  legs=legs.filter(l=>l.id===S.id||l.login===me||/^\d+$/.test(l.phone)||rids.has(l.rid));
  const why=new Map();
  // the order call: an earlier call from the same customer number to the same restaurant, up to 24h before
  if(q.kind==='MGR'||q.kind==='DE'){const t0=Math.min(...legs.map(l=>l.t0)),nums=new Set(legs.map(l=>l.phone).filter(p=>/^\d+$/.test(p)));
    rows.filter(r=>nums.has(r.phone)&&r.rid===S.rid&&r.t0<t0&&r.t0>=t0-24*3600e3&&!legs.some(l=>l.id===r.id)).forEach(r=>{legs.push(r);why.set(r.id,'order')})}
  // SME: the colleague's call the candidate was brought into
  if(q.kind==='SME'){const caller=S.phone.toLowerCase();const p=rows.filter(r=>r.login===caller&&r.rid===S.rid&&r.t0<=S.t0+60e3&&r.t1>=S.t0-60e3);
    p.forEach(r=>{if(!legs.some(l=>l.id===r.id)){legs.push(r);why.set(r.id,'parent')}})}
  legs.sort((a,b)=>a.t0-b.t0);
  res[q.callId]=legs.map(l=>({l,ref:l.login!==me&&String(l.phone).toLowerCase()!==me,why:why.get(l.id)||''}));
  console.log(q.agent.padEnd(15),q.kind.padEnd(3),f(S.t0),(q.restaurantName||'').slice(0,20).padEnd(20),res[q.callId].map(x=>x.l.id===S.id?'*SAMPLED*':`[${Math.round((x.l.t0-S.t0)/60000)}m ${x.l.dir} ${(x.l.agent||x.l.login).split(' ')[0]} ${x.l.sec}s${x.ref?' REF':''}${x.why?' '+x.why:''}]`).join(' '))}
fs.writeFileSync('rechain.json',JSON.stringify(Object.fromEntries(Object.entries(res).map(([k,v])=>[k,v.map(x=>({id:x.l.id,ref:x.ref,why:x.why}))]))));
