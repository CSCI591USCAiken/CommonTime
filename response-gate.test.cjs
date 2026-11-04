const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const values=new Map(),effects=[],rows={},forms={},store={getProperty:k=>values.get(k)||null,setProperty:(k,v)=>values.set(k,v),deleteProperty:k=>values.delete(k)};
const c=vm.createContext({PropertiesService:{getScriptProperties:()=>store,getDocumentProperties:()=>null},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},FormApp:{openById:id=>forms[id],getActiveForm:()=>forms.legacy},Logger:{log(){}}});
for(const file of ['code.js','website-sharing.js','response-gate.js'])vm.runInContext(fs.readFileSync(file,'utf8'),c);
const now=Date.now();let sequence=0;
function form(id){rows[id]=[];return forms[id]={getId:()=>id,getTitle:()=>id,getResponses:()=>rows[id]};}
function response(email,time=now+1000){const id=String(++sequence);return {getId:()=>id,getRespondentEmail:()=>email,getTimestamp:()=>new Date(time)};}
function configure(f,minimum){c.saveResponseGateSettings({formId:f.getId(),minimum});}
function submit(f,r){rows[f.getId()].push(r);c.onFormSubmit({source:f,response:r});}
function record(e){effects.push({form:e.source.getId(),email:e.response.getRespondentEmail(),context:c.CT_FORM_CONTEXT_});}
c.processFormSubmission_=record;
const a=form('managed-A'),b=form('managed-B'),legacy=form('legacy');
for(const f of [a,b])store.setProperty('CT_WEBSITE_FORM_'+f.getId(),'1');
configure(a,3);configure(b,2);
submit(a,response('one@example.com'));submit(a,response('ONE@example.com',now+2000));assert.equal(effects.length,0);
assert.equal(c.getResponseGateSettings(a.getId()).count,1);
submit(a,response('two@example.com'));assert.equal(effects.length,0);
assert.equal(c.withWebsiteForm_(a.getId(),c.responseGateCanSchedule_),false);
submit(b,response('other@example.com'));assert.equal(effects.length,0);
submit(a,response('three@example.com'));assert.equal(effects.length,3);assert(effects.every(e=>e.context===a.getId()));
assert.equal(c.getResponseGateSettings(a.getId()).released,true);assert.equal(c.getResponseGateSettings(b.getId()).released,false);
c.onFormSubmit({source:a,response:rows[a.getId()][3]});assert.equal(effects.length,3);
submit(a,response('four@example.com'));assert.equal(effects.length,4);
assert.throws(()=>configure(a,5),/already released/);
configure(b,1);assert.equal(effects.length,4);submit(b,response('next@example.com'));assert.equal(effects.length,6);
configure(legacy,2);submit(legacy,response('legacy1@example.com'));assert.equal(effects.length,6);submit(legacy,response('legacy2@example.com'));assert.equal(effects.length,8);
const historical=form('history');rows.history.push(response('old@example.com',now-100000));configure(historical,2);assert.equal(c.getResponseGateSettings('history').count,0);
assert.throws(()=>configure(historical,2.5));assert.throws(()=>configure(historical,0));assert.throws(()=>configure(historical,501));
const retry=form('retry');configure(retry,2);let failed=true;c.processFormSubmission_=e=>{if(e.response.getRespondentEmail()==='fail@example.com'&&failed)throw Error('Parse failed');record(e);};
submit(retry,response('good@example.com'));assert.throws(()=>submit(retry,response('fail@example.com')),/could not be scheduled/);const before=effects.length;failed=false;submit(retry,response('new@example.com'));assert.equal(effects.length,before+2);
let groupCalls=0;c.processQueuedGroupEvent_=()=>groupCalls++;
const group=form('group');store.setProperty('CT_WEBSITE_FORM_group','1');configure(group,2);store.setProperty('CT_GROUP_TRIGGER_wait','group');c.processQueuedGroupEvent({triggerUid:'wait'});assert.equal(groupCalls,0);
submit(group,response('g1@example.com'));submit(group,response('g2@example.com'));store.setProperty('CT_GROUP_TRIGGER_go','group');c.processQueuedGroupEvent({triggerUid:'go'});assert.equal(groupCalls,1);
console.log('Response gate checks passed: no actions below target, distinct people, release backlog, duplicates, later responses, separate forms, legacy forms, historical exclusion, validation, retry, and delayed group guard.');
