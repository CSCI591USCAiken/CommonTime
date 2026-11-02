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
