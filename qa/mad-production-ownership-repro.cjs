'use strict';
// Minimal offline regression; synthetic Meta input, actual producer + frontend.
// No credential loading, network calls, or fabricated publication proof.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {normalizeCampaign}=require('../api/glv-meta-ads/fb-data.js')._test;
const html=fs.readFileSync(path.join(__dirname,'../public/glv-meta-ads/index.html'),'utf8');
const slice=(a,b)=>html.slice(html.indexOf(a),html.indexOf(b));
const ctx=vm.createContext({MadPresentation:require('../public/glv-meta-ads/presentation.js'),GlvWlReport:require('../public/glv-meta-ads/wl-report.js')});
vm.runInContext(`let campaignMeta={};const CAMPAIGN_COLORS=['#123456'];${slice('const parseAmt','function getCampaignColor')}${slice('function getCampaignColor','function fmt(')}${slice('function extractDate','function fmtDate')}${slice('function processRow','function processCreatives')}${html.match(/const campaignGroupKey=.*;/)[0]}`,ctx);
ctx.rows=[normalizeCampaign({account_id:'359758259164738',campaign_id:'2',campaign_name:'OTHER_002_CZSK_BAU',spend:'37',impressions:'370',reach:'100',date_start:'2026-11-04',date_stop:'2026-11-10'})];
const result=vm.runInContext('processAggregateRows(rows)',ctx);
console.log(JSON.stringify({synthetic:true,liveCalls:false,producerAccountId:ctx.rows[0].account_id??null,expectedRows:1,actualRows:result.length,expectedSpend:37,actualSpend:result.reduce((s,r)=>s+r.spend,0),boundary:'actual V1 normalizeCampaign → actual browser processAggregateRows'}));
if(result.length!==1||result[0].spend!==37)process.exitCode=1;
