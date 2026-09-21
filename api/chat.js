// Vercel entry point for the AI debt assistant.
// Logic lives in netlify/functions/chat.js — see api/_adapter.js.
const { adapt } = require("./_adapter.js");
const { handler } = require("../netlify/functions/chat.js");
module.exports = adapt(handler);
