// Tabs + game layer: a pick opens in Calls with each call's summary; saving adds XP and moves the week quest
const { chromium } = require('playwright'); const fs=require('fs'),path=require('path'),assert=require('assert');
const { openPage } = require('./mock.js');
let n=0;const ok=(c,m)=>{assert.ok(c,m);n++;console.log('ok -',m)};
const cj=JSON.parse(fs.readFileSync('data/gen2/cj.ai.json'));
const CJ='ld-923fbe88-3aca-481b-82b0-b5e29bce7e19';
const seed=[['pulls/2026-09-28',{status:'done',week:'2026-09-28',at:'2026-10-05T19:33:25.065Z',added:30}]];
for(const f of fs.readdirSync('data/live4/queue')){const q=JSON.parse(fs.readFileSync('data/live4/queue/'+f));if(q.week!=='2026-09-28')continue;Object.assign(q,JSON.parse(fs.readFileSync('data/backfill2/'+f)));
  const id=f.replace('.json','');if(id===CJ)q.aiFacts=cj;delete q.version;seed.push(['queue/'+id,q])}
(async()=>{const b=await chromium.launch();
 const {page,ctx,errors}=await openPage(b,seed,{viewer:true},{width:1280,height:900});
 await page.goto('http://qa.test/');await page.waitForTimeout(300);
 ok(await page.locator('[role=tab][aria-selected="true"]').getAttribute('data-tab')==='queue','opens on Snapshot');
 const tabs=(await page.locator('[role=tab]').allInnerTexts()).map(t=>t.replace(/\s+/g,' ').trim());
 ok(tabs.length===5&&['Snapshot','Calls','Facts','Results','Database'].every((x,i)=>tabs[i].includes(x)),'tabs: Snapshot, Calls, Facts, Results, Database ('+tabs.join(' / ')+')');
 await page.click('#wkNext');await page.waitForTimeout(300);
 ok(/0\s+of 30 audited/.test(await page.locator('#quest').innerText()),'week quest starts at 0 of 30');
 ok(await page.locator('.qcard:not(.qcases)',{hasText:'CJ Domingo'}).locator('.pips i').count()===5,'CJ card has 5 pips');
 const xp0=await page.evaluate(()=>gameStats().xp);
 // pick → Calls tab with per-call summaries
 await page.locator('.qcard:not(.qcases) .qitem',{hasText:'Bravo Pizza II'}).locator('[data-q]').first().click();await page.waitForTimeout(300);
 ok(await page.locator('[role=tab][aria-selected="true"]').getAttribute('data-tab')==='calls','a pick opens in Calls');
 ok(await page.locator('[data-tab="calls"]').evaluate(e=>e.classList.contains('done')),'Calls tab shows the loaded check');
 const want=Object.values(cj.facts.calls).reduce((t,x)=>t+x.length,0);
 ok(await page.locator('#chainPanel .txcall').count()===2,'two call cards');
 ok(await page.locator('#chainPanel .txsum li').count()===want,`each card shows its bullets (${want})`);
 ok((await page.locator('#chainPanel .txcall').first().innerText()).includes(cj.facts.calls['923fbe88-3aca-481b-82b0-b5e29bce7e19'][0]),'first card leads with its own summary');
 ok(await page.locator('#chainPanel .txcall a',{hasText:'Rec'}).count()===2,'each card has a recording link');
 ok(await page.locator('#callsRead').count()===0,'no Read button when summaries exist');
 ok(await page.locator('#st-facts .dot').count()===1,'Facts tab dot: read ready');
 // the scorecard sits under the calls on the same tab and starts at Case facts
 const order=await page.evaluate(()=>['#s-call','#chainWrap','#tasksWrap','#s-facts','#rubric','#s-take'].map(s=>document.querySelector(s).getBoundingClientRect().top));
 ok(order.every((t,i)=>!i||t>order[i-1]),'Calls order: details, calls, tasks, case facts, rubric, note');
 ok(await page.locator('#steps #fLink, #steps #fRid, #steps #fCallId, #steps #fReviewer').count()===0,'scorecard repeats no call meta');
 ok(await page.locator('#s-call #fLink').isVisible()&&await page.locator('#s-call #fRid').isVisible()&&await page.locator('#s-call #fCallId').isVisible(),'call link, restaurant ID and WIRA ID in the call details');
 ok(await page.locator('.board').isVisible(),'score board beside the calls');
 await page.fill('#fReviewer','Patrick');await page.click('#gutChips [data-g="ok"]');
 await page.fill('#fRootCause','Receipt dispute on a self-delivery order');await page.click('#faultCorrectChips [data-fc="customer"]');await page.click('#faultAgentChips [data-fa="none"]');
 await page.click('#singleTouchChips [data-st="yes"]');await page.click('#sourceChips [data-src="call_rec"]');
 await page.click('#crit-1a .head');
 for(const [k,r] of [['3'],['3'],['3'],['3'],['3'],['2','Did not settle who was owed'],['3','Reprinted the ticket'],['n','One-off'],['3'],['3'],['n'],['3']]){await page.keyboard.press(k);if(r){await page.waitForTimeout(30);await page.keyboard.type(r);await page.keyboard.press('Enter')}}
 ok((await page.locator('#xpHint').innerText()).trim()==='+10 XP','board previews +10 XP');
 ok(/%$/.test((await page.locator('#st-score').innerText()).trim()),'Calls tab shows the running %');
 await page.click('[data-tab="facts"]');await page.click('#aiShow');await page.click('[data-m="rootCause"][data-v="same"]');await page.click('[data-tab="calls"]');
 ok((await page.locator('#xpHint').innerText()).trim()==='+12 XP','marking a conclusion adds 2 XP to the preview');
 await page.click('#saveBtn');await page.waitForTimeout(400);
 const xp1=await page.evaluate(()=>gameStats().xp);
 ok(xp1-xp0===12,`save adds XP (${xp0} → ${xp1})`);
 ok(/\+12 XP · 1 of 30/.test(await page.locator('#toast').innerText()),'toast: +12 XP · 1 of 30');
 ok(await page.locator('#toast .tact',{hasText:'Next pick'}).count()===1,'toast offers Next pick');
 ok((await page.locator('#xpNum').innerText()).trim()===xp1+' XP','header shows XP');
 ok(await page.locator('#streak.on').count()===1&&(await page.locator('#streakN').innerText())==='1','streak lit at 1 day');
 ok(await page.locator('.badge.on',{hasText:'First audit'}).count()===1,'First audit badge earned');
 await page.click('#toast .tact');await page.waitForTimeout(200);
 ok(await page.locator('[role=tab][aria-selected="true"]').getAttribute('data-tab')==='calls','Next pick goes to Calls');
 const nextQ=await page.evaluate(()=>form.queueId);ok(nextQ&&nextQ!==CJ,'next pick loaded');
 await page.click('[data-tab="queue"]');
 ok(/1\s+of 30 audited/.test(await page.locator('#quest').innerText()),'week quest moves to 1 of 30');
 ok(await page.locator('.qcard:not(.qcases)',{hasText:'CJ Domingo'}).locator('.pips i.on').count()===1,'CJ card: one pip filled');
 // keyboard still scoped to the Scorecard
 const before=await page.evaluate(()=>JSON.stringify(form.scores));await page.keyboard.press('3');
 ok(await page.evaluate(()=>JSON.stringify(form.scores))===before,'score keys do nothing outside Calls');
 ok(!errors.length,'no console errors '+JSON.stringify(errors));
 await ctx.close();await b.close();console.log('ui game: '+n+' checks passed')})().catch(e=>{console.error('TEST FAILED',e);process.exit(1)});
