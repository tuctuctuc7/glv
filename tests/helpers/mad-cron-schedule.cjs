'use strict';
// Single source of truth for the MAD refresh schedule (UTC). See
// docs/glv-mad-refresh-recovery.md "Refresh scopes and schedule".
// tuc  : TUC/V1 on the Prague cutoff, done before 08:00 GMT+7 (01:00 UTC).
// v2   : V2 native (TUC complete + TGLV so far) + shared publication.
// tglv : TGLV-only completion; handler skips until 01:00 Los Angeles.
module.exports=[
 {path:'/api/glv-meta-ads/cron-tuc',schedule:'0,20,40 0 * * *'},
 {path:'/api/glv-meta-ads/cron-tuc',schedule:'0 3,6,12,18,21 * * *'},
 {path:'/api/glv-meta-ads/cron-v2',schedule:'10,30,50 0,1 * * *'},
 {path:'/api/glv-meta-ads/cron-v2',schedule:'10 3,6,12,18,21 * * *'},
 {path:'/api/glv-meta-ads/cron-tglv',schedule:'0,15,30,45 8,9 * * *'},
 {path:'/api/glv-meta-ads/cron-tglv',schedule:'0 11,14 * * *'}
];
