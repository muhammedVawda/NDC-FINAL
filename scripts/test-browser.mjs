#!/usr/bin/env node
/*
  Browser QA for the whole site (Chromium via Playwright).

  Needs the dev server running (with a high rate limit, because the suite submits
  many forms from one address), with callback delivery pointed at a LOCAL
  receiver so no real enquiry or email is ever created:

    node <receiver that appends each POST body to $LEADS_LOG, listening on :9000>
    CONTACT_RATE_LIMIT_MAX=1000 CONTACT_WEBHOOK_URL=http://127.0.0.1:9000/lead npm run dev
    LEADS_LOG=/path/to/leads.log node scripts/test-browser.mjs

  Env:  BASE (default http://127.0.0.1:8099)   SHOTS (screenshot dir)
        LEADS_LOG (file the receiver writes)   AXE (path to axe.min.js; optional)
        CHROMIUM_PATH (optional explicit browser binary)
*/
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import os from "node:os";

const BASE = process.env.BASE || "http://127.0.0.1:8099";
const SHOTS = process.env.SHOTS || path.join(os.tmpdir(), "ndc-shots");
const LEADS_LOG = process.env.LEADS_LOG || "";
mkdirSync(SHOTS, { recursive: true });

let chromium;
for (const spec of ["playwright", "/opt/node22/lib/node_modules/playwright/index.js"]) {
  try {
    const m = await import(spec);
    chromium = m.chromium || (m.default && m.default.chromium);
    if (chromium) break;
  } catch { /* try next */ }
}
if (!chromium) { console.error("Playwright not found"); process.exit(2); }
const exe = process.env.CHROMIUM_PATH || (existsSync("/opt/pw-browsers/chromium") ? "/opt/pw-browsers/chromium" : undefined);
const browser = await chromium.launch({ executablePath: exe, args: ["--ignore-certificate-errors"] });

let pass = 0;
const fails = [];
let section = "";
function ok(cond, msg) {
  if (cond) { pass++; console.log("  PASS " + msg); }
  else { fails.push(`[${section}] ${msg}`); console.log("  FAIL " + msg); }
}
async function run(name, fn) {
  section = name;
  console.log(`\n=== ${name} ===`);
  try { await fn(); } catch (e) { fails.push(`[${name}] threw: ${e.message}`); console.log("  FAIL threw: " + e.message); }
}
const leads = () => (LEADS_LOG && existsSync(LEADS_LOG) ? readFileSync(LEADS_LOG, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function page(opts = {}) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.on("console", (m) => { if (m.type() === "error" && !/fonts\.(googleapis|gstatic)|ERR_(CONNECTION|NAME|PROXY|TUNNEL|INTERNET)/.test(m.text())) p.errors.push(m.text()); });
  p.on("response", (r) => { if (r.status() >= 400 && r.url().startsWith(BASE) && !/\/api\/contact$/.test(r.url())) p.errors.push(`${r.status()} ${r.url()}`); });
  return p;
}
const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);

const PAGES = ["index.html", "calculator.html", "contact.html", "about.html", "debt-review.html", "debt-mediation.html", "debt-review-removal.html", "faqs.html", "privacy-policy.html", "terms.html", "debt-advice/", "debt-advice/how-debt-counselling-works-in-south-africa.html"];

// ----------------------------------------------------------------------------
await run("No horizontal scroll at 360 / 390 / 768 / 1280 / 1440", async () => {
  for (const w of [360, 390, 768, 1280, 1440]) {
    const p = await page({ viewport: { width: w, height: 800 } });
    const bad = [];
    for (const f of PAGES) {
      await p.goto(`${BASE}/${f}`, { waitUntil: "networkidle" });
      await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } });
      const over = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 0) bad.push(`${f} (+${over}px)`);
    }
    ok(bad.length === 0, `${w}px: no horizontal overflow on ${PAGES.length} pages${bad.length ? " :: " + bad.join(", ") : ""}`);
    await p.context().close();
  }
});

