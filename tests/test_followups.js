// Follow-up calls: outbound calls after a case's last talked leg (plain node, real data)
const fs=require('fs'),assert=require('assert');
const C=require('../src/core.js');
let n=0;const ok=(c,m)=>{assert.ok(c,m);n++;console.log('ok -',m)};
const id='ld-923fbe88-3aca-481b-82b0-b5e29bce7e19.json';
const doc=Object.assign(JSON.parse(fs.readFileSync('data/live4/queue/'+id)),JSON.parse(fs.readFileSync('data/backfill2/'+id)));
const bravo=JSON.parse(fs.readFileSync('data/fixtures/bravo_calls.json')).result.rows;
const cj=(id,at,sec,phone,code,name)=>({calls_conversation_id:id,calls_call_started_at_est:'2026-09-28T'+at+'.000Z',calls_call_duration_in_seconds:sec,internal_users_user_login_name:'cjdomingogd',
  calls_call_type:'outbound_call',calls_call_phone_detail:phone,restaurants_unique_code:code,restaurants_english_name:name});
const real=[cj('cj1','19:27:24',56,'2156081052','R70218',"George's Pizza"),cj('cj2','20:47:39',222,'2677361578','R87881',''),
  cj('cj3','20:51:33',47,'2157478563','R87881',''),cj('cj4','20:52:26',34,'2677361578','R87881','')];
const rows=bravo.filter(r=>r.calls_call_type==='outbound_call').concat(real);

// config
const cfg=C.followUpConfig(['cjdomingogd','zzcjdomingo'],'2026-09-28','2026-09-29');
ok(cfg.exploreName===C.PULL.explore&&cfg.limit===C.PULL.cap&&cfg.metrics.length===0,'config: calls explore, capped, no metrics');
ok(/calls_call_type equals=outbound_call/.test(cfg.filters.dimensions)&&/inBetween=2026-09-28,2026-09-29/.test(cfg.filters.dimensions)&&/equals=cjdomingogd,zzcjdomingo$/.test(cfg.filters.dimensions),'config: outbound filter, day window, logins');
['calls_conversation_id','calls_call_started_at_est','calls_call_duration_in_seconds','internal_users_user_login_name','calls_call_phone_detail','restaurants_unique_code','restaurants_english_name']
  .forEach(d=>ok(cfg.dimensions.includes(d),'config dimension '+d));

// CJ Bravo case: last talked leg ends 17:09:23+59s = 17:10:22
const f=C.followUps(doc,rows);
ok(f.length===4,'CJ Bravo: 4 outbound calls in 24h (got '+f.length+'; other agents in the fixture are ignored)');
ok(f.filter(x=>x.sameRestaurant).length===0,'CJ Bravo: zero same-restaurant follow-ups');
ok(f[0].id==='cj1'&&f[0].minutesAfter===137&&f[0].phone==='2156081052'&&f[0].code==='R70218'&&f[0].sec===56,'first follow-up fields (minutesAfter 137)');
ok(f.map(x=>x.id).join()==='cj1,cj2,cj3,cj4','sorted by time');
const line=C.followUpLine(doc,f);
console.log(line);
ok(/^CJ Domingo made 4 outbound calls in the 24 hours after the last call: 7:27 PM to George's Pizza \(R70218\), 8:47 PM to 2677361578 \(R87881\)/.test(line),'line lists times in ET 12-hour');
ok(C.followUpLine(doc,[])==='No outbound call by CJ Domingo in the 24 hours after the last call.','empty line');
ok(/made 1 outbound call in/.test(C.followUpLine(doc,[f[0]])),'singular');
ok(C.followUps(doc,bravo).length===0,'only other agents outbound rows: nothing');

// window edges (end = 17:10:22)
const at=(t,id)=>Object.assign(cj(id,'00:00:00',10,'1','R1','A'),{calls_call_started_at_est:t});
const e=(t)=>C.followUps(doc,[at(t,'e')]).length;
ok(e('2026-09-28T17:10:21.000Z')===0,'edge: 1s before last leg ends excluded');
ok(e('2026-09-28T17:10:22.000Z')===1,'edge: exactly at hang-up included');
ok(e('2026-09-29T17:10:22.000Z')===1,'edge: exactly 24h included');
ok(e('2026-09-29T17:10:23.000Z')===0,'edge: 24h + 1s excluded');
ok(C.followUps(doc,[at('2026-09-29T17:10:23.000Z','e')],25).length===1,'hours param widens window');
const rd=at('2026-09-28T18:00:00.000Z','e');rd.calls_call_type='inbound_call';
ok(C.followUps(doc,[rd]).length===0,'inbound rows ignored');
ok(C.followUps(doc,[at('2026-09-28T18:00:00.000Z','e'),at('2026-09-28T18:00:00.000Z','e')]).length===1,'duplicate ids collapse');

// chain legs excluded; voicemail leg does not move the end
const d2=JSON.parse(JSON.stringify(doc));
const legRow=Object.assign(at('2026-09-28T17:11:00.000Z','51de9471-3a49-4111-ae85-9b5f0ec52b8a'),{calls_call_type:'outbound_call'});
d2.chain.legs[1].talk='voicemail';
ok(C.followUps(d2,[legRow]).length===0,'chain leg id is excluded even when it falls in the window');
d2.chain.legs.push({id:'zz',at:'2026-09-28T17:30:00',sec:30,login:'cjdomingogd',graded:true,own:true,talk:'talk'});
ok(C.followUps(d2,[at('2026-09-28T17:20:00.000Z','n1')]).length===0,'window starts after a later talked leg ends');
ok(C.followUps(d2,[at('2026-09-28T17:30:30.000Z','n2')]).length===1,'window moves to the last talked leg end');
const d3=JSON.parse(JSON.stringify(doc));d3.chain.legs.forEach(l=>l.talk='silent');
ok(C.followUps(d3,[at('2026-09-28T17:11:00.000Z','n3')]).length===1,'no talked legs: falls back to all legs');
ok(C.followUps({chain:{legs:[]}},rows).length===0,'no legs: nothing');
// same-restaurant flag
const sr=C.followUps(doc,[Object.assign(at('2026-09-28T18:00:00.000Z','s1'),{restaurants_unique_code:'R89316',restaurants_english_name:'Bravo Pizza II'})]);
ok(sr.length===1&&sr[0].sameRestaurant&&/same restaurant/.test(C.followUpLine(doc,sr)),'same-restaurant flagged and worded');
console.log('followups: '+n+' checks passed');
