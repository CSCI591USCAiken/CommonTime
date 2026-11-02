import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {PageStore} from './page-store.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const allowed=new Set(['organizer.html','client.html','forms.html','studio.css','domain.mjs','organizer.mjs','client.mjs','forms.mjs','pages-api.mjs']);
export function createServer({dataFile=path.join(root,'.commontime','pages.json')}={}){
 const store=new PageStore(dataFile),hostToken=crypto.randomBytes(32).toString('hex');
 function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
 return http.createServer(async(req,res)=>{
  let host;try{host=new URL('http://'+req.headers.host).hostname;}catch{json(res,400,{error:'Invalid workspace address.'});return;}
  if(!['localhost','127.0.0.1','[::1]'].includes(host)){json(res,403,{error:'This development workspace accepts local addresses only.'});return;}
  let url,name;try{url=new URL(req.url,'http://localhost');name=decodeURIComponent(url.pathname);}catch{json(res,400,{error:'Invalid URL.'});return;}
  if(name.startsWith('/api/')){
   const origin=req.headers.origin;const expected='http://'+req.headers.host;
   if(origin&&origin!==expected){json(res,403,{error:'Use the CommonTime workspace on the same origin.'});return;}
   if(req.headers['sec-fetch-site']==='cross-site'){json(res,403,{error:'Cross-site workspace requests are not allowed.'});return;}
   if(req.method==='GET'&&name==='/api/host/session'){json(res,200,{token:hostToken,workspace:'local',googleConnected:false});return;}
   if(req.method==='GET'&&name.startsWith('/api/pages/')){
    const page=store.get(name.slice('/api/pages/'.length));json(res,page?200:404,page?{page}:{error:'This CommonTime page was not found.'});return;
   }
   if(name==='/api/host/pages'){
    if(req.headers['x-commontime-host']!==hostToken){json(res,401,{error:'Reopen the host workspace to manage form pages.'});return;}
    if(req.method==='GET'){json(res,200,{pages:store.list()});return;}
    if(req.method==='POST'){
     if(!(req.headers['content-type']||'').startsWith('application/json')){json(res,415,{error:'Expected a JSON form-page request.'});return;}
     let body='',tooLarge=false;try{for await(const chunk of req){body+=chunk.toString('utf8');if(Buffer.byteLength(body)>16384){tooLarge=true;break;}}if(tooLarge){json(res,413,{error:'The form-page request is too large.'});return;}const result=store.create(JSON.parse(body));json(res,result.created?201:200,result);}catch(error){json(res,400,{error:error instanceof SyntaxError?'Invalid form-page request.':error.message});}return;
    }
   }
   json(res,404,{error:'API route not found.'});return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end('Method not allowed');return;}
  if(/^\/forms\/[a-z0-9-]+$/.test(name))name='/forms.html';
  const file=name==='/'?'organizer.html':name.slice(1);
  if(!allowed.has(file)){res.writeHead(404);res.end('Not found');return;}
  fs.readFile(path.join(root,file),(error,body)=>{if(error){res.writeHead(404);res.end('Not found');return;}const type={'.html':'text/html','.css':'text/css','.mjs':'text/javascript'}[path.extname(file)];res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'});res.end(req.method==='HEAD'?undefined:body);});
 });
}
export function startServer(){const port=Number(process.env.COMMONTIME_PREVIEW_PORT||4175);const server=createServer({dataFile:process.env.COMMONTIME_PAGE_DATA||path.join(root,'.commontime','pages.json')});server.listen(port,'127.0.0.1',()=>console.log('CommonTime workspace: http://127.0.0.1:'+port+'/organizer.html'));return server;}