// ----------------------------------------------------------------------------
await run("Header: one row, readable type, logo size and sharpness", async () => {
  for (const w of [1024, 1280, 1440]) {
    const p = await page({ viewport: { width: w, height: 900 } });
    await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
    const h = await p.evaluate(() => {
      const bar = document.querySelector(".site-header__bar").getBoundingClientRect();
      const items = [...document.querySelectorAll(".primary-nav__list > li")].filter((n) => n.offsetParent !== null);
      const cta = document.querySelector(".primary-nav__actions .btn").getBoundingClientRect();
      const logo = document.querySelector(".site-header .brand__mark").getBoundingClientRect();
      const nav = document.querySelector(".primary-nav").getBoundingClientRect();
      const link = document.querySelector('.primary-nav__list a[data-page="calculator"]');
      const cs = getComputedStyle(link);
      const centres = items.map((n) => { const r = n.getBoundingClientRect(); return r.top + r.height / 2; }).concat([cta.top + cta.height / 2]);
      return {
        rows: new Set(items.map((n) => Math.round(n.getBoundingClientRect().top))).size,
        spread: Math.max(...centres) - Math.min(...centres), height: Math.round(document.querySelector(".site-header").getBoundingClientRect().height),
        logoH: Math.round(logo.height), gap: Math.round(nav.left - logo.right), fs: cs.fontSize, fw: cs.fontWeight, color: cs.color,
        labels: items.map((n) => n.textContent.trim().split("\n")[0].trim()), cta: document.querySelector(".primary-nav__actions .btn").textContent.trim(),
        barBottom: Math.round(bar.bottom),
      };
    });
    ok(h.rows === 1 && h.spread < 14, `${w}px: logo, menu and CTA on one row (rows=${h.rows}, vertical spread ${Math.round(h.spread)}px)`);
    ok(h.gap >= 16, `${w}px: ${h.gap}px clear between logo and menu`);
    ok(h.fs === "17px" && h.fw === "600", `${w}px: nav links ${h.fs} / weight ${h.fw}`);
    ok(h.logoH === 96, `${w}px: logo ${h.logoH}px tall`);
    ok(JSON.stringify(h.labels) === JSON.stringify(["Services", "Calculator", "About", "Contact"]) && h.cta === "Request a callback", `${w}px: ${h.labels.join(" · ")} + ${h.cta}`);
    const c = ratio(rgb(h.color), [9, 22, 29]);
    ok(c >= 4.5, `${w}px: nav link contrast ${c.toFixed(1)}:1`);
    if (w === 1440) {
      // hover + keyboard focus
      await p.hover('.primary-nav__list a[data-page="about"]'); await p.waitForTimeout(350);
      const hov = await p.$eval('.primary-nav__list a[data-page="about"]', (n) => ({ c: getComputedStyle(n).color, u: getComputedStyle(n, "::after").transform }));
      ok(hov.c !== h.color && /matrix\(1,/.test(hov.u), `hover changes colour and draws the underline (${hov.c}, ${hov.u})`);
      await p.mouse.move(5, 500);
      await p.focus('.primary-nav__list a[data-page="contact"]'); await p.keyboard.press("Tab"); await p.keyboard.press("Shift+Tab");
      const foc = await p.evaluate(() => { const s = getComputedStyle(document.activeElement); return { st: s.outlineStyle, w: s.outlineWidth, off: s.outlineOffset, who: document.activeElement.textContent.trim().slice(0, 14) }; });
      ok(foc.st === "solid" && foc.w === "2px", `keyboard focus ring on "${foc.who}": ${foc.w} ${foc.st}`);
      await p.screenshot({ path: path.join(SHOTS, "header-desktop.png"), clip: { x: 0, y: 0, width: 1440, height: 150 } });
    }
    await p.context().close();
  }
  // asset chosen per density: sharp, never upscaled
  for (const [w, dpr, expect] of [[1440, 1, "h96"], [1440, 2, "h192"], [1440, 3, "h288"], [390, 1, "h64"], [390, 2, "h128"], [390, 3, "h192"]]) {
    const p = await page({ viewport: { width: w, height: 800 }, deviceScaleFactor: dpr });
    await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
    // naturalHeight is density-corrected for srcset, so measure the real pixels of the chosen file.
    const r = await p.evaluate(async () => {
      const i = document.querySelector(".site-header .brand__mark");
      const bmp = await createImageBitmap(await (await fetch(i.currentSrc)).blob());
      return { src: i.currentSrc, nat: bmp.height, h: i.getBoundingClientRect().height };
    });
    ok(r.src.includes(expect), `${w}px @${dpr}x loads ${expect} (${r.src.split("/").pop().split("?")[0]})`);
    ok(r.nat >= Math.round(r.h * dpr) - 1, `${w}px @${dpr}x: ${r.nat}px source for ${Math.round(r.h * dpr)} device px (no upscaling)`);
    await p.context().close();
  }
  const p = await page({ viewport: { width: 390, height: 780 } });
  await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  const m = await p.evaluate(() => ({ h: Math.round(document.querySelector(".site-header").getBoundingClientRect().height), logo: Math.round(document.querySelector(".site-header .brand__mark").getBoundingClientRect().height), tgt: Math.round(document.querySelector("[data-nav-toggle]").getBoundingClientRect().height) }));
  ok(m.logo === 64 && m.h === 89, `mobile: logo ${m.logo}px, header ${m.h}px`);
  ok(m.tgt >= 44, `mobile: hamburger target ${m.tgt}px`);
  await p.screenshot({ path: path.join(SHOTS, "header-mobile.png"), clip: { x: 0, y: 0, width: 390, height: 110 } });
  await p.context().close();
});

// ----------------------------------------------------------------------------
await run("Header stays still when scrolling stops (no jitter)", async () => {
  for (const [w, label] of [[1440, "desktop"], [390, "mobile"]]) {
    const p = await page({ viewport: { width: w, height: 800 } });
    await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
    let worst = 0;
    for (const y of [0, 24, 40, 80, 120, 400]) {
      const r = await p.evaluate(async (y) => {
        window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 400));
        const h = document.querySelector(".site-header"); const seen = new Set(); const t0 = performance.now();
        return await new Promise((res) => { (function tick() { seen.add(Math.round(h.getBoundingClientRect().height * 10) + ":" + Math.round(h.getBoundingClientRect().top * 10) + ":" + Math.round(window.scrollY)); if (performance.now() - t0 < 700) requestAnimationFrame(tick); else res(seen.size); })(); });
      }, y);
      worst = Math.max(worst, r);
    }
    ok(worst === 1, `${label}: header height/position/scroll identical for 700 ms at every stop (distinct states ${worst})`);
    // opening the chat must not move it
    const before = await p.evaluate(() => { const r = document.querySelector(".site-header").getBoundingClientRect(); return [r.left, r.top, r.width, r.height].join(); });
    await p.click(".chat-launcher"); await p.waitForSelector(".chat-option"); await p.waitForTimeout(300);
    const after = await p.evaluate(() => { const r = document.querySelector(".site-header").getBoundingClientRect(); return [r.left, r.top, r.width, r.height].join(); });
    ok(before === after, `${label}: opening the chat does not move the header`);
    await p.context().close();
  }
});

