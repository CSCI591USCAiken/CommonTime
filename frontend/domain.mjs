export const SAMPLE_FORM='https://docs.google.com/forms/d/e/1FAIpQLSf59JOX8omkBsZxEjvzt8Jitqaen0rKoMUNG51zrUbcwPSBSg/viewform';
export const ZONES=['America/New_York','America/Chicago','America/Denver','America/Los_Angeles','Europe/London','UTC'];
export const SLOTS=['09:00','09:30','10:00','10:30','11:00','14:00'];
export function slotInstant(day,slot,zone){const wall=Date.parse(day+'T'+slot+':00Z');let guess=wall;for(let i=0;i<3;i++){const offset=new Intl.DateTimeFormat('en-US',{timeZone:zone,timeZoneName:'shortOffset'}).formatToParts(new Date(guess)).find(p=>p.type==='timeZoneName').value;const m=offset.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);guess=wall-(m?(m[1]==='-'?-1:1)*(Number(m[2])*60+Number(m[3]||0)):0)*60000;}return new Date(guess);}
export function normalizeForm(value){if(!value?.trim())return '';const u=new URL(value.trim());if(u.protocol!=='https:'||u.hostname!=='docs.google.com'||u.port||u.username||u.password||!/^\/forms\/d\/(?:e\/)?[\w-]+\/viewform\/?$/.test(u.pathname))throw Error('Use the full Google Forms respondent URL ending in /viewform.');u.search='';u.hash='';u.pathname=u.pathname.replace(/\/$/,'');return u.href;}
export function defaults(){const day=new Date();day.setDate(day.getDate()+7);return {id:'demo-commontime',title:'A little time together',purpose:'Project catch-up',template:'standard',duration:30,mode:'GROUP',days:14,timezone:'America/New_York',date:day.toLocaleDateString('en-CA'),calendar:'team',formUrl:SAMPLE_FORM};}
export function validateConfig(value){const c={...defaults()};if(!value||typeof value!=='object'||Array.isArray(value))throw Error('This meeting link is invalid.');for(const k of ['title','purpose'])if(typeof value[k]==='string')c[k]=value[k].trim().slice(0,k==='title'?100:500)||c[k];if(['standard','strict_availability','automatic'].includes(value.template))c.template=value.template;if([15,30,45,60].includes(Number(value.duration)))c.duration=Number(value.duration);if(['GROUP','SINGLE'].includes(value.mode))c.mode=value.mode;if([7,14,30].includes(Number(value.days)))c.days=Number(value.days);if(ZONES.includes(value.timezone))c.timezone=value.timezone;if(/^\d{4}-\d{2}-\d{2}$/.test(value.date||'')){const date=new Date(value.date+'T12:00:00Z');if(!isNaN(date)&&date.toISOString().slice(0,10)===value.date)c.date=value.date;}if(['personal','team'].includes(value.calendar))c.calendar=value.calendar;if(typeof value.formUrl==='string')c.formUrl=normalizeForm(value.formUrl);if(/^demo-[a-z0-9-]{1,40}$/.test(value.id||''))c.id=value.id;return c;}
export function publicConfig(c){const {id,title,purpose,template,duration,mode,timezone,date,formUrl}=validateConfig(c);return {id,title,purpose,template,duration,mode,timezone,date,formUrl};}
export function clientURL(c,base){const url=new URL('client.html',base);url.searchParams.set('meeting',JSON.stringify(publicConfig(c)));return url.href;}
export function participantURL(config,base){const form=normalizeForm(config.formUrl||'');if(!form)throw Error('Attach a published Google Form in Connections first.');const url=new URL('forms.html',base);url.searchParams.set('form',form);if(typeof config.title==='string'&&config.title.trim())url.searchParams.set('title',config.title.trim().slice(0,100));return url.href;}
export function readParticipant(search){const params=new URLSearchParams(search),formUrl=normalizeForm(params.get('form')||'');if(!formUrl)throw Error('Missing Google Form.');return {formUrl,title:(params.get('title')||'').trim().slice(0,100)};}
export function readMeeting(search){const raw=new URLSearchParams(search).get('meeting');return raw?validateConfig(JSON.parse(raw)):defaults();}
export function rankSlots(responses){const submitted=responses.filter(r=>Array.isArray(r.slots)&&r.slots.length);return SLOTS.map(slot=>({slot,count:submitted.filter(r=>r.slots.includes(slot)).length,total:submitted.length})).sort((a,b)=>b.count-a.count||a.slot.localeCompare(b.slot));}
export function sampleResponses(){return [{id:'sample-avery',name:'Avery Chen',slots:['09:00','09:30','10:00'],sample:true},{id:'sample-maya',name:'Maya Patel',slots:['09:30','10:00','11:00'],sample:true},{id:'sample-jordan',name:'Jordan Lee',slots:['09:30','14:00'],sample:true},{id:'sample-taylor',name:'Taylor Brooks',slots:[],sample:true}];}
export function sampleTemplate(prompt,c){if(!prompt.trim())throw Error('Describe the meeting first.');const minutes=prompt.match(/\b(15|30|45|60)\s*(?:-?\s*min|minutes)/i);return {...validateConfig(c),template:'automatic',duration:minutes?Number(minutes[1]):c.duration,purpose:prompt.trim().slice(0,500)};}
export class DemoAdapter{
 constructor(storage){this.storage=storage;this.memory=new Map();}
 read(key,fallback){try{let raw=this.memory.get(key);if(raw===undefined){try{raw=this.storage?.getItem(key);}catch{}}return raw?JSON.parse(raw):fallback;}catch{return fallback;}}
 write(key,value){const raw=JSON.stringify(value);this.memory.set(key,raw);try{this.storage?.setItem(key,raw);return true;}catch{return false;}}
 async getCalendars(){return [{id:'personal',name:'Personal calendar',access:'Owner',sample:true},{id:'team',name:'CommonTime team calendar',access:'Can edit events',sample:true}];}
 async getConfig(){try{return validateConfig(this.read('ct.frontend.config',defaults()));}catch{return defaults();}}
 async saveConfig(config){const c=validateConfig(config);return {config:c,persistent:this.write('ct.frontend.config',c)};}
 async generateTemplate(prompt,config){return sampleTemplate(prompt,config);}
 async getResponses(id){const rows=this.read('ct.frontend.responses.'+id,sampleResponses());return Array.isArray(rows)?rows.filter(r=>r&&typeof r.name==='string'&&Array.isArray(r.slots)).map(r=>({...r,name:r.name.slice(0,80),slots:r.slots.filter(s=>SLOTS.includes(s))})):sampleResponses();}
 async submitAvailability(config,name,slots){if(!name.trim())throw Error('Enter a name for this demo response.');if(!slots.length||slots.some(s=>!SLOTS.includes(s)))throw Error('Choose at least one available time.');const rows=await this.getResponses(config.id);rows.push({id:'demo-'+Date.now(),name:name.trim().slice(0,80),slots:[...new Set(slots)],sample:false});const persistent=this.write('ct.frontend.responses.'+config.id,rows);return {demo:true,persistent};}
 async createBooking(config,slot){
  if(!SLOTS.includes(slot))throw Error('Choose a valid slot.');
  const responses=await this.getResponses(config.id),rank=rankSlots(responses).find(r=>r.slot===slot);
  if(!rank?.count||(config.mode==='GROUP'&&rank.count!==rank.total))throw Error('A group meeting needs a time shared by every received response.');
  const event={demo:true,title:config.title,date:config.date,time:slot,duration:config.duration,timezone:config.timezone,calendar:config.calendar,participants:rank.count};
  if(config.mode==='SINGLE'){
   const minutes=s=>Number(s.slice(0,2))*60+Number(s.slice(3)),booked=[],pending=[];
   for(const response of responses.filter(r=>r.slots.length)){
    const chosen=[...response.slots].sort().find(s=>!booked.some(b=>minutes(s)<minutes(b.time)+config.duration&&minutes(s)+config.duration>minutes(b.time)));
    if(chosen)booked.push({name:response.name,time:chosen});else pending.push(response.name);
   }
   event.individualEvents=booked;event.pending=pending;event.participants=booked.length;
  }
  this.write('ct.frontend.booking.'+config.id,event);return event;
 }
 async getBooking(id){return this.read('ct.frontend.booking.'+id,null);}
 async reset(id){this.write('ct.frontend.responses.'+id,sampleResponses());this.write('ct.frontend.booking.'+id,null);}
}
export class LiveAdapter{async unavailable(){throw Error('Google integration is not connected. Your partner’s authorized backend and tester access are required.');}getConfig(){return this.unavailable();}saveConfig(){return this.unavailable();}getCalendars(){return this.unavailable();}generateTemplate(){return this.unavailable();}getResponses(){return this.unavailable();}submitAvailability(){return this.unavailable();}createBooking(){return this.unavailable();}getBooking(){return this.unavailable();}reset(){return this.unavailable();}}
