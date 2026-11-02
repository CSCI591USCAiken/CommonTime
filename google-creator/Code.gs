// Form-bound CommonTime. Dates and windows are explicit; no AI key required.
const CT={timezone:'America/New_York',minutes:30,dateTitle:'Meeting date (YYYY-MM-DD)',windowsTitle:'When are you available?',windows:['8:00–10:00 AM','10:00 AM–12:00 PM','12:00–2:00 PM','2:00–4:00 PM','4:00–6:00 PM','6:00–8:00 PM'],hours:[[8,10],[10,12],[12,14],[14,16],[16,18],[18,20]]};
function onOpen(){FormApp.getUi().createAddonMenu().addItem('Open CommonTime','showSidebar').addToUi();}
function showSidebar(){FormApp.getUi().showSidebar(HtmlService.createHtmlOutputFromFile('sidebar').setTitle('CommonTime'));}
function ctProps_(){return PropertiesService.getDocumentProperties();}
function getScheduleMode(){return ctProps_().getProperty('SCHEDULING_MODE')==='SINGLE'?'SINGLE':'GROUP';}
function setScheduleMode(mode){if(!['GROUP','SINGLE'].includes(mode))throw Error('Choose a meeting type.');ctProps_().setProperty('SCHEDULING_MODE',mode);}
function checkExistingTrigger(id){return ScriptApp.getUserTriggers(FormApp.getActiveForm()).some(t=>['commonTimeOnSubmit','onFormSubmit'].includes(t.getHandlerFunction())&&t.getTriggerSourceId()===id);}
function toggleTriggerOff(){const f=FormApp.getActiveForm();ScriptApp.getUserTriggers(f).forEach(t=>{if(['commonTimeOnSubmit','onFormSubmit'].includes(t.getHandlerFunction())&&t.getTriggerSourceId()===f.getId())ScriptApp.deleteTrigger(t);});}
function ctFieldsReady_(){
 const f=FormApp.getActiveForm(),p=ctProps_(),date=f.getItems().find(i=>String(i.getId())===p.getProperty('CT2_DATE_ITEM')),windows=f.getItems().find(i=>String(i.getId())===p.getProperty('CT2_WINDOWS_ITEM'));
 return !!(date&&windows&&date.getType()===FormApp.ItemType.TEXT&&windows.getType()===FormApp.ItemType.CHECKBOX&&date.asTextItem().isRequired()&&windows.asCheckboxItem().isRequired());
}
function toggleTriggerOn(){const f=FormApp.getActiveForm();if(!f.collectsEmail()||!ctFieldsReady_())throw Error('Run enableWebsiteScheduling to prepare the date, email, and time fields.');if(!checkExistingTrigger(f.getId()))ScriptApp.newTrigger('commonTimeOnSubmit').forForm(f).onFormSubmit().create();}
// Idempotent setup. Adds a required date, enables email collection and a trigger.
// Does not process old responses or create a calendar event.
function enableWebsiteScheduling(){
 const lock=LockService.getScriptLock();lock.waitLock(20000);
 try{
  const f=FormApp.getActiveForm(),p=ctProps_();
  let windows=f.getItems(FormApp.ItemType.CHECKBOX).find(i=>i.getTitle()===CT.windowsTitle);
  if(!windows)throw Error('Availability checkbox question missing.');windows=windows.asCheckboxItem();
  if(!CT.windows.every(w=>windows.getChoices().map(c=>c.getValue()).includes(w)))throw Error('Review changed time-window choices before enabling.');
  let date=f.getItems().find(i=>String(i.getId())===p.getProperty('CT2_DATE_ITEM'))||f.getItems(FormApp.ItemType.TEXT).find(i=>i.getTitle()===CT.dateTitle);
  date=date?date.asTextItem():f.addTextItem();
  date.setTitle(CT.dateTitle).setHelpText('Enter a future date, for example 2026-11-02. All time windows use Eastern time (America/New_York).').setRequired(true).setValidation(FormApp.createTextValidation().requireTextMatchesPattern('^[0-9]{4}-[0-9]{2}-[0-9]{2}$').setHelpText('Use YYYY-MM-DD, for example 2026-11-02.').build());
  windows.setRequired(true).showOtherOption(false).setHelpText('Select every window that works on your meeting date. Times are Eastern (America/New_York). CommonTime looks for a free 30-minute slot.');
  f.getItems(FormApp.ItemType.PARAGRAPH_TEXT).filter(i=>i.getTitle()==='Anything else about your availability?').forEach(i=>i.asParagraphTextItem().setHelpText('Notes for your organizer. Automated scheduling uses only your meeting date and selected windows; notes do not change the selected availability.'));
  if(date.getIndex()>windows.getIndex())f.moveItem(date.getIndex(),windows.getIndex());f.setCollectEmail(true);
  f.setDescription('Select your meeting date and all windows that work in Eastern time (America/New_York). CommonTime looks for a free 30-minute slot. Your email is used for the calendar invitation. Optional notes are for organizer review and do not change automated availability.');
  p.setProperties({'CT2_DATE_ITEM':String(date.getId()),'CT2_WINDOWS_ITEM':String(windows.getId()),'COMMONTIME_WEBSITE_URL':p.getProperty('COMMONTIME_WEBSITE_URL')||'http://127.0.0.1:4173/website.html'});
  f.setConfirmationMessage('Your availability is saved. CommonTime looks for a 30-minute slot in Eastern time that is also free on the organizer’s calendar. Group meetings require overlapping availability for the same date. If a slot is found, a Google Calendar invitation will follow. Otherwise the organizer will review your availability.');
  CalendarApp.getDefaultCalendar().getName();toggleTriggerOn();return verifyWebsiteScheduling();
 }finally{lock.releaseLock();}
}
function getSidebarState(){const f=FormApp.getActiveForm(),p=ctProps_();return {title:f.getTitle(),formUrl:f.getPublishedUrl(),editUrl:f.getEditUrl(),mode:getScheduleMode(),enabled:checkExistingTrigger(f.getId()),collectsEmail:f.collectsEmail(),schedulerReady:ctFieldsReady_(),timezone:CT.timezone,minutes:CT.minutes,websiteUrl:p.getProperty('COMMONTIME_WEBSITE_URL')||'',lastResult:p.getProperty('CT2_LAST_RESULT')||'No new response processed yet.'};}
function saveSidebarSettings(settings){
 if(!settings||!['GROUP','SINGLE'].includes(settings.mode))throw Error('Choose a meeting type.');const website=String(settings.websiteUrl||'').trim();
 if(website&&!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:[/?#][^\s]*)?$/i.test(website)&&!/^http:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:[/?#][^\s]*)?$/i.test(website))throw Error('Use an HTTPS website address, or localhost.');
 const lock=LockService.getScriptLock();lock.waitLock(10000);try{setScheduleMode(settings.mode);ctProps_().setProperty('COMMONTIME_WEBSITE_URL',website);return getSidebarState();}finally{lock.releaseLock();}
}
function setSidebarEnabled(enabled){if(typeof enabled!=='boolean')throw Error('Choose an automation state.');const lock=LockService.getScriptLock();lock.waitLock(10000);try{if(enabled)toggleTriggerOn();else toggleTriggerOff();return getSidebarState();}finally{lock.releaseLock();}}
function getSidebarSettings(){return getSidebarState();}
function getSidebarResponses(){return {total:FormApp.getActiveForm().getResponses().length};}
function ctParseResponse_(response){
 const p=ctProps_();let day='',windows=[];
 response.getItemResponses().forEach(r=>{const id=String(r.getItem().getId());if(id===p.getProperty('CT2_DATE_ITEM'))day=String(r.getResponse()).trim();if(id===p.getProperty('CT2_WINDOWS_ITEM'))windows=r.getResponse();});
 const email=String(response.getRespondentEmail()||'').trim().toLowerCase(),check=new Date(day+'T12:00:00Z');
 if(!email||!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Array.isArray(windows)||isNaN(check.getTime())||check.toISOString().slice(0,10)!==day)return null;
 const ranges=windows.map(w=>CT.windows.indexOf(w)).filter(i=>i>=0).map(i=>CT.hours[i]);if(!ranges.length)return null;
 return {email:email,day:day,ranges:ranges,responseId:response.getId(),submitted:response.getTimestamp().getTime()};
}
// IANA offset for the chosen date, including daylight saving time.
function ctInstant_(day,hour,minute){
 const wall=Date.parse(day+'T'+String(hour).padStart(2,'0')+':'+String(minute).padStart(2,'0')+':00Z');let guess=wall;
 for(let i=0;i<3;i++){const offset=Utilities.formatDate(new Date(guess),CT.timezone,'Z'),sign=offset[0]==='-'?-1:1,mins=sign*(Number(offset.slice(1,3))*60+Number(offset.slice(3,5)));guess=wall-mins*60000;}return new Date(guess);
}
function ctCandidates_(records,now){
 if(!records.length||records.some(r=>r.day!==records[0].day))return [];const result=[];
 for(let m=480;m+CT.minutes<=1200;m+=CT.minutes){if(!records.every(r=>r.ranges.some(range=>m>=range[0]*60&&m+CT.minutes<=range[1]*60)))continue;
  const start=ctInstant_(records[0].day,Math.floor(m/60),m%60),end=new Date(start.getTime()+CT.minutes*60000);if(start.getTime()>now.getTime())result.push({start:start,end:end});}
 return result;
}
function ctFindSlot_(records,calendar,event,now){
 const candidates=ctCandidates_(records,now);if(!candidates.length)return null;
 const busy=calendar.getEvents(candidates[0].start,candidates[candidates.length-1].end).filter(e=>(!event||e.getId()!==event.getId())&&e.getTransparency()!==CalendarApp.EventTransparency.TRANSPARENT);
 const available=s=>!busy.some(e=>e.getStartTime()<s.end&&e.getEndTime()>s.start);
 if(event){const stable=candidates.find(s=>s.start.getTime()===event.getStartTime().getTime());if(stable&&available(stable))return stable;}
 return candidates.find(available)||null;
}
function ctSchedule_(records,key,title){
 const p=ctProps_(),cal=CalendarApp.getDefaultCalendar(),id=p.getProperty(key),event=id?cal.getEventById(id):null;
 if(event&&event.getStartTime().getTime()<=Date.now())return 'Meeting already started; organizer review needed.';
 const slot=ctFindSlot_(records,cal,event,new Date());if(!slot)return 'No shared free slot found. No invitation created or changed; organizer review needed.';
 const emails=[...new Set(records.map(r=>r.email))];
 if(event){if(event.getStartTime().getTime()!==slot.start.getTime())event.setTime(slot.start,slot.end);const guests=event.getGuestList().map(g=>g.getEmail().toLowerCase());guests.filter(email=>!emails.includes(email)).forEach(email=>event.removeGuest(email));emails.filter(email=>!guests.includes(email)).forEach(email=>event.addGuest(email));}
 else{const created=cal.createEvent(title,slot.start,slot.end,{description:'Scheduled with CommonTime from explicit form availability. Time zone: '+CT.timezone+'.',guests:emails.join(','),sendInvites:true});p.setProperty(key,created.getId());}
 return 'Scheduled '+Utilities.formatDate(slot.start,CT.timezone,'yyyy-MM-dd HH:mm')+' Eastern · '+emails.length+' participant(s).';
}
function commonTimeOnSubmit(e){
 if(!e||!e.response||!e.source)throw Error('Run this function only from a form submission trigger.');
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 try{const incoming=ctParseResponse_(e.response);if(!incoming){ctProps_().setProperty('CT2_LAST_RESULT','Response needs a valid date, email, and time window; organizer review needed.');return;}
  const responses=e.source.getResponses(),newer=responses.map(ctParseResponse_).find(r=>r&&r.email===incoming.email&&r.submitted>incoming.submitted);
  if(newer)return;
  let records=[incoming];if(getScheduleMode()==='GROUP'){const latest={};responses.forEach(response=>{const r=ctParseResponse_(response);if(r&&r.day===incoming.day&&(!latest[r.email]||latest[r.email].submitted<=r.submitted))latest[r.email]=r;});latest[incoming.email]=incoming;records=Object.keys(latest).map(email=>latest[email]);}
  const key=getScheduleMode()==='GROUP'?'CT2_GROUP_'+incoming.day:'CT2_INDIVIDUAL_'+incoming.email;
  ctProps_().setProperty('CT2_LAST_RESULT',ctSchedule_(records,key,e.source.getTitle()+(getScheduleMode()==='GROUP'?' · Group meeting':' · Meeting')));
 }catch(error){ctProps_().setProperty('CT2_LAST_RESULT','Scheduling failed; organizer review needed. See Apps Script executions.');throw error;}finally{lock.releaseLock();}
}
function onFormSubmit(e){return commonTimeOnSubmit(e);}
function verifyWebsiteScheduling(){const s=getSidebarState();console.log(JSON.stringify({enabled:s.enabled,collectsEmail:s.collectsEmail,fieldsReady:s.schedulerReady,mode:s.mode,timezone:s.timezone,minutes:s.minutes,lastResult:s.lastResult}));return s;}
// Live read-only smoke check: no form submission, calendar event, or invitation.
function testWebsiteSchedulingReadOnly(){const day=Utilities.formatDate(new Date(Date.now()+7*86400000),CT.timezone,'yyyy-MM-dd');const slot=ctFindSlot_([{day:day,email:'test@example.invalid',ranges:CT.hours}],CalendarApp.getDefaultCalendar(),null,new Date());console.log(JSON.stringify({readOnly:true,dateConversionValid:!isNaN(ctInstant_(day,8,0).getTime()),calendarReadSucceeded:true,freeSlotFound:!!slot}));}

// Additional functions for our own CommonTime prototype. Existing CT2 code stays intact.
// Each created form has its own configuration and installable submit trigger.
var CTM_ZONES_=['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','UTC'];
var CTM_WINDOWS_=['9:00–11:00 AM','11:00 AM–1:00 PM','1:00–3:00 PM','3:00–5:00 PM'];
var CTM_RANGES_=[[9,11],[11,13],[13,15],[15,17]];
function CTM_listCalendars(){
 return {calendars:CalendarApp.getAllOwnedCalendars().map(function(c){return {id:c.getId(),name:c.getName(),primary:c.isMyPrimaryCalendar()};}),timezone:Session.getScriptTimeZone()};
}
function CTM_validate_(input){
 if(!input||typeof input.title!=='string'||!input.title.trim()||input.title.trim().length>100)throw Error('Enter a meeting title of up to 100 characters.');
 if(![15,30,45,60].includes(Number(input.minutes)))throw Error('Choose 15, 30, 45, or 60 minutes.');
 if(!['GROUP','SINGLE'].includes(input.mode))throw Error('Choose a scheduling mode.');
 if(!['standard','strict_availability'].includes(input.template))throw Error('Choose a form template.');
 if(![7,14,30].includes(Number(input.days)))throw Error('Choose a 7, 14, or 30-day window.');
 if(!CTM_ZONES_.includes(input.timezone))throw Error('Choose a supported time zone.');
 if(!/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId||''))throw Error('Reopen the creator and try again.');
 const calendar=CalendarApp.getAllOwnedCalendars().find(function(c){return c.getId()===input.calendarId;});
 if(!calendar)throw Error('Select a calendar you own, including a calendar you share with others.');
 return {version:1,title:input.title.trim(),purpose:String(input.purpose||'').trim().slice(0,500),minutes:Number(input.minutes),mode:input.mode,template:input.template,days:Number(input.days),timezone:input.timezone,calendarId:calendar.getId()};
}
function CTM_instant_(day,minutes,zone){
 const wall=Date.parse(day+'T'+String(Math.floor(minutes/60)).padStart(2,'0')+':'+String(minutes%60).padStart(2,'0')+':00Z');let guess=wall;
 for(let i=0;i<3;i++){const offset=Utilities.formatDate(new Date(guess),zone,'Z'),sign=offset[0]==='-'?-1:1;guess=wall-sign*(Number(offset.slice(1,3))*60+Number(offset.slice(3,5)))*60000;}return new Date(guess);
}
function CTM_dayPlus_(day,days){return new Date(Date.parse(day+'T12:00:00Z')+days*86400000).toISOString().slice(0,10);}
function CTM_openSlots_(config,calendar,now){
 const start=Utilities.formatDate(now,config.timezone,'yyyy-MM-dd'),last=CTM_dayPlus_(start,config.days);
 const busy=calendar.getEvents(CTM_instant_(start,0,config.timezone),CTM_instant_(last,0,config.timezone)).filter(function(e){return e.getTransparency()!==CalendarApp.EventTransparency.TRANSPARENT;});
 const slots=[];
 for(let dayIndex=0;dayIndex<config.days&&slots.length<32;dayIndex++){
  const day=CTM_dayPlus_(start,dayIndex),weekday=new Date(day+'T12:00:00Z').getUTCDay();if(weekday===0||weekday===6)continue;
  for(let m=540;m+config.minutes<=1020&&slots.length<32;m+=config.minutes){
   const s=CTM_instant_(day,m,config.timezone),end=new Date(s.getTime()+config.minutes*60000);
   if(s<=now||busy.some(function(e){return e.getStartTime()<end&&e.getEndTime()>s;}))continue;
   slots.push({label:Utilities.formatDate(s,config.timezone,'EEE, MMM d · h:mm a')+' – '+Utilities.formatDate(end,config.timezone,'h:mm a z'),start:s.toISOString()});
  }
 }return slots;
}
function CTM_createForm(input){
 const lock=LockService.getScriptLock();lock.waitLock(30000);
 try{
  const props=PropertiesService.getScriptProperties(),config=CTM_validate_(input),cacheKey='CTM_REQUEST_'+input.requestId,cached=props.getProperty(cacheKey);
  if(cached){const prior=JSON.parse(cached);if(prior.error)throw Error(prior.error);return prior;}
  const calendar=CalendarApp.getCalendarById(config.calendarId),now=new Date();
  config.firstDay=Utilities.formatDate(now,config.timezone,'yyyy-MM-dd');config.lastDay=CTM_dayPlus_(config.firstDay,config.days-1);
  if(config.template==='strict_availability'){config.slots=CTM_openSlots_(config,calendar,now);if(!config.slots.length)throw Error('No free weekday slots were found in this window. Choose a different calendar/window or the flexible template.');}
  let form;
  try{
   form=FormApp.create(config.title,false);config.formId=form.getId();
   form.setCollectEmail(true).setDescription((config.purpose?config.purpose+'\n\n':'')+'Share availability for a '+config.minutes+'-minute meeting. All times use '+config.timezone+'. '+(config.template==='strict_availability'?'Choose all listed times that work; up to 32 currently free weekday slots are shown.':'Choose a date from '+config.firstDay+' through '+config.lastDay+' and all windows that work. Group mode combines responses for the same date.')+' Notes are for organizer review and do not override selected availability.');
   form.addTextItem().setTitle('Your name').setRequired(true);
   if(config.template==='standard'){
    config.dateItem=String(form.addTextItem().setTitle('Meeting date (YYYY-MM-DD)').setHelpText('Use a date from '+config.firstDay+' through '+config.lastDay+'. Times are in '+config.timezone+'.').setRequired(true).setValidation(FormApp.createTextValidation().requireTextMatchesPattern('^[0-9]{4}-[0-9]{2}-[0-9]{2}$').setHelpText('Use YYYY-MM-DD.').build()).getId());
    config.availabilityItem=String(form.addCheckboxItem().setTitle('When are you available?').setHelpText('Select every window that works. CommonTime will look for a free '+config.minutes+'-minute slot.').setChoiceValues(CTM_WINDOWS_).setRequired(true).getId());
   }else{
    config.availabilityItem=String(form.addCheckboxItem().setTitle('Which meeting times work for you?').setHelpText('Select all that work. Times use '+config.timezone+'; calendar availability is checked again after submission.').setChoiceValues(config.slots.map(function(s){return s.label;})).setRequired(true).getId());
   }
   form.addParagraphTextItem().setTitle('Anything else?').setHelpText('Optional notes for your organizer. These notes do not change automatic availability.');
   form.setConfirmationMessage('Your availability has been received. CommonTime will look for a suitable free time on the organizer’s calendar. A Calendar invitation follows when a time is found; otherwise the organizer will review your response. Submitting alone is not a confirmed booking.');
   if(JSON.stringify(config).length>8000)throw Error('This form configuration is too large. Choose a shorter window.');
   props.setProperty('CTM_FORM_'+config.formId,JSON.stringify(config));
   ScriptApp.newTrigger('CTM_onSubmit').forForm(form).onFormSubmit().create();
   form.setPublished(true);form.setAcceptingResponses(true);
   const result={formId:config.formId,title:config.title,purpose:config.purpose,respondentUrl:form.getPublishedUrl(),editUrl:form.getEditUrl(),schedulingConnected:true};
   const website=props.getProperty('CTM_WEBSITE_URL')||'http://127.0.0.1:4175/organizer.html';
   if(!/^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[^\s?#]*)?$/i.test(website)&&!/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?\/organizer\.html$/i.test(website))throw Error('Configure CTM_WEBSITE_URL as the CommonTime organizer page.');
   result.continueUrl=website+'?created_form='+encodeURIComponent(result.respondentUrl)+'&created_title='+encodeURIComponent(result.title)+'&created_purpose='+encodeURIComponent(result.purpose)+'#pages';
   props.setProperty(cacheKey,JSON.stringify(result));return result;
  }catch(error){
   if(form){const message='A form draft was created, but setup did not finish. Review it at '+form.getEditUrl()+'. Details: '+error.message;props.setProperty(cacheKey,JSON.stringify({error:message}));throw Error(message);}throw error;
  }
 }finally{lock.releaseLock();}
}
function CTM_parse_(response,config){
 const email=String(response.getRespondentEmail()||'').trim().toLowerCase();if(!email)return null;
 let day='',selected=[];response.getItemResponses().forEach(function(r){const id=String(r.getItem().getId());if(id===config.dateItem)day=String(r.getResponse()).trim();if(id===config.availabilityItem)selected=r.getResponse();});
 if(!Array.isArray(selected)||!selected.length)return null;
 const record={email:email,submitted:response.getTimestamp().getTime()};
 if(config.template==='strict_availability'){
  const slots=selected.map(function(label){return config.slots.find(function(slot){return slot.label===label;});});if(slots.some(function(slot){return !slot;}))return null;record.slots=slots.map(function(slot){return slot.start;});
 }else{
  const parsed=new Date(day+'T12:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||isNaN(parsed.getTime())||parsed.toISOString().slice(0,10)!==day||day<config.firstDay||day>config.lastDay)return null;
  const indices=selected.map(function(label){return CTM_WINDOWS_.indexOf(label);});if(indices.some(function(i){return i<0;}))return null;record.day=day;record.ranges=indices.map(function(i){return CTM_RANGES_[i];});
 }return record;
}
function CTM_candidates_(records,config,now){
 if(!records.length)return [];
 if(config.template==='strict_availability')return config.slots.filter(function(slot){return records.every(function(r){return r.slots.includes(slot.start);});}).map(function(slot){const start=new Date(slot.start);return {start:start,end:new Date(start.getTime()+config.minutes*60000)};}).filter(function(s){return s.start>now;});
 if(records.some(function(r){return r.day!==records[0].day;}))return [];const slots=[];
 for(let m=540;m+config.minutes<=1020;m+=15){if(!records.every(function(r){return r.ranges.some(function(range){return m>=range[0]*60&&m+config.minutes<=range[1]*60;});}))continue;const start=CTM_instant_(records[0].day,m,config.timezone);if(start>now)slots.push({start:start,end:new Date(start.getTime()+config.minutes*60000)});}return slots;
}
function CTM_onSubmit(e){
 if(!e||!e.source||!e.response)throw Error('This handler runs from a form submission trigger.');
 const lock=LockService.getScriptLock();lock.waitLock(30000);const props=PropertiesService.getScriptProperties(),formId=e.source.getId();
 try{
  const raw=props.getProperty('CTM_FORM_'+formId);if(!raw)throw Error('No CommonTime configuration is registered for this form.');const config=JSON.parse(raw);config.title=e.source.getTitle();const incoming=CTM_parse_(e.response,config);if(!incoming){props.setProperty('CTM_STATUS_'+formId,'Response needs organizer review: missing or invalid date, email, or availability.');return;}
  const all=e.source.getResponses().map(function(r){return CTM_parse_(r,config);}).filter(Boolean);
  if(all.some(function(r){return r.email===incoming.email&&r.submitted>incoming.submitted;}))return;
  let records=[incoming];if(config.mode==='GROUP'){const latest={};all.forEach(function(r){if(config.template==='standard'&&r.day!==incoming.day)return;if(!latest[r.email]||r.submitted>=latest[r.email].submitted)latest[r.email]=r;});latest[incoming.email]=incoming;records=Object.keys(latest).map(function(email){return latest[email];});}
  const calendar=CalendarApp.getAllOwnedCalendars().find(function(c){return c.getId()===config.calendarId;});if(!calendar)throw Error('The host no longer owns the selected calendar.');
  const key='CTM_EVENT_'+formId+'_'+(config.mode==='GROUP'?(incoming.day||'group'):incoming.email),id=props.getProperty(key),event=id?calendar.getEventById(id):null,now=new Date();
  if(event&&event.getStartTime()<=now){props.setProperty('CTM_STATUS_'+formId,'Existing meeting has started; organizer review needed.');return;}
  const slots=CTM_candidates_(records,config,now);let chosen=null;
  if(slots.length){const busy=calendar.getEvents(slots[0].start,slots[slots.length-1].end).filter(function(item){return (!event||item.getId()!==event.getId())&&item.getTransparency()!==CalendarApp.EventTransparency.TRANSPARENT;});const free=function(s){return !busy.some(function(item){return item.getStartTime()<s.end&&item.getEndTime()>s.start;});};chosen=(event&&slots.find(function(s){return s.start.getTime()===event.getStartTime().getTime()&&free(s);}))||slots.find(free)||null;}
  if(!chosen){props.setProperty('CTM_STATUS_'+formId,'No common free time found. No event created or changed; organizer review needed.');return;}
  const emails=records.map(function(r){return r.email;});
  if(event){if(event.getStartTime().getTime()!==chosen.start.getTime())event.setTime(chosen.start,chosen.end);const guests=event.getGuestList().map(function(g){return g.getEmail().toLowerCase();});guests.filter(function(email){return !emails.includes(email);}).forEach(function(email){event.removeGuest(email);});emails.filter(function(email){return !guests.includes(email);}).forEach(function(email){event.addGuest(email);});}
  else{const created=calendar.createEvent(config.title,chosen.start,chosen.end,{description:'Scheduled with CommonTime. '+config.purpose,guests:emails.join(','),sendInvites:true});props.setProperty(key,created.getId());}
  props.setProperty('CTM_STATUS_'+formId,'Scheduled '+Utilities.formatDate(chosen.start,config.timezone,'yyyy-MM-dd HH:mm')+' '+config.timezone+'.');
 }catch(error){props.setProperty('CTM_STATUS_'+formId,'Scheduling failed; organizer review needed. '+error.message);throw error;}finally{lock.releaseLock();}
}