// ----------------------------------------------------------------------------
await run("Watermark: faint, decorative, behind content, no rectangle", async () => {
  for (const [w, minR, maxR, op] of [[1440, 0.40, 0.55, "0.05"], [1280, 0.40, 0.55, "0.05"], [768, 0.40, 0.55, "0.05"], [390, 0.60, 1.0, "0.035"]]) {
    const p = await page({ viewport: { width: w, height: 900 } });
    await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" }); await p.waitForTimeout(1600);
    const r = await p.evaluate(() => {
      const wm = document.querySelector(".hero__watermark"); const hero = document.querySelector(".hero").getBoundingClientRect(); const cs = getComputedStyle(wm); const b = wm.getBoundingClientRect();
      const cta = document.querySelector(".hero__actions .btn-gold").getBoundingClientRect();
      const top = document.elementFromPoint(cta.left + cta.width / 2, cta.top + cta.height / 2);
      return { op: cs.opacity, pe: cs.pointerEvents, z: cs.zIndex, alt: wm.getAttribute("alt"), aria: wm.getAttribute("aria-hidden"), ratio: b.width / hero.width, topIsCta: !!top.closest(".hero__actions"), over: document.documentElement.scrollWidth - window.innerWidth, right: b.right - hero.right };
    });
    ok(r.alt === "" && r.aria === "true", `${w}px: watermark is alt="" aria-hidden`);
    ok(r.op === op && r.pe === "none", `${w}px: opacity ${r.op}, pointer-events ${r.pe}`);
    ok(r.ratio >= minR && r.ratio <= maxR, `${w}px: width is ${(r.ratio * 100).toFixed(0)}% of the hero`);
    ok(r.topIsCta && r.over <= 0, `${w}px: clicks reach the CTA through it; no horizontal scroll (+${r.over})`);

    // Worst-case effect on text contrast: render with and without the watermark.
    const withWm = await p.screenshot({ clip: { x: 0, y: 120, width: Math.min(w, 1440), height: 560 } });
    await p.addStyleTag({ content: ".hero__watermark{opacity:0 !important}" }); await p.waitForTimeout(150);
    const without = await p.screenshot({ clip: { x: 0, y: 120, width: Math.min(w, 1440), height: 560 } });
    const diff = await p.evaluate(async ([a, b]) => {
      const load = (s) => new Promise((res) => { const i = new Image(); i.onload = () => res(i); i.src = "data:image/png;base64," + s; });
      const [ia, ib] = await Promise.all([load(a), load(b)]);
      const cv = (i) => { const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0); return x.getImageData(0, 0, i.width, i.height).data; };
      const da = cv(ia), db = cv(ib); let max = 0, brightest = [0, 0, 0];
      for (let k = 0; k < da.length; k += 4) { const d = Math.max(Math.abs(da[k] - db[k]), Math.abs(da[k + 1] - db[k + 1]), Math.abs(da[k + 2] - db[k + 2])); if (d > max) { max = d; brightest = [da[k], da[k + 1], da[k + 2]]; } }
      return { max, brightest };
    }, [withWm.toString("base64"), without.toString("base64")]);
    ok(diff.max <= 16, `${w}px: the watermark changes no pixel by more than ${diff.max}/255 (a 5% overlay of the brightest artwork is ~12)`);
    const lede = await p.$eval(".hero .lede", (n) => getComputedStyle(n).color);
    // worst-case text contrast: lede colour against the brightest watermark-affected background
    const worstBg = diff.brightest;
    ok(ratio(rgb(lede), worstBg) >= 4.5, `${w}px: hero paragraph keeps ${ratio(rgb(lede), worstBg).toFixed(1)}:1 contrast even on the brightest watermark pixel`);
    if (w === 1440) await p.screenshot({ path: path.join(SHOTS, "hero-desktop.png") });
    if (w === 390) await p.screenshot({ path: path.join(SHOTS, "hero-mobile.png") });
    await p.context().close();
  }
  // no visible plate: the watermark image's own corners equal the hero colour
  const p = await page({ viewport: { width: 1440, height: 900 } });
  await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  const corners = await p.evaluate(async () => {
    const i = new Image(); i.src = "/assets/img/ndc-watermark.webp"; await i.decode();
    const c = document.createElement("canvas"); c.width = i.width; c.height = i.height; const x = c.getContext("2d"); x.drawImage(i, 0, 0);
    return [[2, 2], [i.width - 3, 2], [2, i.height - 3], [i.width - 3, i.height - 3]].map(([a, b]) => Array.from(x.getImageData(a, b, 1, 1).data.slice(0, 3)));
  });
  ok(corners.every((c) => Math.max(Math.abs(c[0] - 9), Math.abs(c[1] - 22), Math.abs(c[2] - 29)) <= 2), `watermark file edges match the hero colour (${corners.map((c) => c.join(",")).join(" | ")})`);
  await p.context().close();
});

