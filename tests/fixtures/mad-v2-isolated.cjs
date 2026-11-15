'use strict';
function memory(){const data=new Map();return {data,redis:async(cmd,key,value,...args)=>{if(cmd==='GET')return {result:data.get(key)||null};if(cmd==='TTL')return {result:data.has(key)?-1:-2};if(cmd==='SET'){if(args.includes('NX')&&data.has(key))return {result:null};data.set(key,value);return {result:'OK'};}if(cmd==='EVAL'){const lease=args[0],owner=args[1];if(data.get(lease)===owner)data.delete(lease);return {result:1};}throw Error(cmd);}};}
const snapshot=({account,range,type,now})=>({schema_version:1,creator_ad_version:1,complete:true,isolated_account_id:account.id,type,range,generated_at:now.toISOString(),accounts:[{...account,rows:[],reach:[]}],fx:{}});
module.exports={memory,snapshot};
