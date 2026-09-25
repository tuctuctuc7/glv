module.exports = async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  return res.status(410).json({
    ok: false,
    frozen: true,
    message: 'The KRS Meta Ads dashboard has been discontinued. Its data snapshot is no longer refreshed.',
  });
};
