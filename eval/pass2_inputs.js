const fs=require('fs'),C=require('../src/core.js');
for(const k of ['cj','velka']){const inp=JSON.parse(fs.readFileSync(`data/gen2/${k}.input.json`));
  const F=C.cleanFacts(JSON.parse(fs.readFileSync(`data/gen2/${k}.p1.out.json`)),inp.legs);
  fs.writeFileSync(`data/gen2/${k}.F.json`,JSON.stringify(F));fs.writeFileSync(`data/gen2/${k}.p2.txt`,C.analysisPrompt(inp,F));
  console.log('=== '+k);Object.entries(F.calls).forEach(([id,b])=>console.log(' call',inp.legs.findIndex(l=>l.id===id)+1,'\n   - '+b.join('\n   - ')));
  console.log(C.factLines(F))}