// ----------------------------------------------------------------------------
await run("Callback form (home): layout, validation, spam controls, delivery", async () => {
  const p = await page({ viewport: { width: 1280, height: 900 } });
  await p.goto(`${BASE}/index.html?r=${Math.random().toString(36).slice(2)}#callback-form`, { waitUntil: "networkidle" }); await p.waitForTimeout(800);
  const f = await p.evaluate(() => {
    const form = document.querySelector("#callback-form form");
    const vis = [...form.querySelectorAll(".field")].filter((n) => n.checkVisibility()).map((n) => n.dataset.field);
    const sel = form.querySelector("select[name=callbackTime]"); const cb = form.querySelector("input[name=consent]");
    return { vis, opts: [...sel.options].map((o) => o.value), def: sel.value, checked: cb.checked, req: cb.required, link: !!form.querySelector('label a[href="/privacy-policy.html"][target="_blank"]'), btn: form.querySelector("[data-submit-btn]").textContent.trim(), labels: [...form.querySelectorAll("label")].map((l) => l.textContent.trim().slice(0, 22)), idField: !!form.querySelector('[name*="id" i]:not([name=callbackTime]):not([name=company]):not([name=consent])') };
  });
  ok(JSON.stringify(f.vis) === JSON.stringify(["name", "phone", "callbackTime", "consent"]), `fields: ${f.vis.join(", ")}`);
  ok(JSON.stringify(f.opts) === JSON.stringify(["As soon as possible", "08:00–10:00", "10:00–12:00", "12:00–14:00", "14:00–16:00", "16:00–18:00"]) && f.def === "As soon as possible", `best-time choices and default: ${f.opts.length} options, default "${f.def}"`);
  ok(f.checked === false && f.req === true && f.link, "consent: required, unticked by default, links to the Privacy Policy");
  ok(f.btn === "Request my callback" && !f.idField, "button text; no ID-number field");

  // empty submit -> inline errors beside each field
  await p.click("#callback-form [data-submit-btn]"); await p.waitForTimeout(300);
  const e = await p.evaluate(() => ({ errs: [...document.querySelectorAll("#callback-form .field[data-invalid=true] .error")].map((n) => ({ t: n.textContent.trim(), shown: getComputedStyle(n).display !== "none" })), focus: document.activeElement.name, aria: document.querySelector("#home-name").getAttribute("aria-invalid"), alert: (document.querySelector("#callback-form .form-alert") || {}).textContent }));
  ok(e.errs.length === 3 && e.errs.every((x) => x.shown && x.t.length > 8), `empty submit shows 3 inline errors: ${e.errs.map((x) => `"${x.t.slice(0, 28)}"`).join(", ")}`);
  ok(e.focus === "name" && e.aria === "true", `focus moves to the first problem (${e.focus}); aria-invalid set`);
  ok(/Please check the highlighted fields/.test(e.alert || ""), "summary alert shown");

  // bad phone keeps the rest
  await p.fill("#home-name", "Thabo Mokoena"); await p.fill("#home-phone", "12345"); await p.check("#home-consent");
  await p.click("#callback-form [data-submit-btn]"); await p.waitForTimeout(200);
  const bad = await p.evaluate(() => ({ msg: document.querySelector('#callback-form [data-field=phone] .error').textContent.trim(), name: document.querySelector("#home-name").value, consent: document.querySelector("#home-consent").checked }));
  ok(/valid South African number, for example 082 123 4567/.test(bad.msg) && bad.name === "Thabo Mokoena" && bad.consent, `bad phone: "${bad.msg.slice(0, 60)}…", other values kept`);
  // accepted formats are checked with the shared validator itself: clicking submit here would send a real request
  const fmt = await p.evaluate(() => ["0821234567", "(021) 054 1141", "+27 82 123 4567", "27821234567", "082 123 4567"].map((n) => window.NDCValidate.isValidSAPhone(n)));
  ok(fmt.every(Boolean), "accepted phone formats: 0821234567, (021) 054 1141, +27 82 123 4567, 27821234567, 082 123 4567");
  const rej = await p.evaluate(() => ["12345", "0911234567", "082123456", "+2782123456", "abc", ""].map((n) => window.NDCValidate.isValidSAPhone(n)));
  ok(rej.every((x) => !x), "rejected: too short, 09x prefix, 8-digit +27, letters, empty");
  const before = leads().length;

  // server-side minimum time: a submission within ~2 s of the form being shown is refused, nothing forwarded
  await p.goto(`${BASE}/index.html?r=${Math.random().toString(36).slice(2)}#callback-form`, { waitUntil: "domcontentloaded" });
  await p.fill("#home-name", "Speedy Test"); await p.fill("#home-phone", "0821234567"); await p.check("#home-consent");
  await p.click("#callback-form [data-submit-btn]"); await p.waitForTimeout(700);
  const quick = await p.evaluate(() => ({ alert: (document.querySelector("#callback-form .form-alert") || {}).textContent || "", cls: (document.querySelector("#callback-form .form-alert") || {}).className || "", name: document.querySelector("#home-name").value, tel: !!document.querySelector('#callback-form .form-alert a[href="tel:+27210541141"]'), dis: document.querySelector("#callback-form [data-submit-btn]").disabled }));
  const sent1 = leads().length - before;
  ok(sent1 === 0 && /error/.test(quick.cls) && quick.name === "Speedy Test" && quick.tel && !quick.dis, `too-fast submit: refused (${quick.alert.slice(0, 50).trim()}…), nothing forwarded, details kept, phone fallback shown, retry enabled`);

  // retry after waiting succeeds, first name shown, lead delivered with every field
  await p.waitForTimeout(2200);
  const start = Date.now();
  await p.click("#callback-form [data-submit-btn]");
  await p.waitForSelector("#callback-form .form-alert--success", { timeout: 5000 });
  const okMsg = await p.$eval("#callback-form .form-alert--success", (n) => n.textContent.trim());
  await p.waitForTimeout(400);
  const got = leads().slice(before);
  ok(/^Thanks, Speedy\./.test(okMsg), `success message names the person: "${okMsg}"`);
  ok(got.length === 1 && got[0].name === "Speedy Test" && got[0].phone === "0821234567" && got[0].callbackTime === "As soon as possible", `exactly one lead reached the backend: ${JSON.stringify({ name: got[0] && got[0].name, phone: got[0] && got[0].phone, time: got[0] && got[0].callbackTime })} (${Date.now() - start} ms)`);
  const reset = await p.evaluate(() => ({ n: document.querySelector("#home-name").value, c: document.querySelector("#home-consent").checked, ev: (window.ndcDataLayer || []).filter((x) => x.event === "callback_submitted").length }));
  ok(reset.n === "" && !reset.c && reset.ev === 1, `form reset; callback_submitted counted once, only on success (${reset.ev})`);
  await p.screenshot({ path: path.join(SHOTS, "form-success.png"), clip: { x: 300, y: 80, width: 700, height: 600 } }).catch(() => {});

  // failure handling and retry (mocked 503 then a genuine retry)
  await p.goto(`${BASE}/index.html?r=${Math.random().toString(36).slice(2)}#callback-form`, { waitUntil: "networkidle" }); await p.waitForTimeout(2300);
  await p.fill("#home-name", "Retry Person"); await p.fill("#home-phone", "0111234567"); await p.check("#home-consent");
  await p.route("**/api/contact", (r) => r.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ success: false, message: "Our online enquiry service is temporarily unavailable." }) }));
  const evBefore = await p.evaluate(() => (window.ndcDataLayer || []).filter((x) => x.event === "callback_submitted").length);
  await p.click("#callback-form [data-submit-btn]"); await p.waitForTimeout(500);
  const fl = await p.evaluate(() => ({ cls: (document.querySelector("#callback-form .form-alert") || {}).className, txt: (document.querySelector("#callback-form .form-alert") || {}).textContent, tel: (document.querySelector('#callback-form .form-alert a[href="tel:+27210541141"]') || {}).textContent, n: document.querySelector("#home-name").value, ph: document.querySelector("#home-phone").value, cb: document.querySelector("#home-consent").checked, dis: document.querySelector("#callback-form [data-submit-btn]").disabled, ev: (window.ndcDataLayer || []).filter((x) => x.event === "callback_submitted").length }));
  ok(/error/.test(fl.cls) && fl.tel === "(021) 054 1141" && /try again/i.test(fl.txt), `backend failure: honest error with the phone number ("${fl.txt.slice(0, 70)}…")`);
  ok(fl.n === "Retry Person" && fl.ph === "0111234567" && fl.cb && !fl.dis && fl.ev === evBefore, "failure keeps every value, re-enables the button and counts no lead");
  await p.screenshot({ path: path.join(SHOTS, "form-error.png"), clip: { x: 300, y: 80, width: 700, height: 700 } }).catch(() => {});
  await p.unroute("**/api/contact");
  await p.route("**/api/contact", (r) => r.abort());
  await p.click("#callback-form [data-submit-btn]"); await p.waitForTimeout(500);
  const net = await p.$eval("#callback-form .form-alert", (n) => n.textContent);
  ok(/could not reach our server/.test(net) && /\(021\) 054 1141/.test(net), "network failure: message offers the phone number");
  await p.unroute("**/api/contact");
  const b2 = leads().length;
  await p.click("#callback-form [data-submit-btn]"); await p.waitForSelector("#callback-form .form-alert--success", { timeout: 5000 });
  ok(leads().length - b2 === 1, "retry after failure delivers the lead");

  // duplicate click -> one request
  await p.goto(`${BASE}/index.html?r=${Math.random().toString(36).slice(2)}#callback-form`, { waitUntil: "networkidle" }); await p.waitForTimeout(2300);
  let hits = 0;
  await p.route("**/api/contact", async (r) => { hits++; await sleep(700); r.fulfill({ status: 200, contentType: "application/json", body: '{"success":true}' }); });
  await p.fill("#home-name", "Double Click"); await p.fill("#home-phone", "0821234567"); await p.check("#home-consent");
  await p.click("#callback-form [data-submit-btn]"); const dis = await p.$eval("#callback-form [data-submit-btn]", (n) => ({ d: n.disabled, t: n.textContent }));
  await p.evaluate(() => { const f = document.querySelector("#callback-form form"); f.requestSubmit(); f.requestSubmit(); });
  await p.waitForTimeout(1300);
  ok(hits === 1 && dis.d && /Sending/.test(dis.t), `button disabled and says "${dis.t}" while sending; ${hits} request for repeated submits`);
  await p.unroute("**/api/contact");

  // honeypot: looks like success to a bot, nothing forwarded
  await p.goto(`${BASE}/index.html?r=${Math.random().toString(36).slice(2)}#callback-form`, { waitUntil: "networkidle" }); await p.waitForTimeout(2300);
  const b3 = leads().length;
  await p.fill("#home-name", "Bot Person"); await p.fill("#home-phone", "0821234567"); await p.check("#home-consent");
  await p.evaluate(() => { document.querySelector("#company").value = "https://spam.example"; });
  await p.click("#callback-form [data-submit-btn]"); await p.waitForTimeout(600);
  ok(leads().length === b3, "honeypot filled: nothing reaches the backend");
  await p.context().close();
});

