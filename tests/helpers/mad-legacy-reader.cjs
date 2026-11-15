'use strict';
// Explicit retired-library adapter. These are NOT the active V1/V2 APIs.
const reader=require('../../lib/glv-mad-shared-reader.cjs');
module.exports={v1:(req,res)=>reader.handler(req,res,'v1'),v2:(req,res)=>reader.handler(req,res,'v2')};
