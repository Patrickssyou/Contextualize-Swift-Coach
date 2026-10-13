const { chromium } = require('playwright'); const fs=require('fs'),path=require('path');
const { openPage } = require('./mock.js'); const SH=path.join(__dirname,'..','shots'); const log=(...a)=>console.log(...a);
const slack=JSON.parse(fs.readFileSync('data/fixtures/slack_w28.json','utf8'));
const ai={cj:JSON.parse(fs.readFileSync('data/gen2/cj.ai.json')),velka:JSON.parse(fs.readFileSync('data/gen2/velka.ai.json'))};
const seed=[['pulls/2026-09-28',{status:'done',week:'2026-09-28',at:'2026-10-05T19:33:25.065Z',added:30}]];
for(const f of fs.readdirSync('data/live4/queue')){const q=JSON.parse(fs.readFileSync('data/live4/queue/'+f));if(q.week!=='2026-09-28')continue;Object.assign(q,JSON.parse(fs.readFileSync('data/backfill2/'+f)));
  const id=f.replace('.json','');if(id==='ld-923fbe88-3aca-481b-82b0-b5e29bce7e19')q.aiFacts=ai.cj;if(['ld-246d9767-913b-42db-b426-9afd181bd13d','ld-233e17d2-cbf1-4207-ba6b-592cf62c1134'].includes(id))q.aiFacts=ai.velka;
  delete q.version;seed.push(['queue/'+id,q])}
(async()=>{const b=await chromium.launch();
 let {page,ctx,errors}=await openPage(b,seed,{},{width:1280,height:900},{slack});
 await page.goto('http://qa.test/#queue');await page.waitForTimeout(300);await page.click('#wkNext');await page.waitForTimeout(300);
 // CJ call
 await page.locator('.qcard:not(.qcases) .qitem',{hasText:'Bravo Pizza II'}).locator('[data-q]').first().click();await page.waitForTimeout(300);
 await page.locator('#chainPanel details.txd summary').first().click();await page.waitForTimeout(800);
 log('cj tx cards:',await page.locator('.txcall').count(),'| bullets:',await page.locator('.txsum li').count(),'| text loaded:',await page.locator('.txtext').first().innerText().then(t=>t.slice(0,60)));
 await page.locator('#chainWrap').screenshot({path:path.join(SH,'t1-cj-tx.png')});
 await page.click('[data-tab="facts"]');await page.click('#aiShow').catch(()=>{});await page.waitForTimeout(200);
 log('facts rows:',await page.locator('.flist .fact').count(),'promises:',await page.locator('.flist .promise').count(),'cites:',await page.locator('.cite').count());
 await page.locator('#aiPanel').screenshot({path:path.join(SH,'t2-cj-facts.png')});
 // Velka case
 await page.click('[data-tab="queue"]');await page.waitForTimeout(200);
 await page.locator('.qcases .qitem',{hasText:"Today's Pizza"}).locator('[data-q]').click();await page.waitForTimeout(300);
 log('opened tab:',await page.locator('[role=tab][aria-selected="true"]').getAttribute('data-tab'));
 await page.locator('#chainPanel details.txd summary').first().click();await page.waitForTimeout(800);log('velka tx cards:',await page.locator('.txcall').count(),'bullets',await page.locator('.txsum li').count());
 await page.locator('#chainWrap').screenshot({path:path.join(SH,'t3-velka-tx.png')});
 await page.click('[data-tab="facts"]');await page.click('#aiShow').catch(()=>{});await page.waitForTimeout(200);
 await page.locator('#aiPanel').screenshot({path:path.join(SH,'t4-velka-facts.png')});
 await page.click('[data-tab="calls"]');
 await page.emulateMedia({colorScheme:'dark'});await page.setViewportSize({width:390,height:860});await page.waitForTimeout(200);
 log('mobile width:',await page.evaluate(()=>document.documentElement.scrollWidth));
 await page.locator('#chainWrap').screenshot({path:path.join(SH,'t5-mobile.png')});
 log('errors',JSON.stringify(errors));await b.close()})().catch(e=>{console.error('FAIL',e);process.exit(1)});
