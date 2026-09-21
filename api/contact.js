// Vercel entry point for the callback/enquiry form.
// Logic lives in netlify/functions/contact.js — see api/_adapter.js.
const { adapt } = require("./_adapter.js");
const { handler } = require("../netlify/functions/contact.js");
module.exports = adapt(handler);
