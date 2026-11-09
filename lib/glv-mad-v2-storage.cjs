'use strict';
// Transport only. Generation manifests hash native JSON, receipts hash this wire
// string. Legacy JSON remains readable; business schemas stay with their readers.
const {gzipSync,gunzipSync}=require('node:zlib');
const {createHash}=require('node:crypto');
const {TextDecoder}=require('node:util');
const MAX_ENCODED_BYTES=4*1024*1024; // Leaves room for Redis REST command framing.
const MAX_RAW_BYTES=64*1024*1024; // Bounds both legacy JSON and inflation.
const MARKER='glv_mad_v2_storage';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const invalid=()=>new Error('V2 cache storage invalid');
const size=()=>new Error('V2 cache storage size limit');
function encode(payload){
 let raw;
 try{if(!object(payload)||Object.hasOwn(payload,MARKER))throw invalid();raw=Buffer.from(JSON.stringify(payload));}catch{throw invalid();}
 if(raw.length>MAX_RAW_BYTES)throw size();
 let data;try{data=gzipSync(raw).toString('base64');}catch{throw invalid();}
 const bytes=JSON.stringify({[MARKER]:true,version:1,encoding:'gzip+base64',raw_bytes:raw.length,sha256:hash(raw),data});
 if(Buffer.byteLength(bytes)>MAX_ENCODED_BYTES)throw size();
 return bytes;
}
function decode(bytes){
 if(typeof bytes!=='string')throw invalid();
 if(Buffer.byteLength(bytes)>MAX_RAW_BYTES)throw size();
 let envelope;try{envelope=JSON.parse(bytes);}catch{throw invalid();}
 if(!object(envelope))throw invalid();
 if(!Object.hasOwn(envelope,MARKER))return envelope;
 if(Buffer.byteLength(bytes)>MAX_ENCODED_BYTES)throw size();
 if(Object.keys(envelope).sort().join(',')!==[MARKER,'version','encoding','raw_bytes','sha256','data'].sort().join(',')||envelope[MARKER]!==true||envelope.version!==1||envelope.encoding!=='gzip+base64'||!Number.isSafeInteger(envelope.raw_bytes)||envelope.raw_bytes<=0||envelope.raw_bytes>MAX_RAW_BYTES||typeof envelope.sha256!=='string'||!/^[a-f0-9]{64}$/.test(envelope.sha256)||typeof envelope.data!=='string')throw invalid();
 try{
  const compressed=Buffer.from(envelope.data,'base64');
  if(!compressed.length||compressed.toString('base64')!==envelope.data)throw invalid();
  // Never trust a claimed length to permit unbounded allocation.
  const raw=gunzipSync(compressed,{maxOutputLength:envelope.raw_bytes});
  if(raw.length!==envelope.raw_bytes||hash(raw)!==envelope.sha256)throw invalid();
  const payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  if(!object(payload)||Object.hasOwn(payload,MARKER))throw invalid();
  return payload;
 }catch{throw invalid();} // Do not expose zlib/JSON snippets, tokens or source text.
}
module.exports={encode,decode,MAX_ENCODED_BYTES,MAX_RAW_BYTES};
