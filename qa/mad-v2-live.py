#!/usr/bin/env python3
"""Authorized read-only local V2 handler smoke; never logs/saves credentials or raw responses."""
import importlib.util
import os
from pathlib import Path
import subprocess

loader_path = Path('/home/tom/.local/bin/glv-meta-ads-refresh-today.py')
spec = importlib.util.spec_from_file_location('authorized_glv_loader', loader_path)
loader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(loader)
values = loader.load_env(loader.ENV_FILE)
token = next((values.get(key) for key in ('GLV_META_FB_ACCESS_TOKEN', 'AGENTHIC_META_ACCESS_TOKEN', 'FB_ACCESS_TOKEN') if values.get(key)), None)
if not token:
    raise SystemExit('Authorized local Meta credential unavailable')
env = {key: value for key, value in os.environ.items() if not any(part in key.upper() for part in ('TOKEN', 'SECRET', 'PASSWORD', 'KEY'))}
env.update(GLV_META_FB_ACCESS_TOKEN=token, GLV_META_BETA_AUTH_TOKEN='local-smoke-only', GLV_MAD_V2_ENABLED='1')
code = r"""
const assert=require('node:assert/strict');
const handler=require('./api/glv-meta-ads-v2/fb-data.js');
const {commonCutoff}=require('./lib/glv-mad-v2.cjs');
(async()=>{
 const day=commonCutoff(),query={type:'daily',currency:'USD',time_range:JSON.stringify({since:day,until:day})};
 const res={code:200,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;}};
 await handler({method:'GET',headers:{cookie:'glv_meta_beta=local-smoke-only'},query},res);
 if(res.code!==200){console.log(JSON.stringify({status:res.code,error:res.body.error}));process.exitCode=1;return;}
 assert.equal(res.body.complete,true);
 console.log(JSON.stringify({status:res.code,range:res.body.range,currency:res.body.report_currency,generated_at:res.body.generated_at,accounts:res.body.accounts.map(a=>({id:a.id,currency:a.currency,timezone:a.timezone,rows:res.body.rows.filter(r=>r.account_id===a.id).length,nativeSpend:res.body.rows.filter(r=>r.account_id===a.id).reduce((n,r)=>n+Number(r.native.amount_spent),0),usdSpend:res.body.rows.filter(r=>r.account_id===a.id).reduce((n,r)=>n+r.amount_spent,0)})),fx:[...new Map(res.body.rows.map(r=>[r.fx.date,{date:r.fx.date,czk_per_usd:r.fx.czk_per_usd,source:r.fx.source}])).values()],warnings:res.body.warnings},null,2));
})().catch(()=>{console.error('Live check failed; no upstream diagnostic exposed');process.exitCode=1;});
"""
raise SystemExit(subprocess.run(['node', '-e', code], cwd=Path(__file__).resolve().parents[1], env=env).returncode)
