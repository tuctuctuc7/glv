// Retry provider responses, never Redis writes or a partially consumed pagination.
// The underlying fetcher owns the shared absolute deadline and body abort.
function metaRetryFetcher(fetcher, deadline, {now=Date.now,sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  return async (url,options={})=>{
    if(new URL(url).hostname!=='graph.facebook.com')return fetcher(url,options);
    for(let attempt=0;;attempt++){
      if(options.signal?.aborted||now()>=deadline)throw new Error('Meta refresh time budget exceeded');
      let response;
      try{response=await fetcher(url,options);}catch(error){
        const transient=error instanceof TypeError||error.name==='TimeoutError'||error.message==='Cron request time budget exceeded';
        if(!transient||attempt>=2)throw new Error('Meta transport request failed');
        const delay=500*2**attempt;
        if(options.signal?.aborted||now()+delay>=deadline)throw new Error('Meta retry time budget exceeded');
        await sleep(delay);
        continue;
      }
      let data,bodyError;
      try{data=await response.json();}catch(error){bodyError=error;}
      const error=data?.error,code=Number(error?.code);
      // Authentication/permission/schema failures are not healed by repetition.
      const permanent=[100,102,190,10,200].includes(code);
      const transient=!permanent&&(error?.is_transient===true||code===2||response.status===429||response.status>=500);
      if(!transient||attempt>=2){
        if(bodyError)throw new Error('Meta response body invalid');
        return {ok:response.ok,status:response.status,json:async()=>data};
      }
      const delay=500*2**attempt;
      if(options.signal?.aborted||now()+delay>=deadline)throw new Error('Meta retry time budget exceeded');
      await sleep(delay);
    }
  };
}
module.exports={metaRetryFetcher};
