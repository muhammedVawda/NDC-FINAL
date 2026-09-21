/*
  410 Gone for "The Month-End Challenge".

  netlify.toml serves this path with status 410. That is a deliberate
  choice, not an oversight: the game was removed and has no equivalent
  replacement, so redirecting it somewhere unrelated would be a lie to
  both users and crawlers. 410 tells Google to drop the URL; 404 leaves
  it in the index for months being re-crawled.

  Vercel's redirects only speak 301/302/307/308, so the same status is
  served from a function and pointed at by a rewrite in vercel.json.
*/

module.exports = function (req, res) {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.status(410).send(
    '<!doctype html><html lang="en-ZA"><head><meta charset="utf-8">' +
    '<meta name="robots" content="noindex">' +
    '<title>Page removed | National Debt Consultants</title>' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '</head><body style="font-family:system-ui,sans-serif;background:#09161D;color:#fff;' +
    'display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center;padding:24px">' +
    '<main><h1 style="color:#F7C707">This page has been removed</h1>' +
    '<p>The Month-End Challenge is no longer available.</p>' +
    '<p><a href="/" style="color:#F7C707">Go to the homepage</a></p></main></body></html>'
  );
};
