// records a small fake order screen with rrweb (no real data) to stand in for a GreenDot recording
const {chromium}=require('/home/claude/contextualize-swift-coach/node_modules/playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch(),p=await b.newPage({viewport:{width:1280,height:720}});
await p.setContent(`<html><body style="font-family:sans-serif;margin:0"><div style="display:flex;height:100vh"><nav style="width:220px;background:#223;color:#fff;padding:16px">Orders<br>Restaurants</nav><main style="padding:20px;flex:1"><h1 id=h>Order list</h1><button id=b>Open order C100</button><div id=o></div><input id=i placeholder="Order remark" style="width:400px"></main></div></body></html>`);
await p.addScriptTag({path:'/tmp/claude-0/-home-claude/1b142488-5d26-5ec4-ac9b-9c6af59eb289/scratchpad/rr/node_modules/rrweb/dist/rrweb.umd.min.cjs'});
await p.evaluate(()=>{window.__ev=[];rrweb.record({emit:e=>window.__ev.push(e)})});
const t0=Date.now();
for(let k=0;k<40;k++){await p.mouse.move(100+k*20,200+(k%5)*30);await p.waitForTimeout(250);
 if(k===8)await p.click('#b');if(k===9)await p.evaluate(()=>{document.getElementById('o').innerHTML='<h2>Order C100</h2><p>Large pepperoni · $18.00</p><p>Status: delivered</p>';document.getElementById('h').textContent='Order C100'});
 if(k===20){await p.click('#i');await p.keyboard.type('Comped reorder',{delay:60})}
 if(k===30)await p.evaluate(()=>{document.getElementById('o').innerHTML+='<p style="color:green">Reorder created</p>'})}
const ev=await p.evaluate(()=>window.__ev);fs.writeFileSync('ev.json',JSON.stringify({t0,ev}));console.log(ev.length,'events',JSON.stringify(ev).length,'bytes');await b.close()})();
