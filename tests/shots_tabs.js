// Screenshots of the four main tabs (Snapshot, Calls (top and rubric), Facts) at 1280x900 and 390x860, light and dark → shots/tabs-*.png
const { chromium } = require('playwright'); const fs=require('fs'),path=require('path');
const { openPage } = require('./mock.js'); const SH=path.join(__dirname,'..','shots');
const ai={cj:JSON.parse(fs.readFileSync('data/gen2/cj.ai.json'))};
const seed=[['pulls/2026-09-28',{status:'done',week:'2026-09-28',at:'2026-10-05T19:33:25.065Z',added:30}]];
for(const f of fs.readdirSync('data/live4/queue')){const q=JSON.parse(fs.readFileSync('data/live4/queue/'+f));if(q.week!=='2026-09-28')continue;Object.assign(q,JSON.parse(fs.readFileSync('data/backfill2/'+f)));
  const id=f.replace('.json','');if(id==='ld-923fbe88-3aca-481b-82b0-b5e29bce7e19')q.aiFacts=ai.cj;delete q.version;seed.push(['queue/'+id,q])}
(async()=>{const b=await chromium.launch();const widths=[];
 for(const [w,h] of [[1280,900],[390,860]])for(const scheme of ['light','dark']){
  const {page,ctx,errors}=await openPage(b,seed,{viewer:true},{width:w,height:h});await page.emulateMedia({colorScheme:scheme});
  await page.goto('http://qa.test/#queue');await page.waitForTimeout(300);await page.click('#wkNext');await page.waitForTimeout(300);
  const tag=`${w}-${scheme}`;
  await page.screenshot({path:path.join(SH,`tabs-1-snapshot-${tag}.png`)});widths.push(['snapshot',tag,await page.evaluate(()=>document.documentElement.scrollWidth)]);
  await page.locator('.qcard:not(.qcases) .qitem',{hasText:'Bravo Pizza II'}).locator('[data-q]').first().click();await page.waitForTimeout(300);
  await page.locator('details.txd').first().locator('summary').click();await page.waitForTimeout(500);await page.evaluate(()=>window.scrollTo(0,0));
  await page.screenshot({path:path.join(SH,`tabs-2-calls-${tag}.png`)});widths.push(['calls',tag,await page.evaluate(()=>document.documentElement.scrollWidth)]);
  await page.locator('#rubric').scrollIntoViewIfNeeded();await page.evaluate(()=>window.scrollBy(0,-120));await page.waitForTimeout(200);
  await page.screenshot({path:path.join(SH,`tabs-2-calls-rubric-${tag}.png`)});widths.push(['calls-rubric',tag,await page.evaluate(()=>document.documentElement.scrollWidth)]);
  await page.click('[data-tab="facts"]');await page.waitForTimeout(200);await page.click('#aiShow').catch(()=>{});await page.waitForTimeout(200);
  await page.screenshot({path:path.join(SH,`tabs-3-facts-${tag}.png`)});widths.push(['facts',tag,await page.evaluate(()=>document.documentElement.scrollWidth)]);
  if(errors.length)console.log('errors',tag,JSON.stringify(errors));await ctx.close()}
 console.log('scrollWidth:',JSON.stringify(widths));await b.close()})().catch(e=>{console.error('FAIL',e);process.exit(1)});
