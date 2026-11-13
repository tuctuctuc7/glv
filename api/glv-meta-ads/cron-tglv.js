// Scheduled tglv-scope refresh; see api/glv-meta-ads/cron.js SCOPES.
module.exports = require('./cron.js').withScope('tglv');