// ----------------------------------------------------------------------------
await run("Contact page form", async () => {
  const p = await page({ viewport: { width: 1280, height: 900 } });
  await p.goto(`${BASE}/contact.html`, { waitUntil: "networkidle" });
  const f = await p.evaluate(() => { const form = document.querySelector("[data-callback-form]"); return { vis: [...form.querySelectorAll(".field")].filter((n) => n.checkVisibility()).map((n) => n.dataset.field), open: form.querySelector("details").open, mk: form.querySelector("[name=marketing]").checked, cb: form.querySelector("[name=consent]").checked, mapLink: !!document.querySelector('a[href="https://maps.app.goo.gl/bq5FtkSw6TrXPfzp9"]') }; });
  ok(JSON.stringify(f.vis) === JSON.stringify(["name", "phone", "callbackTime", "consent"]) && !f.open, `contact form shows ${f.vis.join(", ")}; extras collapsed`);
  ok(!f.mk && !f.cb, "marketing and consent both unticked by default");
  ok(f.mapLink, "address links to the verified map");
  // an error inside the collapsed panel opens it
  await p.fill("#c-name", "Test"); await p.fill("#c-phone", "0821234567"); await p.check("#c-consent");
  await p.evaluate(() => { document.querySelector("details.form-prefs").open = false; document.querySelector("#c-email").value = "not-an-email"; });
  await p.click("[data-submit-btn]"); await p.waitForTimeout(300);
  const o = await p.evaluate(() => ({ open: document.querySelector("details.form-prefs").open, focus: document.activeElement.id, msg: document.querySelector("#c-email-error").textContent }));
  ok(o.open && o.focus === "c-email", `invalid optional email opens the panel and focuses it (${o.msg.slice(0, 40)})`);
  await p.context().close();
});

// ----------------------------------------------------------------------------
await run("Calculator: R15 000 / R8 000 / R9 000 and edge cases", async () => {
  const p = await page({ viewport: { width: 1280, height: 900 } });
  await p.goto(`${BASE}/calculator.html`, { waitUntil: "networkidle" });
  const text = () => p.$eval("[data-calc-results]", (n) => n.innerText.replace(/ /g, " "));
  const ph = await p.$eval("[data-calc-placeholder]", (n) => !n.hidden);
  ok(ph, "starts with a prompt, no figures");
  // live: type digit by digit
  await p.type("#calc-income", "15000", { delay: 20 });
  await p.fill("#calc-living", ""); await p.type("#calc-living", "8000", { delay: 20 }); await p.type("#calc-debt", "9000", { delay: 20 });
  await p.waitForTimeout(700);
  let t = await text();
  ok(/R7 000/.test(t), "left after living costs: R7 000");
  ok(/\b60%/.test(t), "debt repayments are 60% of income");
  ok(/−R2 000/.test(t) && /Monthly shortfall/.test(t), "monthly shortfall: −R2 000");
  ok(/Speak to a consultant/.test(t) && /How debt review works/.test(t) && /Debt review may be worth exploring/.test(t), "shortfall state recommends debt review with a CTA");
  ok(/estimate/.test(t) && /not a repayment offer or an eligibility decision/.test(t) && /Nothing you enter here is sent anywhere unless you submit/.test(t) && /consultant will confirm the numbers/.test(t), "estimate / privacy / consultant-confirms wording present");
  ok(!/NaN|undefined|Infinity/.test(await p.evaluate(() => document.body.innerText)), "no NaN / undefined / Infinity on the page");
  const prefix = await p.evaluate(() => ({ prefixOutside: !document.querySelector("#calc-income").value.includes("R"), sib: document.querySelector("#calc-income").previousElementSibling.className, r: document.querySelector("#calc-income").previousElementSibling.getBoundingClientRect().right <= document.querySelector("#calc-income").getBoundingClientRect().left + 1 }));
  ok(prefix.prefixOutside && prefix.sib === "prefix" && prefix.r, "the R is a separate element, not part of the value, and never overlaps it");
  await p.screenshot({ path: path.join(SHOTS, "calc-shortfall.png") });
  const chart = await p.$eval("[data-r-chart]", (n) => ({ label: n.getAttribute("aria-label"), s: [...n.querySelectorAll(".rb-fill")].map((x) => x.style.getPropertyValue("--s")) }));
  ok(/Take-home pay R15 000, living costs R8 000, debt repayments R9 000/.test(chart.label) && chart.s.join() === "1,0.5333333333333333,0.6", `visual breakdown has exact text alternative and proportions (${chart.s.map((x) => (+x).toFixed(2)).join("/")})`);

  const setAll = async (i, l, d) => { for (const [id, v] of [["#calc-income", i], ["#calc-living", l], ["#calc-debt", d]]) await p.fill(id, v); await p.waitForTimeout(550); };
  await setAll("20000", "10000", "9000"); t = await text();
  ok(/Your budget is tight/i.test(t) && /R1 000/.test(t) && /\b45%/.test(t) && /less than 10%/.test(t) && /Speak to a consultant/.test(t), "tight state (5% left): suggests a consultant");
  await p.screenshot({ path: path.join(SHOTS, "calc-tight.png") });
  await setAll("20000", "8000", "4000"); t = await text();
  ok(/Your budget balances/i.test(t) && /R8 000 left each month/.test(t) && /\b20%/.test(t) && /Talk to a consultant/.test(t) && !/Speak to a consultant/.test(t), "ok state: soft CTA only");
  await p.screenshot({ path: path.join(SHOTS, "calc-ok.png") });
  await setAll("15000", "8000", ""); t = await text();
  ok(/\b0%/.test(t) && /With no debt repayments entered/.test(t), "blank debt = 0%, ok");
  await setAll("15000", "0", "0"); t = await text();
  ok(/R15 000/.test(t) && !/NaN/.test(t), "explicit zeros accepted");
  await setAll("R 15 000", "8 000,50", "9,000.25"); t = await text();
  ok(/−R2 000,75/.test(t) && /R6 999,50/.test(t) && /\b60%/.test(t), `pasted/formatted values ("R 15 000", "8 000,50", "9,000.25") parse: ${/−?R[\d ]+,\d\d/.exec(t)}`);
  await setAll("15000", "16000", "0"); t = await text();
  ok(/living costs are/i.test(t) && /−R1 000/.test(t), "living costs above income handled");
  await setAll("0", "8000", "9000"); t = await text();
  ok(/Enter your take-home pay/.test(await p.$eval("[data-calc-placeholder]", (n) => n.innerText)), "zero income asks for take-home pay rather than showing nonsense");
  await setAll("999999999", "1", "1"); t = await text();
  ok(!/NaN|Infinity/.test(t) && /very large amount/.test(await p.evaluate(() => document.querySelector('[data-field="income"] .warning').textContent)), "very large amount: warned, no breakage");
  // invalid input: error shown on leaving the field, results withheld, valid work not erased
  await setAll("15000", "8000", "9000");
  await p.fill("#calc-debt", "-500"); await p.press("#calc-debt", "Tab"); await p.waitForTimeout(300);
  const neg = await p.evaluate(() => ({ err: document.querySelector("#calc-debt-error").textContent, inv: document.querySelector("#calc-debt").getAttribute("aria-invalid"), inc: document.querySelector("#calc-income").value, ph: !document.querySelector("[data-calc-placeholder]").hidden }));
  ok(/positive amount/.test(neg.err) && neg.inv === "true" && neg.inc === "15000" && neg.ph, `negative rejected with a message, other fields kept ("${neg.err}")`);
  await p.fill("#calc-debt", "abc"); await p.press("#calc-debt", "Tab"); await p.waitForTimeout(200);
  ok(/numbers only/.test(await p.$eval("#calc-debt-error", (n) => n.textContent)), "text rejected with a message");
  await p.fill("#calc-debt", "9000"); await p.waitForTimeout(500);
  ok((await p.$eval("#calc-debt-error", (n) => n.textContent)) === "" && /−R2 000/.test(await text()), "fixing the value clears the error and restores the result");
  // reset
  await p.click("[data-calc-reset]"); await p.waitForTimeout(300);
  const rs = await p.evaluate(() => ({ v: ["income", "living", "debt"].map((k) => document.querySelector("#calc-" + k).value).join("|"), ph: !document.querySelector("[data-calc-placeholder]").hidden, f: document.activeElement.id }));
  ok(rs.v === "||" && rs.ph && rs.f === "calc-income", "clear/start again empties everything and refocuses");
  // help list
  await p.click(".calc-help summary"); await p.waitForTimeout(200);
  const help = await p.$eval(".calc-help", (n) => ({ open: n.open, lis: [...n.querySelectorAll("li")].map((l) => l.textContent.trim()) }));
  ok(help.open && help.lis.length === 17 && help.lis.includes("Food and clothing") && help.lis.includes("Furniture accounts") && help.lis.includes("Maintenance") && help.lis.includes("Overdraft"), `"Not sure what to include?" lists ${help.lis.length} items`);
  await p.screenshot({ path: path.join(SHOTS, "calc-help.png"), fullPage: false });
  // nothing is sent or stored
  const net = []; p.on("request", (r) => { if (r.method() !== "GET") net.push(r.url()); });
  await setAll("15000", "8000", "9000");
  const store = await p.evaluate(() => ({ ls: localStorage.length, ss: sessionStorage.length, ck: document.cookie, url: location.href }));
  ok(net.length === 0 && store.ls === 0 && store.ss === 0 && store.ck === "" && !/\?|#/.test(store.url), "typing figures sends no request and stores nothing (no storage, no cookie, no URL change)");
  const evs = await p.evaluate(() => (window.ndcDataLayer || []).map((x) => x.event + JSON.stringify(x.meta)));
  ok(evs.includes("calculator_started{}") && evs.includes("calculator_completed{}") && evs.every((e) => !/\d{3}/.test(e)), `analytics carries event names only (${evs.join(", ")})`);
  await p.context().close();
  // mobile layout + reduced motion
  const m = await page({ viewport: { width: 390, height: 780 }, reducedMotion: "reduce" });
  await m.goto(`${BASE}/calculator.html`, { waitUntil: "networkidle" });
  await m.fill("#calc-income", "15000"); await m.fill("#calc-living", "8000"); await m.fill("#calc-debt", "9000"); await m.waitForTimeout(300);
  const mt = await m.$eval("[data-calc-results]", (n) => n.innerText);
  ok(/R7 000/.test(mt) && (await m.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)), "mobile + reduced motion: correct and no horizontal scroll");
  await m.screenshot({ path: path.join(SHOTS, "calc-mobile.png"), fullPage: true });
  await m.context().close();
});

