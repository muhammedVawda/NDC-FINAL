#!/usr/bin/env node
/*
  Static integrity checks across every page. No browser needed.

  Covers: metadata, canonical URLs, one H1 and a sensible heading order,
  unique ids, every internal link and #anchor resolving, no "#" placeholder
  links, one consistent phone number / email / registration number,
  image alt text, JSON-LD parsing, FAQ schema matching the visible FAQs word
  for word, robots.txt and sitemap.xml.

  Run:  node scripts/check-site.mjs      (exits non-zero on any failure)
*/
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = "https://ndcsa.co.za";

let pass = 0;
const failures = [];
function ok(cond, msg) {
  if (cond) pass++;
  else failures.push(msg);
}

const unescape = (s) =>
  s
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&rsquo;/g, "’")
    .replace(/&lsquo;/g, "‘").replace(/&mdash;/g, "—").replace(/&middot;/g, "·");
const text = (html) => unescape(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();

// ---- gather pages ----------------------------------------------------------
const rootPages = readdirSync(ROOT).filter((f) => f.endsWith(".html"));
const blogPages = existsSync(path.join(ROOT, "debt-advice"))
  ? readdirSync(path.join(ROOT, "debt-advice")).filter((f) => f.endsWith(".html")).map((f) => `debt-advice/${f}`)
  : [];
const pages = [...rootPages, ...blogPages];
const html = Object.fromEntries(pages.map((p) => [p, readFileSync(path.join(ROOT, p), "utf-8")]));

function urlPathFor(file) {
  if (file === "index.html") return "/";
  if (file === "debt-advice/index.html") return "/debt-advice/";
  return "/" + file;
}
const idsOf = (h) => [...h.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);

// resolve an internal href to a file in `pages` (or null)
function resolve(href) {
  const clean = href.split("#")[0].split("?")[0];
  if (clean === "" ) return null;
  if (clean === "/") return "index.html";
  const rel = clean.replace(/^\//, "");
  if (pages.includes(rel)) return rel;
  if (pages.includes(rel.replace(/\/$/, "") + "/index.html")) return rel.replace(/\/$/, "") + "/index.html";
  return null;
}
function existsOnDisk(href) {
  const clean = href.split("#")[0].split("?")[0].replace(/^\//, "");
  if (!clean) return true;
  const p = path.join(ROOT, clean);
  return existsSync(p) && (statSync(p).isFile() || existsSync(path.join(p, "index.html")));
}

const titles = new Map();
for (const file of pages) {
  const h = html[file];
  const isError = file === "404.html";

  // ---- head ----------------------------------------------------------------
  const title = (h.match(/<title>([\s\S]*?)<\/title>/) || [])[1];
  ok(!!title, `${file}: missing <title>`);
  if (title) {
    const t = unescape(title);
    ok(t.length <= 70, `${file}: title is ${t.length} chars (>70)`);
    if (titles.has(t)) failures.push(`${file}: duplicate title with ${titles.get(t)}`);
    titles.set(t, file);
  }
  const noindex = /name="robots" content="noindex/.test(h);
  ok(noindex || /<meta name="description" content="[^"]{40,}"/.test(h), `${file}: missing or very short meta description`);
  ok(/<html lang="en-ZA"/.test(h), `${file}: html lang is not en-ZA`);
  ok(/viewport-fit=cover/.test(h), `${file}: viewport meta lacks viewport-fit=cover`);
  if (!isError && !/name="robots" content="noindex/.test(h)) {
    const canon = (h.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
    ok(canon === SITE + urlPathFor(file), `${file}: canonical is ${canon}, expected ${SITE + urlPathFor(file)}`);
    ok(!/vercel\.app/.test(h), `${file}: contains a vercel.app URL`);
  }

  // ---- headings ------------------------------------------------------------
  const heads = [...h.matchAll(/<h([1-6])[\s>]/g)].map((m) => Number(m[1]));
  ok(heads.filter((n) => n === 1).length === 1, `${file}: expected exactly one <h1>, found ${heads.filter((n) => n === 1).length}`);
  let prev = 0;
  let skipped = false;
  for (const n of heads) {
    if (prev && n > prev + 1) skipped = true;
    prev = n;
  }
  ok(!skipped, `${file}: heading levels skip (${heads.join(",")})`);

  // ---- ids and links -------------------------------------------------------
  const ids = idsOf(h);
  ok(new Set(ids).size === ids.length, `${file}: duplicate ids (${ids.filter((x, i) => ids.indexOf(x) !== i).join(", ")})`);

  const hrefs = [...h.matchAll(/<a\s[^>]*href="([^"]*)"/g)].map((m) => m[1]);
  for (const href of hrefs) {
    if (href === "#" || href === "") { failures.push(`${file}: placeholder link href="${href}"`); continue; }
    if (/^(https?:|mailto:|tel:)/.test(href)) continue;
    const [, hash] = href.split("#");
    if (href.startsWith("#")) {
      ok(ids.includes(hash), `${file}: in-page anchor ${href} has no matching id`);
      continue;
    }
    ok(existsOnDisk(href), `${file}: broken internal link ${href}`);
    if (hash) {
      const target = resolve(href);
      ok(target && idsOf(html[target]).includes(hash), `${file}: ${href} points to a missing #${hash}`);
    }
  }
  // asset references
  for (const m of h.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)/g)) ok(existsOnDisk(m[1]), `${file}: missing asset ${m[1]}`);

  // ---- contact consistency ------------------------------------------------
  for (const t of h.matchAll(/href="tel:([^"]+)"/g)) ok(t[1] === "+27210541141", `${file}: tel link is ${t[1]}`);
  for (const m of h.matchAll(/href="mailto:([^"?]+)/g)) ok(m[1] === "marketing@ndcsa.co.za", `${file}: mailto is ${m[1]}`);
  ok(!/telepride\.co\.za/i.test(h), `${file}: contains a telepride.co.za address`);
  ok(!/Marketing@/.test(h), `${file}: email appears with a capital M`);
  ok(!/NCR DC 4382/.test(h), `${file}: registration written as "NCR DC 4382"`);
  ok(!/0210511141|021 051 1141/.test(h), `${file}: contains the old wrong phone number`);
  for (const m of h.matchAll(/\(?021\)?[\s ]+0\d\d[\s ]+\d{4}/g)) ok(m[0] === "(021) 054 1141", `${file}: phone shown as "${m[0]}"`);

  // ---- images --------------------------------------------------------------
  for (const m of h.matchAll(/<img\b[^>]*>/g)) {
    ok(/\balt="/.test(m[0]), `${file}: <img> without alt: ${m[0].slice(0, 60)}`);
    if (/ndc-logo-h/.test(m[0])) ok(/alt="National Debt Consultants logo"/.test(m[0]), `${file}: logo alt text wrong`);
    if (/watermark/.test(m[0])) ok(/alt=""/.test(m[0]) && /aria-hidden="true"/.test(m[0]), `${file}: watermark must be alt="" aria-hidden`);
  }

  // ---- shared furniture ----------------------------------------------------
  ok(/Regulated by the NCR[\s\S]{0,40}NCRDC4382/.test(h), `${file}: footer lacks "Regulated by the NCR · NCRDC4382"`);
  ok(/National Credit Act 34 of 2005/.test(h) && /POPIA/.test(h), `${file}: footer legal line incomplete`);
  ok(new RegExp(`&copy; <span data-year>${new Date().getFullYear()}</span> National Debt Consultants\\. <span class="footer-credit">Powered by Telepride \\(Pty\\) Ltd\\.</span>`).test(h), `${file}: copyright/credit line wrong or year stale`);
  ok(/class="mobile-actions"/.test(h) && /href="tel:\+27210541141">Call us</.test(h) && />Call me back</.test(h), `${file}: mobile Call us / Call me back bar missing`);
  for (const s of ["facebook.com/nationaldebtconsultants", "instagram.com/national.debt.consultants/", "linkedin.com/company/national-debt-consultants/", "maps.app.goo.gl/bq5FtkSw6TrXPfzp9"])
    ok(h.includes(s), `${file}: footer missing ${s}`);
  ok(/ndcsa\.co\.za\/job-openings\//.test(h) && /href="\/privacy-policy\.html"/.test(h), `${file}: careers/privacy footer links missing`);

  // ---- JSON-LD parses ------------------------------------------------------
  for (const m of h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)) {
    try { JSON.parse(m[1]); pass++; } catch (e) { failures.push(`${file}: invalid JSON-LD (${e.message})`); }
  }
}

// ---- homepage specifics -----------------------------------------------------
{
  const h = html["index.html"];
  const title = unescape((h.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "");
  ok(title === "Debt Review & Debt Counselling in South Africa | NDC" && title.length < 60, `home title wrong or too long: "${title}" (${title.length})`);
  const desc = unescape((h.match(/<meta name="description" content="([^"]*)"/) || [])[1] || "");
  ok(desc.length >= 120 && desc.length <= 165, `home description is ${desc.length} chars`);
  ok(/NCR-registered/.test(desc) && /NCRDC4382/.test(desc) && /debt review/i.test(desc) && /debt mediation/i.test(desc) && /removal/i.test(desc) && /free assessment/i.test(desc) && /\(021\) 054 1141/.test(desc), "home description misses a required element");
  ok(h.includes('<meta name="google-site-verification" content="nqMSTbw9k-RznLH2nOG7PWA-byuf5jsc5h2G8ogw98c">'), "Search Console verification meta missing on home");
  ok(h.includes('<link rel="canonical" href="https://ndcsa.co.za/">'), "home canonical wrong");
  ok(/og:image" content="https:\/\/ndcsa\.co\.za\/assets\/img\/og-image\.png/.test(h) && /twitter:card" content="summary_large_image"/.test(h), "home social tags incomplete");

  const blocks = [...h.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((m) => JSON.parse(m[1]));
  const fs = blocks.find((b) => b["@type"] === "FinancialService");
  ok(!!fs, "FinancialService JSON-LD missing");
  if (fs) {
    ok(fs.telephone === "+27-21-054-1141" && fs.email === "marketing@ndcsa.co.za" && fs.url === SITE + "/", "FinancialService contact fields wrong");
    ok(fs.address && fs.address.addressCountry === "ZA" && fs.address.postalCode === "7915" && fs.address.addressLocality === "Cape Town" && !!fs.address.streetAddress, "FinancialService address incomplete");
    ok(fs.areaServed && /South Africa/.test(fs.areaServed.name), "areaServed missing");
    ok(fs.hasMap === "https://maps.app.goo.gl/bq5FtkSw6TrXPfzp9", "hasMap wrong");
    ok(Array.isArray(fs.sameAs) && fs.sameAs.length === 3, "sameAs should list the three socials");
    const svc = (fs.hasOfferCatalog && fs.hasOfferCatalog.itemListElement || []).map((o) => o.itemOffered.name);
    ok(JSON.stringify(svc) === JSON.stringify(["Debt Review", "Debt Mediation", "Debt Review Removal"]), `services in schema: ${svc}`);
    ok(!("aggregateRating" in fs) && !("review" in fs), "schema must not carry ratings or reviews");
  }

  // FAQ schema == visible FAQs, word for word
  const faqLd = blocks.find((b) => b["@type"] === "FAQPage");
  ok(!!faqLd, "FAQPage JSON-LD missing");
  const region = h.slice(h.indexOf("<!-- faq:start -->"), h.indexOf("<!-- faq:end -->"));
  const visible = [...region.matchAll(/<summary>([\s\S]*?)<svg[\s\S]*?<\/summary>\s*<p class="faq-answer">([\s\S]*?)<\/p>/g)].map((m) => ({ q: text(m[1]), a: text(m[2]) }));
  ok(visible.length === 12, `homepage shows ${visible.length} FAQs, expected 12`);
  if (faqLd) {
    const ld = faqLd.mainEntity.map((e) => ({ q: e.name, a: e.acceptedAnswer.text }));
    ok(JSON.stringify(ld) === JSON.stringify(visible), "FAQPage schema differs from the visible FAQs");
  }
  const expectedQs = [
    "What is debt counselling?", "How does debt review work?", "Benefits of debt review?", "What is debt mediation?",
    "How long does debt review take?", "Will it affect my credit score?", "How much does it cost?", "What if I miss a payment?",
    "Can I apply for new credit during debt review?", "Can debt review status be removed?", "Not sure debt review is right for me?", "How do I contact NDC?",
  ];
  ok(JSON.stringify(visible.map((v) => v.q)) === JSON.stringify(expectedQs), "FAQ questions differ from the required twelve");

  // required content
  const body = text(h);
  for (const needle of ["Assessment", "Negotiation", "Implementation", "Your credit score may dip at first", "No new credit during debt review", "Missed payments can cost you", "Your assessment is free", "experienced, multilingual team", "Speak to a consultant", "Request my callback", "Best time to call"])
    ok(body.includes(needle), `home page lacks "${needle}"`);
  ok(/<img class="hero__watermark"[^>]*alt=""[^>]*aria-hidden="true"/.test(h), "hero watermark missing or not decorative");
  ok(!/<section[^>]*>[\s\S]{0,40}Add preferences/.test(h), "home form should not have an 'Add preferences' panel any more");
}

// ---- about page content -------------------------------------------------------
{
  const body = text(html["about.html"]);
  for (const needle of ["Mission", "Vision", "Values", "Integrity", "Transparency", "Compassion", "Covid-19", "multilingual", "ethical, effective debt solutions tailored to each client", "leading, trusted debt consulting agency in South Africa"])
    ok(body.includes(needle), `about page lacks "${needle}"`);
  ok(!/will be published here once confirmed/i.test(body), "about page still carries a placeholder sentence");
}

// ---- no placeholders anywhere ---------------------------------------------------
for (const file of pages) ok(!/\[[^\]]*(to be confirmed|to be added)[^\]]*\]|lorem ipsum|coming soon/i.test(html[file]), `${file}: placeholder text`);

// ---- robots + sitemap ------------------------------------------------------------
{
  const robots = readFileSync(path.join(ROOT, "robots.txt"), "utf-8");
  ok(/Sitemap: https:\/\/ndcsa\.co\.za\/sitemap\.xml/.test(robots), "robots.txt lacks the production sitemap line");
  ok(!/Disallow: \/\s*$/m.test(robots), "robots.txt blocks the whole site");
  const sm = readFileSync(path.join(ROOT, "sitemap.xml"), "utf-8");
  const locs = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  ok(locs.length > 20, `sitemap lists only ${locs.length} URLs`);
  ok(locs.every((l) => l.startsWith(SITE + "/")), "sitemap contains a non-production URL");
  ok(locs.every((l) => existsOnDisk(l.replace(SITE, ""))), "sitemap lists a URL with no file");
  ok(new Set(locs).size === locs.length, "sitemap has duplicate URLs");
}

console.log(`check-site: ${pages.length} pages, ${pass} checks passed, ${failures.length} failed.`);
if (failures.length) {
  failures.slice(0, 60).forEach((f) => console.error("FAIL: " + f));
  if (failures.length > 60) console.error(`... and ${failures.length - 60} more`);
  process.exit(1);
}
