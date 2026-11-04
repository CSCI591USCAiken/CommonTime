import {StaticPages} from './static-pages.mjs';
let storage;try{storage=globalThis.localStorage;}catch{}
export const pagesAPI=new StaticPages(storage);
export async function registerCreatedGoogleForm(result){
 if(!result||!(result.respondentUrl||result.formUrl))throw Error('Google form creation must return its published respondent URL first.');
 return pagesAPI.create({title:result.title,purpose:result.description||result.purpose||'',formUrl:result.respondentUrl||result.formUrl});
}