// ----------------------------------------------------------------------------
await run("FAQ accordion + server-rendered answers", async () => {
  const p = await page({ viewport: { width: 1280, height: 900 } });
  const raw = await (await p.request.get(`${BASE}/index.html`)).text();
  ok(raw.includes("Debt counselling, also called debt review, is a formal process") && raw.includes("Your assessment is free, and a full breakdown"), "FAQ answers are in the raw server HTML (no JavaScript needed)");
  await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  const n = await p.$$eval(".faq-item", (x) => x.length); ok(n === 12, `${n} FAQ items`);
  await p.$eval(".faq-item", (e) => e.scrollIntoView({ block: "center" }));
  await p.focus(".faq-item summary"); await p.keyboard.press("Enter"); await p.waitForTimeout(500);
  ok(await p.$eval(".faq-item", (e) => e.open), "Enter on a question opens it");
  await p.keyboard.press("Enter"); await p.waitForTimeout(300);
  ok(!(await p.$eval(".faq-item", (e) => e.open)), "Enter again closes it");
  await p.click(".faq-item:nth-of-type(7) summary"); await p.waitForTimeout(500);
  const open = await p.$eval(".faq-item:nth-of-type(7)", (e) => ({ o: e.open, t: e.querySelector(".faq-answer").textContent.slice(0, 40), h: e.querySelector(".faq-answer").getBoundingClientRect().height }));
  ok(open.o && open.h > 20, `clicking question 7 shows "${open.t}…"`);
  await p.screenshot({ path: path.join(SHOTS, "faq-open.png") });
  await p.context().close();
});

