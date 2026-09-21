// Vercel entry point for scheduled news ingestion.
// Logic lives in netlify/functions/ingest-news.js — see api/_adapter.js.
const { adapt } = require("./_adapter.js");
const { handler } = require("../netlify/functions/ingest-news.js");
module.exports = adapt(handler);
