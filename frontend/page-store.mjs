import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {normalizeForm} from './domain.mjs';

export class PageStore {
 constructor(file){this.file=file;this.pages=[];if(fs.existsSync(file)){const data=JSON.parse(fs.readFileSync(file,'utf8'));if(data.version!==1||!Array.isArray(data.pages))throw Error('Unsupported page database.');this.pages=data.pages;}}
 list(){return this.pages.map(page=>({...page})).reverse();}
 get(id){const page=this.pages.find(p=>p.id===id);return page?{...page}:null;}
 create(input){
  if(!input||typeof input.title!=='string'||!input.title.trim())throw Error('Give this form page a title.');
  const title=input.title.trim();if(title.length>100)throw Error('Keep the title to 100 characters or fewer.');
  const purpose=typeof input.purpose==='string'?input.purpose.trim():'';if(purpose.length>500)throw Error('Keep the introduction to 500 characters or fewer.');
  const formUrl=normalizeForm(typeof input.formUrl==='string'?input.formUrl:'');if(!formUrl)throw Error('Attach the new Google Form’s published respondent link first.');
  const existing=this.pages.find(p=>p.formUrl===formUrl);if(existing)return {page:{...existing},created:false};
  if(this.pages.length>=500)throw Error('This local workspace has reached its 500-page limit.');
  const slug=title.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,48).replace(/-$/,'')||'meeting';
  const id=slug+'-'+crypto.randomBytes(8).toString('hex');
  const page={id,title,purpose,formUrl,path:'/forms/'+id,createdAt:new Date().toISOString()};
  const next=[...this.pages,page];fs.mkdirSync(path.dirname(this.file),{recursive:true});
  const temp=this.file+'.tmp';fs.writeFileSync(temp,JSON.stringify({version:1,pages:next},null,2),{mode:0o600});fs.renameSync(temp,this.file);this.pages=next;
  return {page:{...page},created:true};
 }
}
