const {chromium}=require('/home/claude/contextualize-swift-coach/node_modules/playwright');const fs=require('fs'),path=require('path');
const MOCK=([seed])=>{const data={},L=[];seed.forEach(([p,d])=>data[p]=d);
 const snap=p=>{const n=p.split('/').length;const docs=Object.keys(data).filter(k=>k.startsWith(p+'/')&&k.split('/').length===n+1).map(k=>({id:k.split('/').pop(),exists:true,data:()=>JSON.parse(JSON.stringify(data[k]))}));return {docs,size:docs.length,empty:!docs.length,forEach:f=>docs.forEach(f)}};
 const fire=()=>L.forEach(([p,f,isDoc])=>setTimeout(()=>f(isDoc?dsnap(p):snap(p)),0));
 const dsnap=p=>({id:p.split('/').pop(),exists:p in data,data:()=>data[p]?JSON.parse(JSON.stringify(data[p])):undefined});
 const col=p=>{const q={where:()=>q,orderBy:()=>q,limit:()=>q,startAfter:()=>q,get:async()=>snap(p),onSnapshot:(f)=>{L.push([p,f]);setTimeout(()=>f(snap(p)),0);return()=>{}},doc:id=>doc(p+'/'+id),add:async d=>{const id='x'+Math.random().toString(36).slice(2);data[p+'/'+id]=d;fire();return doc(p+'/'+id)}};return q};
 const doc=p=>({id:p.split('/').pop(),get:async()=>dsnap(p),set:async d=>{data[p]=JSON.parse(JSON.stringify(d));fire()},update:async d=>{data[p]=Object.assign({},data[p]||{},JSON.parse(JSON.stringify(d)));fire()},delete:async()=>{delete data[p];fire()},onSnapshot:f=>{L.push([p,f,1]);setTimeout(()=>f(dsnap(p)),0);return()=>{}},collection:c=>col(p+'/'+c)});
 const db={collection:col,doc,batch:()=>{const ops=[];const b={set:(r,d)=>(ops.push(()=>r.set(d)),b),update:(r,d)=>(ops.push(()=>r.update(d)),b),delete:r=>(ops.push(()=>r.delete()),b),commit:async()=>{for(const o of ops)await o()}};return b},runTransaction:async f=>f({get:r=>r.get(),set:(r,d)=>r.set(d),update:(r,d)=>r.update(d)})};
 const user={isOwner:()=>true,canEdit:()=>true,can:()=>true,id:async()=>'u_test',me:async()=>({id:'u_test',name:'Pat'}),profiles:async ids=>Object.fromEntries(ids.map(i=>[i,{name:'Pat'}])),search:async()=>[]};
 window.__db=db;window.claude={use:async n=>({db,user})[n]??null}};const LD=0,TASKS=0,TX=0;
