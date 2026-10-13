// Scores pass-1 replies against the hand-made gold lists in data/eval/gold/.
// node eval/score.js <tag> [<tag2> ...]      -> table per case and tag
// node eval/score.js --sheet <case> <tag>    -> gold next to the reply, for writing a judge file
// Reply:  data/eval/<case>.p1.<tag>.out.json  (raw JSON the model returned; run through cleanFacts here)
// Judge:  data/eval/judge/<case>.<tag>.json   {"attr":["F3"],"leak":["F9"],"missed":["G4"],"notes":"..."}
//   attr   = fact assigned to the wrong speaker (a gold "unclear" line given to a named person counts too)
//   leak   = fact that is really a conclusion (fault, cause, judgement, intent)
//   missed = gold statement/action/promise not in the timeline, call bullets or promises
// Traps in the gold file are checked automatically: a fact from trap.src whose text matches trap.match
// (or any fact from that call when onWho) and whose "who" matches trap.wrong is a trap hit (counted as attr if not judged).
const fs=require('fs'),path=require('path'),C=require('../src/core.js'),{ROOT}=require('./lib.js'),CASES=require('./cases.js');
const E=f=>path.join(ROOT,'data/eval',f),rj=f=>{try{return JSON.parse(fs.readFileSync(f))}catch(e){return null}};
const LEAK=/\b(should|failed|fail(s|ed)? to|correctly|properly|appropriate|mistake|fault|caused|because of|root cause|poor(ly)?|good job|well handled|did not bother|ignored|unprofessional|resolved)\b/i;
function load(k,tag){const inp=rj(E(k+'.input.json')),raw=rj(E(`${k}.p1.${tag}.out.json`));if(!inp||!raw)return null;
  const F=C.cleanFacts(raw,inp.legs);return F&&{F,raw,inp}}
function traps(gold,F){const hits=[];(gold.traps||[]).forEach((t,i)=>F.timeline.forEach(f=>{
  if(t.src&&f.src&&f.src.toLowerCase()!==t.src.toLowerCase())return;
  if(!t.onWho&&!new RegExp(t.match,'i').test(f.what))return;
  if(new RegExp(t.wrong,'i').test(f.who))hits.push({trap:i,fact:f.id,who:f.who,what:f.what,line:t.line})}));return hits}
function score(k,tag){const gold=rj(E('gold/'+k+'.json')),r=load(k,tag);if(!gold||!r)return null;
  const J=rj(E(`judge/${k}.${tag}.json`)),th=traps(gold,r.F.timeline?r.F:r.F);
  const attr=J?J.attr.length:new Set(th.map(h=>h.fact)).size,leak=J?J.leak.length:r.F.timeline.filter(f=>LEAK.test(f.what)).length;
  return {k,tag,facts:r.F.timeline.length,attr,leak,missed:J?J.missed.length:null,gold:gold.items.length,trapHits:th.length,judged:!!J,th}}
const a=process.argv.slice(2);
if(a[0]==='--sheet'){const [_,k,tag]=a,gold=rj(E('gold/'+k+'.json')),r=load(k,tag);
  console.log('GOLD');gold.items.forEach(g=>console.log(`${g.id} ${g.src} · ${g.who} [${g.kind}] ${g.what}\n     "${g.key}"`));
  if(!r){console.log('\n(no reply for',k,tag+')');process.exit(0)}
  console.log('\nREPLY');r.F.timeline.forEach(f=>console.log(`${f.id} ${f.src} · ${f.who} [${f.kind}] ${f.what}${LEAK.test(f.what)?'   <-- leak?':''}`));
  r.F.promises.forEach(p=>console.log(`${p.id} ${p.src} · ${p.who} -> ${p.to}: ${p.what}`));
  console.log('\nTRAP HITS');traps(gold,r.F).forEach(h=>console.log(`${h.fact} (${h.who}) ${h.what}\n     transcript: "${h.line}"`));process.exit(0)}
const tags=a.length?a:['current','new'],rows=[];
for(const k of Object.keys(CASES))for(const t of tags){const s=score(k,t);if(s)rows.push(s)}
console.log('case               tag      facts gold attr leak missed traps judged');
rows.forEach(s=>console.log(`${s.k.padEnd(18)} ${s.tag.padEnd(8)} ${String(s.facts).padStart(5)} ${String(s.gold).padStart(4)} ${String(s.attr).padStart(4)} ${String(s.leak).padStart(4)} ${String(s.missed??'-').padStart(6)} ${String(s.trapHits).padStart(5)} ${s.judged?'yes':'auto'}`));
const tot=t=>rows.filter(s=>s.tag===t).reduce((o,s)=>(o.n++,o.attr+=s.attr,o.leak+=s.leak,o.missed+=s.missed||0,o),{n:0,attr:0,leak:0,missed:0});
tags.forEach(t=>{const o=tot(t);if(o.n)console.log(`TOTAL ${t}: ${o.n} cases · attr ${o.attr} · leak ${o.leak} · missed ${o.missed}`)});
