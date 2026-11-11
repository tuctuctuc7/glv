'use strict';
// Working keys are resumable extraction state, never a published report. Store
// immutable pieces first, then atomically replace one small manifest.
// Current/previous pieces remain durable; exact retired refs get reader grace.
const {createHash}=require('node:crypto');
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const TYPES=['daily','aggregate','ads'];
const GRACE_SECONDS=72*60*60;
async function publishBundle({key,pieces,validate,write,read,retire}){
 validate(pieces);
 // Exact candidates only: no keyspace scans and no synchronous deletion.
 let retired=[];
 if(read&&retire){try{const old=await read(`${key}:previous`);retired=TYPES.map(type=>old?.refs?.[type]).filter(Boolean);}catch{}}
 const refs={};
 try{
 for(const type of TYPES){
  const sha256=digest(pieces[type]),pieceKey=`${key}:piece:${type}:${sha256}`;
  refs[type]={key:pieceKey,sha256};await write(pieceKey,pieces[type]);
 }
 const manifest={version:1,range:pieces.daily.range,refs};
 if(read){
  let previous;
  try{previous=await readPublication({key,read,validate});}
  catch(error){
   // A fully validated replacement may repair malformed stored metadata. A
   // transport/budget failure is not proof of invalid history: abort instead.
   if(!(error instanceof SyntaxError)&&! /^(Invalid published|V2 cache storage invalid)/.test(error.message))throw error;
  }
  if(previous&&digest(previous.manifest)!==digest(manifest))await write(`${key}:previous`,previous.manifest);
 }
 await write(key,manifest);
 return manifest;
 }finally{
  // Includes partial/uncertain writes; retirement rechecks live references.
  // Maintenance failure cannot change a successful publication into a failure.
  if(retire)try{await retire({key,refs:[...retired,...Object.values(refs)]});}catch{}
 }
}
async function readPublication({key,read,validate}){
 let failure;
 for(const manifestKey of [key,`${key}:previous`]){
  try{
   const manifest=await read(manifestKey);
   if(!manifest)continue;
   if(manifest.version!==1||!manifest.refs)throw Error('Invalid published manifest');
   const pieces={};
   await Promise.all(TYPES.map(async type=>{
    const ref=manifest.refs[type];
    if(!ref||! /^[a-f0-9]{64}$/.test(ref.sha256)||ref.key!==`${key}:piece:${type}:${ref.sha256}`)throw Error('Invalid published reference');
    const piece=await read(ref.key);
    if(!piece||digest(piece)!==ref.sha256)throw Error('Invalid published digest');
    pieces[type]=piece;
   }));
   validate(pieces);
   if(JSON.stringify(manifest.range)!==JSON.stringify(pieces.daily.range))throw Error('Invalid published range');
   return {manifest,pieces};
  }catch(error){failure ||= error;}
 }
 if(failure)throw failure;
 return null;
}
async function readBundle(options){return (await readPublication(options))?.pieces||null;}
// The existing shared refresh owner serializes publishers. Compare both raw
// manifests atomically as an additional fence against a moved publication.
const RETIRE_SCRIPT=`
if (redis.call('GET',KEYS[1]) or '') ~= ARGV[1] or (redis.call('GET',KEYS[2]) or '') ~= ARGV[2] then return 0 end
for i=3,#KEYS do
 if redis.call('TTL',KEYS[i]) == -1 then redis.call('EXPIRE',KEYS[i],ARGV[3]) end
end
return 1`;
function retireRedis(redis,decode=JSON.parse){return async({key,refs})=>{
 const bytes=await Promise.all([key,`${key}:previous`].map(async k=>(await redis('GET',k)).result||''));
 const active=new Set();
 for(const raw of bytes){
  if(!raw)continue;
  const manifest=decode(raw);
  if(manifest?.version!==1||!manifest.refs)throw Error('Invalid retirement manifest');
  for(const type of TYPES){const ref=manifest.refs[type];if(!validRef(key,ref,type))throw Error('Invalid retirement reference');active.add(ref.key);}
 }
 const candidates=[...new Set(refs.filter(ref=>TYPES.some(type=>validRef(key,ref,type))&&!active.has(ref.key)).map(ref=>ref.key))];
 if(candidates.length)await redis('EVAL',RETIRE_SCRIPT,2+candidates.length,key,`${key}:previous`,...candidates,...bytes,GRACE_SECONDS);
};}
function validRef(key,ref,type){return Boolean(ref&&/^[a-f0-9]{64}$/.test(ref.sha256)&&ref.key===`${key}:piece:${type}:${ref.sha256}`);}
module.exports={retireRedis,GRACE_SECONDS,publishBundle,readBundle,digest,TYPES};
