#!/usr/bin/env node
/*
  Applies the shared partials to every top-level page. Idempotent: running it
  twice produces no further change.

  For each *.html in the repo root it (re)generates:
    - the site header (active nav item taken from <body data-page>)
    - the footer, with the current year
    - the mobile "Call us / Call me back" bar
    - the viewport meta (viewport-fit=cover so env(safe-area-inset-*) works)
    - the logo preload links
    - the ?v= version on every /assets/css and /assets/js URL
    - the sa-validate.js script ahead of chat.js
  and on index.html only:
    - the FAQ accordion between <!-- faq:start --> and <!-- faq:end -->
    - the JSON-LD between <!-- ld:start --> and <!-- ld:end -->
      (FinancialService, WebSite and FAQPage, all from assets/data/home-faqs.json
      so the schema matches the visible FAQs word for word)

  Run:  node scripts/build-site.mjs      (or: npm run site:build)
*/
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ASSET_V } from "./site-config.mjs";
import { header, footer, mobileBar, logoPreloads, fontPreloads, faqItemsHtml, homeJsonLd, coreScripts } from "./partials.mjs";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const year = new Date().getFullYear();

function between(html, start, end, replacement, file) {
  const re = new RegExp(`${start}[\\s\\S]*?${end}`);
  if (!re.test(html)) throw new Error(`${file}: markers ${start} … ${end} not found`);
  return html.replace(re, () => `${start}\n${replacement}\n${end}`);
}

const pages = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
let changed = 0;

for (const file of pages) {
  const p = path.join(ROOT, file);
  const before = readFileSync(p, "utf-8");
  let html = before;
  const pageKey = (html.match(/<body[^>]*data-page="([^"]+)"/) || [])[1] || "";

  // A page that renders the header but loads no nav.js has a dead hamburger
  // menu (the 404 page did). Give every page the same core script set; the
  // pages that already load nav.js are left as they are.
  if (!html.includes("/assets/js/nav.js")) {
    html = html.replace(/<script src="\/assets\/js\/motion\.js[^>]*><\/script>/, () => coreScripts());
  }

  html = html.replace(/<header class="site-header"[\s\S]*?<\/header>/, () => header(pageKey));
  html = html.replace(/<footer class="site-footer">[\s\S]*?<\/footer>/, () => footer(year));

  const barRe = /<nav class="mobile-actions"[\s\S]*?<\/nav>/;
  if (barRe.test(html)) html = html.replace(barRe, () => mobileBar());
  else html = html.replace(/(<script src="\/assets\/js\/nav\.js)/, (m) => `${mobileBar()}\n\n${m}`);

  html = html.replace(
    /<body data-page="([^"]*)"(?: data-has-mobile-bar="true")?>/,
    (_, k) => `<body data-page="${k}" data-has-mobile-bar="true">`
  );
  html = html.replace(
    /<meta name="viewport" content="[^"]*">/,
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
  );

  // Fonts are self-hosted: swap the old Google Fonts links for one preload (idempotent).
  const googleFonts = /<link rel="preconnect" href="https:\/\/fonts\.googleapis\.com">\n<link rel="preconnect" href="https:\/\/fonts\.gstatic\.com" crossorigin>\n<link href="https:\/\/fonts\.googleapis\.com\/css2[^>]*>/;
  if (googleFonts.test(html)) html = html.replace(googleFonts, () => fontPreloads());
  else html = html.replace(/<link rel="preload" href="\/assets\/fonts\/[^>]*>/, () => fontPreloads());

  html = html.replace(/<link rel="preload" as="image"[^>]*>\n?/g, "");
  html = html.replace(/(<link rel="stylesheet" href="\/assets\/css\/styles\.css)/, (m) => `${logoPreloads()}\n${m}`);

  html = html.replace(/(\/assets\/(?:css|js)\/[A-Za-z0-9._-]+\.(?:css|js))\?v=\d+/g, (_, u) => `${u}?${ASSET_V}`);
  if (!html.includes("/assets/js/sa-validate.js")) {
    html = html.replace(
      /(<script src="\/assets\/js\/chat\.js)/,
      (m) => `<script src="/assets/js/sa-validate.js?${ASSET_V}" defer></script>\n${m}`
    );
  }
  html = html.replace(/(<span data-year>)\d{4}(<\/span>)/g, (_, a, b) => `${a}${year}${b}`);

  if (file === "index.html") {
    const { faqs } = JSON.parse(readFileSync(path.join(ROOT, "assets/data/home-faqs.json"), "utf-8"));
    html = between(html, "<!-- faq:start -->", "<!-- faq:end -->", faqItemsHtml(faqs), file);
    html = between(html, "<!-- ld:start -->", "<!-- ld:end -->", homeJsonLd(faqs), file);
  }

  if (html !== before) {
    writeFileSync(p, html);
    changed++;
  }
}
console.log(`build-site: ${pages.length} pages checked, ${changed} updated (year ${year}, assets ${ASSET_V})`);
