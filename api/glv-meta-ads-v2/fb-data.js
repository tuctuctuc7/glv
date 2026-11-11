'use strict';
const {boundedTransport}=require('../../lib/glv-mad-v2-cache.cjs');
const {resolveRedisConfig}=require('../glv-meta-ads/fb-data.js')._test;
function authorized(req){const expected=process.env.GLV_META_BETA_AUTH_TOKEN;return Boolean(expected&&String(req.headers?.cookie||'').split(';').some(part=>{const [k,...v]=part.trim().split('=');return k==='glv_meta_beta'&&v.join('=')===expected;}));}
async function readCache(key){
 const config=resolveRedisConfig();if(!config)return null;
 try{const response=await boundedTransport(fetch,Date.now()+5000)(`${config.url}/get/${encodeURIComponent(key)}`,{headers:{Authorization:`Bearer ${config.token}`},signal:AbortSignal.timeout(5000)});if(!response.ok)return null;const body=await response.json();return body.result?require('../../lib/glv-mad-v2-storage.cjs').decode(body.result):null;}catch{return null;}
}
async function handler(req,res){
 if(require('../../lib/glv-mad-v2.cjs').rolloutEnabled())return require('../../lib/glv-mad-shared-reader.cjs').handler(req,res,'v2');
 res.setHeader('Cache-Control','private, no-store');
 if(!authorized(req))return res.status(401).json({error:'Unauthorized'});
 if(req.method!=='GET')return res.status(405).json({error:'Read-only API'});
 try{require('../../lib/glv-mad-shared-reader.cjs').scope(req.query||{});}catch{return res.status(400).json({error:'Invalid shared scope'});}
 return res.status(503).json({complete:false,error:'V2 rollout is disabled'});
}
module.exports=handler;
module.exports._test={authorized,readCache};