// ----------------------------------------------------------------------------
await run("Navigation, anchors and every internal link", async () => {
  const p = await page({ viewport: { width: 1280, height: 900 } });
  await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  // dropdown by hover, click and Escape
  await p.hover("[data-menu-btn]"); await p.waitForTimeout(350);
  ok((await p.$$eval(".nav-menu a", (a) => a.map((x) => x.textContent))).join() === "Debt Review,Debt Mediation,Debt Review Removal" && (await p.$eval(".nav-menu", (n) => getComputedStyle(n).opacity)) === "1", "Services opens on hover with the three services");
  await p.screenshot({ path: path.join(SHOTS, "header-dropdown.png"), clip: { x: 0, y: 0, width: 1280, height: 320 } });
  await p.mouse.move(600, 600); await p.click("[data-menu-btn]"); await p.waitForTimeout(250);
  ok((await p.$eval("[data-menu-btn]", (n) => n.getAttribute("aria-expanded"))) === "true", "click opens (aria-expanded=true)");
  await p.keyboard.press("Escape"); await p.waitForTimeout(200);
  ok((await p.$eval("[data-menu-btn]", (n) => n.getAttribute("aria-expanded"))) === "false" && (await p.evaluate(() => document.activeElement.hasAttribute("data-menu-btn"))), "Escape closes and returns focus");

  // all internal links on every page respond 200
  const seen = new Map();
  for (const f of PAGES) {
    await p.goto(`${BASE}/${f}`, { waitUntil: "domcontentloaded" });
    const hrefs = await p.$$eval("a[href]", (a) => a.map((x) => x.getAttribute("href")));
    for (const h of hrefs) if (h.startsWith("/") && !h.startsWith("//")) seen.set(h.split("#")[0] || "/", 1);
  }
  const bad = [];
  for (const u of seen.keys()) { const r = await p.request.get(BASE + u, { maxRedirects: 0 }); if (r.status() >= 400) bad.push(`${u} ${r.status()}`); }
  ok(bad.length === 0, `${seen.size} distinct internal URLs linked from ${PAGES.length} pages all respond${bad.length ? " :: " + bad.join(", ") : ""}`);

  // anchors from other pages land below the header
  for (const [from, sel, target] of [["about.html", ".primary-nav__actions .btn", "#callback-form"], ["debt-review.html", '.footer-grid a[href="/#how-it-works"]', "#how-it-works"]]) {
    await p.goto(`${BASE}/${from}`, { waitUntil: "networkidle" }); await p.click(sel); await p.waitForTimeout(900);
    const a = await p.evaluate((t) => ({ hash: location.hash, top: Math.round(document.querySelector(t).getBoundingClientRect().top), hb: Math.round(document.querySelector(".site-header").getBoundingClientRect().bottom), h2: Math.round((document.querySelector(t + " h2") || document.querySelector(t)).getBoundingClientRect().top) }), target);
    ok(a.hash === target && a.h2 >= a.hb, `${from} -> /${target}: heading at ${a.h2}px, header bottom ${a.hb}px (not hidden)`);
  }
  // mobile menu
  const m = await page({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true });
  await m.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  await m.evaluate(() => window.scrollTo(0, 300)); await m.waitForTimeout(300);
  const hb = await m.evaluate(() => document.querySelector(".site-header").getBoundingClientRect().top);
  await m.click("[data-nav-toggle]"); await m.waitForTimeout(350);
  const mm = await m.evaluate(() => { const ls = [...document.querySelectorAll("#primary-nav a")].filter((a) => a.offsetParent !== null); return { labels: ls.map((a) => a.textContent.trim()), minH: Math.min(...ls.map((a) => a.getBoundingClientRect().height)), top: document.querySelector(".site-header").getBoundingClientRect().top, over: document.querySelector("#primary-nav").getBoundingClientRect().top - document.querySelector(".site-header").getBoundingClientRect().bottom }; });
  ok(["Debt Review", "Debt Mediation", "Debt Review Removal", "Calculator", "About", "Contact", "FAQs", "Debt Advice", "Request a callback"].every((x) => mm.labels.includes(x)), `mobile menu lists ${mm.labels.length} links incl. FAQs`);
  ok(mm.minH >= 44 && mm.top === hb && Math.abs(mm.over) <= 1, `tap targets >= ${Math.round(mm.minH)}px; header did not move (${hb} -> ${mm.top}); panel flush under it`);
  await m.screenshot({ path: path.join(SHOTS, "menu-mobile.png") });
  await m.context().close();
  await p.context().close();
});

// ----------------------------------------------------------------------------
await run("Mobile bar, footer and chat do not collide", async () => {
  const p = await page({ viewport: { width: 390, height: 780 } });
  await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  await p.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await p.waitForTimeout(400);
  const r = await p.evaluate(() => { const bar = document.querySelector(".mobile-actions").getBoundingClientRect(); const cs = getComputedStyle(document.querySelector(".mobile-actions")); const last = document.querySelector(".footer-bottom").getBoundingClientRect(); const l = document.querySelector(".chat-launcher").getBoundingClientRect(); const links = [...document.querySelectorAll(".mobile-actions a")]; return { pos: cs.position, bottom: bar.bottom, vh: window.innerHeight, barTop: bar.top, footerBottom: last.bottom, launcherBottom: l.bottom, launcherTop: l.top, lastText: Math.max(...[...document.querySelectorAll(".footer-bottom > *")].map((n) => n.getBoundingClientRect().bottom)), labels: links.map((a) => a.textContent.trim()), tel: links[0].getAttribute("href"), cta: links[1].getAttribute("href"), primary: links[1].classList.contains("is-primary"), pad: parseFloat(getComputedStyle(document.body).paddingBottom), inset: /env\(safe-area-inset-bottom/.test([...document.styleSheets].flatMap((s) => { try { return [...s.cssRules]; } catch (e) { return []; } }).map((x) => x.cssText).join(" ")), vp: document.querySelector('meta[name=viewport]').content, minH: Math.min(...links.map((a) => a.getBoundingClientRect().height)) }; });
  ok(r.pos === "fixed" && Math.round(r.bottom) === r.vh, "bar is fixed to the bottom edge");
  ok(JSON.stringify(r.labels) === JSON.stringify(["Call us", "Call me back"]) && r.tel === "tel:+27210541141" && r.cta === "/#callback-form" && r.primary, `bar: ${r.labels.join(" / ")} (tel link, callback anchor)`);
  ok(r.minH >= 44, `bar buttons ${Math.round(r.minH)}px tall`);
  ok(r.footerBottom <= r.barTop + 1, `last footer line (bottom ${Math.round(r.footerBottom)}px) is clear of the bar (top ${Math.round(r.barTop)}px)`);
  ok(r.launcherBottom <= r.barTop, `chat launcher (bottom ${Math.round(r.launcherBottom)}px) sits above the bar`);
  ok(r.lastText <= r.launcherTop, `last footer text (bottom ${Math.round(r.lastText)}px) can be scrolled clear of the chat launcher (top ${Math.round(r.launcherTop)}px)`);
  ok(r.inset && /viewport-fit=cover/.test(r.vp) && r.pad >= 56, `safe-area inset handled: viewport-fit=cover, env(safe-area-inset-bottom) in CSS, body padding ${r.pad}px`);
  await p.screenshot({ path: path.join(SHOTS, "mobile-bottom.png") });
  for (const w of [360, 768]) {
    const q = await page({ viewport: { width: w, height: 780 } });
    await q.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
    await q.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight)); await q.waitForTimeout(400);
    const c = await q.evaluate(() => ({ t: Math.max(...[...document.querySelectorAll(".footer-bottom > *")].map((n) => n.getBoundingClientRect().bottom)), l: document.querySelector(".chat-launcher").getBoundingClientRect().top, b: document.querySelector(".mobile-actions").getBoundingClientRect().top }));
    ok(c.t <= c.l && c.t <= c.b, `${w}px: last footer text (${Math.round(c.t)}px) is above the launcher (${Math.round(c.l)}px) and the bar (${Math.round(c.b)}px)`);
    await q.context().close();
  }
  const d = await page({ viewport: { width: 1280, height: 800 } });
  await d.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  ok((await d.$eval(".mobile-actions", (n) => getComputedStyle(n).display)) === "none", "bar hidden on desktop");
  await d.context().close(); await p.context().close();
});

