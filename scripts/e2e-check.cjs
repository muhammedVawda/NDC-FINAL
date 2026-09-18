const { chromium } = require("playwright");

const BASE = "http://localhost:8080";
const PAGES = [
  "/", "/debt-review.html", "/debt-mediation.html", "/debt-review-removal.html",
  "/about.html", "/calculator.html", "/contact.html", "/faqs.html",
  "/privacy-policy.html", "/terms.html", "/404.html",
];

let failures = 0;
function fail(msg) { failures++; console.error("FAIL: " + msg); }
function ok(msg) { console.log("ok: " + msg); }

async function checkNoHorizontalScroll(page, url, width) {
  const scrollInfo = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  if (scrollInfo.scrollWidth > scrollInfo.clientWidth + 1) {
    fail(`${url} @ ${width}px has horizontal scroll (scrollWidth=${scrollInfo.scrollWidth} clientWidth=${scrollInfo.clientWidth})`);
  } else {
    ok(`${url} @ ${width}px no horizontal scroll`);
  }
}

async function main() {
const browser = await chromium.launch();

// ---- 1. Every page loads with no console errors, at mobile + desktop widths ----
for (const width of [375, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  for (const url of PAGES) {
    const page = await context.newPage();
    const consoleErrors = [];
    page.on("pageerror", (e) => consoleErrors.push(String(e)));
    page.on("console", (msg) => {
      if (msg.type() !== "error") return;
      // This sandbox's outbound network proxy intercepts TLS for external
      // domains (e.g. Google Fonts) with its own CA, which Chromium doesn't
      // trust — that's a property of this build environment, not a site
      // bug, and won't occur in normal production hosting.
      if (/ERR_CERT_AUTHORITY_INVALID/.test(msg.text())) return;
      consoleErrors.push(msg.text());
    });
    const response = await page.goto(BASE + url, { waitUntil: "networkidle" });
    if (!response || response.status() >= 400) {
      fail(`${url} returned status ${response ? response.status() : "no response"}`);
    } else {
      ok(`${url} loaded (${response.status()})`);
    }
    await checkNoHorizontalScroll(page, url, width);
    if (consoleErrors.length) {
      fail(`${url} @ ${width}px console errors: ${consoleErrors.join(" | ")}`);
    }
    if (width === 1440) {
      await page.screenshot({ path: `/tmp/shot-desktop-${url.replace(/\//g, "_") || "home"}.png`, fullPage: true });
    } else {
      await page.screenshot({ path: `/tmp/shot-mobile-${url.replace(/\//g, "_") || "home"}.png`, fullPage: true });
    }
    await page.close();
  }
  await context.close();
}

// ---- 2. Calculator: full keyboard-accessible flow, state A (regression case) ----
{
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.goto(BASE + "/calculator.html", { waitUntil: "networkidle" });

  // Step 1: income — try leaving required field blank first.
  await page.click('[data-step-next]');
  const takeHomeInvalid = await page.getAttribute('[data-field="takeHome"]', "data-invalid");
  if (takeHomeInvalid === "true") ok("calculator: blank required income field blocked with inline error");
  else fail("calculator: blank required income field did NOT show inline error");

  await page.fill("#calc-takeHome", "11000");
  await page.click('.calc-step[data-active="true"] [data-step-next]');

  // Step 2: expenses — enter the regression-case figure.
  await page.waitForSelector('.calc-step[data-step="2"][data-active="true"]');
  await page.fill("#calc-housing", "513788");
  await page.click('.calc-step[data-active="true"] [data-step-next]');

  // Step 3: debts — leave all blank, submit.
  await page.waitForSelector('.calc-step[data-step="3"][data-active="true"]');
  await page.click('.calc-step[data-active="true"] button[type="submit"]');

  await page.waitForSelector('.calc-step[data-step="4"][data-active="true"]');
  const resultText = await page.textContent("[data-calc-results]");
  if (/R502 788 short/.test(resultText)) ok("calculator: regression case shows correct shortfall (R502 788 short)");
  else fail("calculator: regression case did NOT show expected shortfall text. Got: " + resultText.slice(0, 300));
  if (/R5 524|R3 719|savings/i.test(resultText)) fail("calculator: regression case STILL shows fabricated savings/repayment figures");
  else ok("calculator: no fabricated savings/repayment figures present");
  if (/proposal/i.test(resultText) && !/not a formal debt review proposal/i.test(resultText)) {
    // fine either way, just informational
  }

  // Edit -> back to step 1, values preserved
  await page.click('[data-step-edit]');
  await page.waitForSelector('.calc-step[data-step="1"][data-active="true"]');
  const preserved = await page.inputValue("#calc-takeHome");
  if (preserved === "11000") ok("calculator: input preserved after Edit");
  else fail("calculator: input NOT preserved after Edit, got: " + preserved);

  // Large-value warning
  await page.fill("#calc-takeHome", "2000000");
  await page.locator("#calc-takeHome").blur();
  const warn = await page.getAttribute('[data-field="takeHome"]', "data-warning");
  if (warn === "true") ok("calculator: large value triggers non-blocking warning");
  else fail("calculator: large value did NOT trigger warning");

  // Invalid input rejected
  await page.fill("#calc-takeHome", "abc123");
  await page.locator("#calc-takeHome").blur();
  const invalidAttr = await page.getAttribute('[data-field="takeHome"]', "data-invalid");
  if (invalidAttr === "true") ok("calculator: nonnumeric input rejected");
  else fail("calculator: nonnumeric input NOT rejected");

  // Reset — the reset action lives on the results step, so navigate there
  // with valid data first, then reset from step 4.
  await page.fill("#calc-takeHome", "15000");
  await page.click('.calc-step[data-active="true"] [data-step-next]');
  await page.waitForSelector('.calc-step[data-step="2"][data-active="true"]');
  await page.click('.calc-step[data-active="true"] [data-step-next]');
  await page.waitForSelector('.calc-step[data-step="3"][data-active="true"]');
  await page.click('.calc-step[data-active="true"] button[type="submit"]');
  await page.waitForSelector('.calc-step[data-step="4"][data-active="true"]');

  page.once("dialog", (d) => d.accept());
  await page.click('[data-step-reset]');
  await page.waitForSelector('.calc-step[data-step="1"][data-active="true"]');
  const afterReset = await page.inputValue("#calc-takeHome");
  if (afterReset === "") ok("calculator: reset clears fields");
  else fail("calculator: reset did NOT clear fields, got: " + afterReset);

  await context.close();
}

// ---- 3. Calculator: state D (positive surplus) sanity check ----
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE + "/calculator.html", { waitUntil: "networkidle" });
  await page.fill("#calc-takeHome", "20000");
  await page.click('[data-step-next]');
  await page.waitForSelector('.calc-step[data-step="2"][data-active="true"]');
  await page.fill("#calc-housing", "8000");
  await page.click('.calc-step[data-active="true"] [data-step-next]');
  await page.waitForSelector('.calc-step[data-step="3"][data-active="true"]');
  await page.fill("#calc-creditCards", "3000");
  await page.click('.calc-step[data-active="true"] button[type="submit"]');
  await page.waitForSelector('.calc-step[data-step="4"][data-active="true"]');
  const text = await page.textContent("[data-calc-results]");
  if (/R9 000 left over/.test(text)) ok("calculator: state D shows correct positive surplus (R9 000)");
  else fail("calculator: state D surplus incorrect. Got: " + text.slice(0, 300));
  await context.close();
}

