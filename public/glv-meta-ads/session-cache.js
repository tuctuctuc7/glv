/* Private dashboard responses live only in this page's memory, never storage. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.MetaSessionCache=factory();
})(typeof globalThis!=='undefined'?globalThis:this,()=>{
  function createSessionCache({now=Date.now,ttl=5*60*1000,maxEntries=32}={}){
    const entries=new Map();
    let day='';
    function checkDay(){
      const current=new Date(now()).toISOString().slice(0,10);
      if(current!==day){entries.clear();day=current;}
    }
    function get(key,loader){
      checkDay();
      const cached=entries.get(key);
      if(cached&&(cached.pending||cached.expires>now())){
        entries.delete(key);entries.set(key,cached);return cached.promise;
      }
      const entry={pending:true,expires:0,promise:null};
      entry.promise=Promise.resolve().then(loader).then(value=>{
        entry.pending=false;entry.expires=now()+ttl;return value;
      },error=>{
        if(entries.get(key)===entry)entries.delete(key);
        throw error;
      });
      entries.delete(key);entries.set(key,entry);
      while(entries.size>maxEntries)entries.delete(entries.keys().next().value);
      return entry.promise;
    }
    return {get,invalidate:key=>entries.delete(key),clear:()=>entries.clear()};
  }
  return {createSessionCache};
});