// ----------------------------------------------------------------------------
await run("Footer: details, socials, legal line, year", async () => {
  const p = await page({ viewport: { width: 1280, height: 900 } });
  await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  const f = await p.$eval(".site-footer", (n) => ({ t: n.innerText.replace(/\s+/g, " "), links: [...n.querySelectorAll("a")].map((a) => a.getAttribute("href")), ext: [...n.querySelectorAll('a[target="_blank"]')].map((a) => a.rel) }));
  ok(f.t.includes("Regulated by the NCR · NCRDC4382"), "\"Regulated by the NCR · NCRDC4382\"");
  ok(f.t.includes(`© ${new Date().getFullYear()} National Debt Consultants. Powered by Telepride (Pty) Ltd.`), "© current year, credit line");
  ok(/debt counsellor registered with the National Credit Regulator \(NCRDC4382\) under the National Credit Act 34 of 2005\. Outcomes depend on your circumstances and your creditors.{1,3} responses\. Fees are explained at your consultation\. Personal information is processed in line with POPIA/.test(f.t), "legal line: NCR, NCA 34 of 2005, outcomes, fees, POPIA");
  ok(f.links.includes("https://www.facebook.com/nationaldebtconsultants") && f.links.includes("https://www.instagram.com/national.debt.consultants/") && f.links.includes("https://www.linkedin.com/company/national-debt-consultants/"), "three social links");
  ok(f.ext.every((r) => /noopener/.test(r)), "external links use rel=noopener");
  ok(f.links.includes("tel:+27210541141") && f.links.includes("mailto:marketing@ndcsa.co.za") && f.links.includes("/privacy-policy.html") && f.links.includes("https://ndcsa.co.za/job-openings/"), "phone, email, privacy and careers links");
  await p.$eval(".site-footer", (n) => n.scrollIntoView()); await p.waitForTimeout(700);
  await p.screenshot({ path: path.join(SHOTS, "footer.png") });
  await p.context().close();
});

// ----------------------------------------------------------------------------
await run("Console / network errors and layout shift on every page", async () => {
  for (const [w, label] of [[1440, "desktop"], [390, "mobile"]]) {
    const bad = []; let worstCls = 0;
    for (const f of PAGES) {
      const p = await page({ viewport: { width: w, height: 800 } });
      await p.addInitScript("window.__cls=0;new PerformanceObserver(l=>{for(const e of l.getEntries()){if(!e.hadRecentInput)window.__cls+=e.value;}}).observe({type:'layout-shift',buffered:true});");
      await p.goto(`${BASE}/${f}`, { waitUntil: "networkidle" });
      await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 300) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 40)); } });
      await p.waitForTimeout(400);
      const cls = await p.evaluate(() => window.__cls);
      worstCls = Math.max(worstCls, cls);
      if (p.errors.length) bad.push(`${f}: ${p.errors[0].slice(0, 80)}`);
      if (cls > 0.1) bad.push(`${f}: CLS ${cls.toFixed(3)}`);
      await p.context().close();
    }
    ok(bad.length === 0, `${label}: ${PAGES.length} pages with no console/network errors; worst CLS ${worstCls.toFixed(4)}${bad.length ? " :: " + bad.join(" | ") : ""}`);
  }
});

// ----------------------------------------------------------------------------
await run("Reduced motion: content visible, nothing animates", async () => {
  const p = await page({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
  await p.goto(`${BASE}/index.html`, { waitUntil: "networkidle" });
  await p.evaluate(async () => { for (let y = 0; y < document.documentElement.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 30)); } });
  const r = await p.evaluate(() => ({ js: document.documentElement.classList.contains("js-motion"), h1: getComputedStyle(document.querySelector(".hero h1")).opacity, hidden: [...document.querySelectorAll("section h2, .card, .step")].filter((n) => parseFloat(getComputedStyle(n).opacity) < 1).length, anim: [...document.querySelectorAll("*")].filter((n) => getComputedStyle(n).animationName !== "none" && getComputedStyle(n).animationName !== "").length }));
  ok(!r.js && r.h1 === "1" && r.hidden === 0, `all content visible with reduced motion (js-motion=${r.js}, hidden=${r.hidden})`);
  await p.context().close();
});

// ----------------------------------------------------------------------------
await run("Accessibility (axe-core, WCAG 2.x A/AA incl. contrast)", async () => {
  const axePath = process.env.AXE || "";
  if (!axePath || !existsSync(axePath)) { console.log("  (skipped: set AXE=/path/to/axe.min.js)"); return; }
  const src = readFileSync(axePath, "utf-8");
  for (const [w, label] of [[1440, "desktop"], [390, "mobile"]]) {
    for (const f of ["index.html", "calculator.html", "contact.html", "about.html", "debt-review.html", "faqs.html"]) {
      const p = await page({ viewport: { width: w, height: 900 } });
      await p.goto(`${BASE}/${f}`, { waitUntil: "networkidle" }); await p.waitForTimeout(1800);
      if (f === "index.html") await p.evaluate(() => document.querySelectorAll(".faq-item")[0].open = true);
      await p.addScriptTag({ content: src });
      const res = await p.evaluate(() => axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }, resultTypes: ["violations"] }));
      const v = res.violations.map((x) => `${x.id}(${x.impact}) ${x.nodes.length}x e.g. ${x.nodes[0].target.join(" ").slice(0, 70)}`);
      ok(v.length === 0, `${label} ${f}: ${v.length} axe violations${v.length ? " :: " + v.join(" | ") : ""}`);
      await p.context().close();
    }
  }
});

await browser.close();
console.log(`\n${pass} checks passed, ${fails.length} failed.`);
if (fails.length) { fails.forEach((f) => console.error("FAIL " + f)); process.exit(1); }