// ---- 4. Contact form: client validation + duplicate-submit guard (no backend configured -> honest failure) ----
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE + "/contact.html", { waitUntil: "networkidle" });

  await page.click("[data-submit-btn]");
  const nameInvalid = await page.getAttribute('[data-field="name"]', "data-invalid");
  const phoneInvalid = await page.getAttribute('[data-field="phone"]', "data-invalid");
  const consentInvalid = await page.getAttribute('[data-field="consent"]', "data-invalid");
  if (nameInvalid === "true" && phoneInvalid === "true" && consentInvalid === "true") {
    ok("contact form: empty submit blocked with inline errors on name/phone/consent");
  } else {
    fail(`contact form: empty submit validation incomplete (name=${nameInvalid}, phone=${phoneInvalid}, consent=${consentInvalid})`);
  }

  await page.fill("#c-name", "Thandiwe Nkosi");
  await page.fill("#c-phone", "082 123 4567");
  await page.check("#c-consent");
  await page.click("[data-submit-btn]");
  await page.waitForTimeout(1500);
  const alertText = await page.textContent("[data-form-alert-mount]");
  if (/isn.t fully set up|couldn.t send|couldn.t reach/i.test(alertText || "")) {
    ok("contact form: honest failure shown when backend is not configured (no fake success)");
  } else if (/we've received your request/i.test(alertText || "")) {
    fail("contact form: reported SUCCESS despite no backend being configured — this must never happen");
  } else {
    fail("contact form: unexpected alert state: " + alertText);
  }

  const nameStillFilled = await page.inputValue("#c-name");
  if (nameStillFilled === "Thandiwe Nkosi") ok("contact form: entered values preserved after failed submission");
  else fail("contact form: values were cleared after a failed submission");

  await context.close();
}

await browser.close();

console.log(`\n${failures} failing check(s).`);
process.exitCode = failures > 0 ? 1 : 0;
}

main();
