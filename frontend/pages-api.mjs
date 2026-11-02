// Website-side registration hook. The Google add-on integration supplies the
// newly created respondent URL; the local host workspace supplies authorization.
export class PagesAPI{
 constructor(){this.token=null;}
 async request(path,options={},host=false){
  if(host&&!this.token){const session=await fetch('/api/host/session');if(!session.ok)throw Error('Could not open the host workspace.');this.token=(await session.json()).token;}
  const headers={...(options.body?{'Content-Type':'application/json'}:{}),...(host?{'X-CommonTime-Host':this.token}:{}),...options.headers};
  const response=await fetch(path,{...options,headers});const result=await response.json();
  if(response.status===401&&host){this.token=null;throw Error('The workspace restarted. Please try that action again.');}
  if(!response.ok)throw Error(result.error||'The CommonTime request failed.');return result;
 }
 async list(){return (await this.request('/api/host/pages',{},true)).pages;}
 async create(data){return this.request('/api/host/pages',{method:'POST',body:JSON.stringify(data)},true);}
 async get(id){return (await this.request('/api/pages/'+encodeURIComponent(id))).page;}
}
export const pagesAPI=new PagesAPI();
export async function registerCreatedGoogleForm(result){
 if(!result||!(result.respondentUrl||result.formUrl))throw Error('Google form creation must return its published respondent URL first.');
 return pagesAPI.create({title:result.title,purpose:result.description||result.purpose||'',formUrl:result.respondentUrl||result.formUrl});
}
