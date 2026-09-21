/*
  Netlify -> Vercel function adapter.

  The serverless handlers in netlify/functions/ hold the real logic:
  input validation, rate limiting, the grounded system prompt, the
  "not configured" guards. That logic must not be duplicated — two
  copies of security-sensitive code drift, and the copy someone forgets
  to update is the one that gets deployed.

  Vercel picks up /api/*.js automatically and calls
  handler(req, res). Netlify calls handler(event) and expects
  { statusCode, headers, body }. This wraps one in the other so the
  same file serves both platforms.
*/

function toNetlifyEvent(req) {
  var body = req.body;
  // Vercel parses JSON bodies; the Netlify handlers expect a string.
  if (body && typeof body !== "string") {
    try { body = JSON.stringify(body); } catch (e) { body = "{}"; }
  }
  return {
    httpMethod: req.method,
    headers: req.headers || {},
    body: body || "",
    queryStringParameters: req.query || {},
  };
}

function adapt(netlifyHandler) {
  return async function (req, res) {
    try {
      var result = await netlifyHandler(toNetlifyEvent(req));
      var headers = result.headers || {};
      Object.keys(headers).forEach(function (k) { res.setHeader(k, headers[k]); });
      if (!headers["Content-Type"] && !headers["content-type"]) {
        res.setHeader("Content-Type", "application/json");
      }
      res.status(result.statusCode || 200).send(result.body || "");
    } catch (err) {
      res.status(500).json({ error: "Internal error." });
    }
  };
}

module.exports = { adapt: adapt };
