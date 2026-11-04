import {normalizeForm} from './domain.mjs';
export class StaticPages {
 constructor(storage){this.storage=storage;this.key='commontime-public-form-pages-v1';}
 async list(){try{const rows=JSON.parse(this.storage.getItem(this.key)||'[]');if(!Array.isArray(rows))return [];return rows.filter(p=>p&&typeof p.title==='string'&&typeof p.formUrl==='string'&&typeof p.path==='string');}catch{return [];}}
 async create(data){
  const title=String(data.title||'').trim(),purpose=String(data.purpose||'').trim(),formUrl=normalizeForm(data.formUrl);
  if(!title||title.length>100)throw Error('Enter a title of up to 100 characters.');
  if(!formUrl)throw Error('Attach a published Google Form first.');
  if(purpose.length>500)throw Error('Keep the introduction to 500 characters.');
  const rows=await this.list(),prior=rows.find(p=>p.formUrl===formUrl);if(prior)return {created:false,page:prior};
  const query=new URLSearchParams({form:formUrl,title,purpose});
  const page={id:'form-'+Date.now()+'-'+Math.random().toString(36).slice(2),title,purpose,formUrl,path:'forms.html?'+query,createdAt:new Date().toISOString()};
  try{this.storage.setItem(this.key,JSON.stringify([page,...rows].slice(0,200)));}catch{throw Error('Browser storage is unavailable. Allow storage to save your form list.');}
  return {created:true,page};
 }
 async get(id){const page=(await this.list()).find(p=>p.id===id);if(!page)throw Error('This saved page is unavailable. Use its full participant link.');return page;}
}