const S='/tmp/claude-0/-home-claude/1b142488-5d26-5ec4-ac9b-9c6af59eb289/scratchpad';
const SKEL='<!doctype html><html><head><meta charset=utf8><meta name=viewport content="width=device-width,initial-scale=1"><style>body{margin:0}[hidden]{display:none!important}</style></head><body>\n';
const html=SKEL+fs.readFileSync(S+'/desk.html','utf8')+'\n</body></html>';
const ids=['08a3346c','16c8afe1','1964b0c7','2ab1df7f','92cdd373','f17315e7'];
const seed=ids.map(k=>{const d=JSON.parse(fs.readFileSync(S+'/sr/out_'+k+'.json','utf8'));return ['srAudits/'+d.id,d]});
const {t0,ev}=JSON.parse(fs.readFileSync('ev.json','utf8'));
// fake audio: 8 kHz tone bursts for one clip, base64 Int16
const sr=8000,mk=(s,e)=>{const n=Math.round((e-s)*sr),b=Buffer.alloc(n*2);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i/sr*2*Math.PI*220)*((i/sr)%1<.5?6000:0)),i*2);return b.toString('base64')};
const bundle={kind:'srMedia',v:1,callId:'08a3346c-e6e3-4f2a-af93-f71dffdb4ee6',sr,audioStart:ev[0].timestamp-1000,t0:ev[0].timestamp,clips:[{s:2,e:12,pcm:mk(2,12)}],events:ev};
const ok=(c,m)=>{console.log((c?'ok   ':'FAIL ')+m);if(!c)process.exitCode=1};
(async()=>{const b=await chromium.launch({args:['--autoplay-policy=no-user-gesture-required']});
 for(const vp of [{width:1280,height:900},{width:390,height:844}]){
 const ctx=await b.newContext({viewport:vp}),page=await ctx.newPage(),errors=[];
 page.on('console',m=>{if(m.type()==='error'&&!/fonts|ERR_FAILED|sandboxed/.test(m.text()))errors.push(m.text())});page.on('pageerror',e=>errors.push('PAGEERROR '+e.message));
 await page.route('**/*',r=>r.request().url().startsWith('http://qa.test/')?r.fulfill({contentType:'text/html',body:html}):r.abort());
 await page.addInitScript(MOCK,[seed,LD,{},{tasks:TASKS,tx:TX,aiReply:null}]);
 await page.addInitScript(()=>{const blobs={};const wrap=()=>{const c=window.claude;if(!c||c.__w)return;const u=c.use;c.use=async n=>n==='assets'?{upload:async bl=>{const id='a'.repeat(32);return {id,url:URL.createObjectURL(bl),sizeBytes:bl.size,contentType:bl.type}},list:async()=>({assets:[]})}:u(n);c.__w=1};const iv=setInterval(wrap,1);setTimeout(()=>clearInterval(iv),3000)});
 await page.goto('http://qa.test/#sr');await page.waitForTimeout(1500);
 await page.evaluate(()=>{const b=document.querySelector('[data-tab="sr"]');b&&b.click()});await page.waitForTimeout(600);
 ok(await page.locator('#srPlay').count()===1,vp.width+': player renders');
 const pins=await page.locator('#srPlay .srpin').count();ok(pins===8,vp.width+': 8 moment icons on Angel ('+pins+')');
 console.log('   kinds:',await page.evaluate(()=>[...document.querySelectorAll('#srPlay .srpin')].map(p=>[...p.classList].find(c=>c.startsWith('k-'))+'/'+[...p.classList].find(c=>c.startsWith('t-'))).join(' ')));
 await page.screenshot({path:S+'/sr/t/p_'+vp.width+'_a.png',fullPage:false});
 // click a pin -> seeks & plays (highlights on: clip around it)
 await page.locator('#srPlay .srpin').nth(2).click();await page.waitForTimeout(1200);
 const st=await page.evaluate(()=>({t:srP.t,pl:srP.playing,now:document.querySelector('#srNow').innerText.slice(0,120)}));
 ok(st.pl&&st.t>140&&st.t<160,vp.width+': pin at 2:27 plays from its clip (t='+st.t.toFixed(1)+')');console.log('   now:',st.now.replace(/\n/g,' | '));
 await page.screenshot({path:S+'/sr/t/p_'+vp.width+'_b.png'});
 // auto-skip: jump to end of a clip and see it hop to the next
 await page.evaluate(()=>{const d=srDoc(),cl=srClips(d);srSeek(cl[1].e-0.3,false)});await page.waitForTimeout(700);
 const sk=await page.evaluate(()=>{const cl=srClips(srDoc());return {t:srP.t,next:cl[2].s}});ok(sk.t>=sk.next&&sk.t<sk.next+3,vp.width+': highlights only skips the gap ('+sk.t.toFixed(1)+' vs next '+sk.next+')');
 await page.click('#srPP');ok(!(await page.evaluate(()=>srP.playing)),vp.width+': pause');
 // click on the curve seeks
 await page.locator('#srPlay [data-srbar]').scrollIntoViewIfNeeded();const bx=await page.locator('#srPlay [data-srbar]').boundingBox();await page.mouse.click(bx.x+bx.width*0.5,bx.y+bx.height/2);await page.waitForTimeout(150);
 const half=await page.evaluate(()=>srP.t/srDur(srDoc()));ok(Math.abs(half-.5)<.02,vp.width+': curve click seeks to the middle');
 // left log, coaching, no stats, no import tools by default
 const ui=await page.evaluate(()=>({moms:document.querySelectorAll('#view-sr .srmoms li').length,coach:document.querySelectorAll('#view-sr .srcoach .srcl li').length,stats:!!document.querySelector('#view-sr .srstats'),imp:!!document.querySelector('#view-sr .srimp'),board:!!document.querySelector('#view-sr .srboard')}));
 ok(ui.moms>0&&ui.coach>0&&!ui.stats&&!ui.imp&&!ui.board,vp.width+': moments log + swift coaching, no stats/import/board '+JSON.stringify(ui));
 await page.evaluate(()=>{const b=document.querySelector('#view-sr .srcoach [data-srlog]');b.scrollIntoView();b.click()});await page.waitForTimeout(500);
 ok(await page.evaluate(()=>srP.playing),vp.width+': coaching timestamp plays');
 await page.screenshot({path:S+'/sr/t/p_'+vp.width+'_log.png'});
 await page.click('#srPP');
 if(vp.width>1000){
 // paste a recording bundle
 
 await page.evaluate(t=>{const dt=new DataTransfer();dt.setData('text/plain',t);document.querySelector('#view-sr .srmain').dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}))},JSON.stringify({kind:'srMediaZ',callId:bundle.callId,clips:bundle.clips.map(c=>({s:c.s,e:c.e})),z:require('zlib').gzipSync(JSON.stringify(bundle)).toString('base64')}));
 await page.waitForTimeout(800);console.log('   paste msg:',await page.textContent('#toast'));
 await page.evaluate(()=>document.activeElement.blur());await page.evaluate(()=>renderSR());await page.waitForTimeout(1200);
 const m=await page.evaluate(()=>({media:!!srDoc().media,ready:srP.media&&srP.media.ready,err:srP.media&&srP.media.err,rep:!!document.querySelector('#srRep iframe'),clips:srClips(srDoc()).length}));
 await page.evaluate(()=>{srP.hl=true;srSeek(0,false)});ok(m.media&&m.ready&&m.rep&&m.clips===1,'recording loads: replay iframe + 1 clip '+JSON.stringify(m));
 const dbg=()=>page.evaluate(()=>{const M=srP.media,f=M&&M.rep&&M.rep.iframe;return {conn:f&&f.isConnected,inStage:f&&!!f.closest('#srStage'),len:f&&f.contentDocument&&f.contentDocument.documentElement?f.contentDocument.documentElement.outerHTML.length:-1,repNodes:document.querySelectorAll('#srRep').length,same:document.querySelector('#srRep')===M.node}});
 console.log('   dbg0',JSON.stringify(await dbg()));await page.click('#srPP');await page.waitForTimeout(1500);console.log('   dbg1',JSON.stringify(await dbg()));await page.waitForTimeout(1500);
 await page.evaluate(()=>renderSR());await page.waitForTimeout(500);const r=await page.evaluate(()=>({t:srP.t,src:!!(srP.media&&srP.media.src),h:document.querySelector('#srRep iframe').contentDocument.body.innerText.slice(0,60)}));
 ok(r.t>4&&r.src,'plays audio clip and replay ('+r.t.toFixed(1)+')');console.log('   replay text:',r.h.replace(/\n/g,' | '));
 await page.screenshot({path:S+'/sr/t/p_rec.png'});
 await page.waitForTimeout(8000);ok(!(await page.evaluate(()=>srP.playing)),'stops at the end of the last clip');
 }
 ok(errors.length===0,vp.width+': no errors '+errors.slice(0,3).join(' / '));await ctx.close()}
 await b.close()})();
