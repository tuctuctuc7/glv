// Scheduled v2-scope refresh; see api/glv-meta-ads/cron.js SCOPES.
module.exports = require('./cron.js').withScope('v2');
