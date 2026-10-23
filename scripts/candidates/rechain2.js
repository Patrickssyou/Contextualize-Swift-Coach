const B=require('./load2.js');const fs=require('fs');
const rows=B.normRows(JSON.parse(fs.readFileSync('all_rows2.json')));const byId=new Map(rows.map(r=>[r.id,r]));
const P=JSON.parse(fs.readFileSync('plan2.json'));const old=new Set(JSON.parse(fs.readFileSync('out.json')).round.items.map(x=>x.kind==='call'?x.key.slice(3):x.key));
const o=B.PULL,res={},f=t=>new Date(t).toISOString().slice(5,16).replace('T',' ');
for(const [sa,l] of Object.entries(P))for(const it of l){if(it.k==='CHAT'||old.has(it.id))continue;
  const S=byId.get(it.id),me=S.login;let legs;
  if(it.k==='OT'){// order line: only calls to or from the same customer number, within the chain window
    legs=[S];let a=S.t0,b=S.t1,grew=true;while(grew){grew=false;for(const r of rows){if(legs.includes(r)||r.phone!==S.phone||r.t0>b+o.gapMin*6e4||r.t1<a-o.gapMin*6e4)continue;legs.push(r);a=Math.min(a,r.t0);b=Math.max(b,r.t1);grew=true}}}
  else{legs=B.buildChain(S,rows,new Set([me]),o);const rids=new Set(legs.filter(l=>/^\d+$/.test(l.phone)||l.login===me).map(l=>l.rid).filter(Boolean));
    legs=legs.filter(l=>l.id===S.id||l.login===me||/^\d+$/.test(l.phone)||rids.has(l.rid))}
  const why=new Map();
  if(it.k==='MGR'||it.k==='DE'){const t0=Math.min(...legs.map(l=>l.t0)),nums=new Set(legs.map(l=>l.phone).filter(p=>/^\d+$/.test(p)));
    rows.filter(r=>nums.has(r.phone)&&r.rid===S.rid&&r.t0<t0&&r.t0>=t0-24*3600e3&&!legs.some(l=>l.id===r.id)).forEach(r=>{legs.push(r);why.set(r.id,'order')})}
  legs.sort((a,b)=>a.t0-b.t0);
  res[it.id]=legs.map(l=>({id:l.id,ref:l.login!==me&&String(l.phone).toLowerCase()!==me,why:why.get(l.id)||''}));
  console.log(sa.padEnd(15),it.k.padEnd(3),f(S.t0),(S.name||'').slice(0,20).padEnd(20),legs.map(l=>l.id===S.id?'*S*':`[${Math.round((l.t0-S.t0)/60000)}m ${l.dir} ${(l.agent||l.login).split(' ')[0]} ${l.sec}s${res[it.id].find(x=>x.id===l.id).ref?' REF':''}${why.get(l.id)?' order':''}]`).join(' '))}
fs.writeFileSync('rechain2.json',JSON.stringify(res));
