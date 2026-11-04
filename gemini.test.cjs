const fs=require('fs'),vm=require('vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('code.js','utf8');
const good={summary:'Planning',description:'Test',startTime:'2026-11-07T17:00:00Z',endTime:'2026-11-07T17:30:00Z'};
function harness(replies,props={gemini_api_key:'test-secret'}) {
 const values=new Map(Object.entries(props)),calls=[],sleeps=[];
 const c=vm.createContext({PropertiesService:{getScriptProperties:()=>({getProperty:k=>values.get(k)||null,setProperty:(k,v)=>values.set(k,v)})},Session:{getScriptTimeZone:()=> 'America/New_York'},Utilities:{sleep:ms=>sleeps.push(ms)},Logger:{log(){}},UrlFetchApp:{fetch:(url,options)=>{calls.push({url,options});const r=replies.shift(); if(!r)throw Error('Unexpected request');return {getResponseCode:()=>r.status||200,getContentText:()=>JSON.stringify(r.body||{candidates:[{finishReason:'STOP',content:{parts:[{thought:true,text:'private reasoning'},{text:JSON.stringify(r.parsed||good)}]}}]})};}}});
 vm.runInContext(source,c);return {c,calls,sleeps,values};
}
let h=harness([{}]);assert.equal(h.c.geminiParse('Friday at noon').summary,'Planning');
assert(!h.calls[0].url.includes('test-secret'));assert.equal(h.calls[0].options.headers['x-goog-api-key'],'test-secret');
const payload=JSON.parse(h.calls[0].options.payload);assert(payload.generationConfig.responseSchema.required.includes('startTime'));assert(payload.contents[0].parts[0].text.includes('America/New_York'));
h=harness([] ,{});assert.throws(()=>h.c.geminiParse('Friday'),/Missing/);assert.equal(h.calls.length,0);
h=harness([{status:403}]);assert.throws(()=>h.c.geminiParse('Friday'),/API key/);assert.equal(h.calls.length,1);
h=harness([{status:404},{}]);assert.equal(h.c.geminiParse('Friday').summary,'Planning');assert(h.calls[1].url.includes('gemini-3.8-flash'));
h=harness([{status:503},{}]);h.c.geminiParse('Friday');assert.equal(h.calls.length,2);assert.equal(h.sleeps.length,1);
h=harness(Array.from({length:6},()=>({status:429})));assert.throws(()=>h.c.geminiParse('Friday'),/quota/);assert.equal(h.calls.length,6);
for(const invalid of [null, {...good,startTime:'2026-11-07T17:00:00'}, {...good,endTime:good.startTime},{...good,summary:''}]) {
 h=harness(Array.from({length:6},()=>({body:{candidates:[{content:{parts:[{text:JSON.stringify(invalid)}]}}]}})));assert.throws(()=>h.c.geminiParse('Friday'),/usable meeting/);
}
h=harness([{body:{promptFeedback:{blockReason:'SAFETY'}}}]);assert.throws(()=>h.c.geminiParse('Friday'),/could not complete/);assert.equal(h.calls.length,1);
h=harness([]);h.c.geminiParse=input=>{const match=input.match(/(\d{4}-\d{2}-\d{2}T\S+) until (\S+)/);return {...good,startTime:match[1],endTime:match[2]};};assert.equal(h.c.testGeminiConnection().ok,true);
h.c.geminiParse=()=>({...good,startTime:"2000-01-01T00:00:00Z"});assert.throws(()=>h.c.testGeminiConnection(),/preserve/);
console.log('Gemini checks passed: schema, timezone, credentials, model failover, bounded retries, blocked/malformed answers, and side-effect-free connection check.');
