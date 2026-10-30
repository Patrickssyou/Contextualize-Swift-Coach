// node pct.js in.json out.json : [{id, scores, kind}] -> [{id,pct,verdict}]
const {chromium}=require('/home/claude/contextualize-swift-coach/node_modules/playwright');const fs=require('fs');
const S='/tmp/claude-0/-home-claude/1b142488-5d26-5ec4-ac9b-9c6af59eb289/scratchpad';
const src=fs.readFileSync(__dirname+'/test_sr.js','utf8');const MOCK=eval("("+src.slice(src.indexOf('const MOCK='),src.indexOf('const LD=0')).replace(/^const MOCK=/,"").replace(/;\s*$/,"")+")");
const html='<!doctype html><html><head><meta charset=utf8></head><body>'+fs.readFileSync(S+'/desk.html','utf8')+'</body></html>';
(async()=>{const b=await chromium.launch(),page=await b.newPage();
 await page.route('**/*',r=>r.request().url().startsWith('http://qa.test/')?r.fulfill({contentType:'text/html',body:html}):r.abort());
 await page.addInitScript(MOCK,[[]]);await page.goto('http://qa.test/#calib');await page.waitForTimeout(1000);
 const L=JSON.parse(fs.readFileSync(process.argv[2]));
 const out=await page.evaluate(L=>L.map(x=>{const t=scGenT("call",x.scores,x.kind==="CL"?"call":"mgr"),m=scMapMarks("call",x.scores,t).marks,R=scRubric("call",t),pct=scPct(R,m),v=callVerdict(pct,scItems(R));return {id:x.id,pct:pct==null?null:Math.round(pct*10)/10,verdict:v&&v.id}}),L);
 fs.writeFileSync(process.argv[3],JSON.stringify(out));console.log(JSON.stringify(out.slice(0,3)));await b.close()})();
