'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
// Execute each route's declared calendar/freshness dependencies, not another
// version's inferred globals. Context must already be a vm context.
module.exports=function loadDateRuntime(html,context){
 const sources=[...html.matchAll(/<script\s+src="([^"?]+)(?:\?[^\"]*)?"/g)].map(m=>m[1]).filter(src=>/\/(?:v1-)?(?:dates|freshness|date-policy)\.js$/.test(src));
 if(!sources.length)throw Error('No declared date/freshness runtime');
 for(const src of sources)vm.runInContext(fs.readFileSync(path.join(__dirname,'../../public',src),'utf8'),context,{filename:src});
};
