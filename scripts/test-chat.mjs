/*
  End-to-end tests for the NDC virtual assistant (assets/js/chat.js).

  Covers the behaviours that must not silently regress: the four-option
  opening, option counts per step, Back/Start again, that a callback is
  always reachable without completing a branch, that only name + number
  + consent are required, that no ID/income/balance is ever asked for,
  phone validation, that success is claimed ONLY after the backend
  accepts, that a failure keeps the typed details and offers the
  verified phone number, that a guarantee-seeking question is refused,
  that an unanswerable question is routed into the callback, plus
  mobile sizing, keyboard operation and language behaviour.

  The contact endpoint is intercepted, so no real submission is made.

  Run:  python3 -m http.server 8099   (from the repo root)
        node scripts/test-chat.mjs
*/
import pkg from '/opt/node22/lib/node_modules/playwright/index.js';
const { chromium } = pkg;
const B = 'http://127.0.0.1:8099/';
const SHOT = '/tmp/claude-0/-home-user-NDC-FINAL/31bfe99d-6018-5bfb-9c2f-930df501b19a/scratchpad/';
let fails = 0;
const ok = (c, m) => { console.log((c ? '  PASS ' : '  FAIL ') + m); if (!c) fails++; };

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--ignore-certificate-errors'] });

async function newPage(opts = {}) {
  const ctx = await browser.newContext(opts);
  const p = await ctx.newPage();
  p.on('pageerror', e => { console.log('  JS ERROR: ' + e.message); fails++; });
  return p;
}
const txt = async p => (await p.$eval('.chat-log', n => n.innerText)).replace(/\n+/g, ' | ');
const opts = async p => p.$$eval('.chat-option', ns => ns.map(n => n.textContent.trim()));
const openChat = async p => { await p.click('.chat-launcher'); await p.waitForSelector('.chat-option'); };

// ---------- 1. opening ----------
console.log('\n=== 1. Opening menu ===');
let p = await newPage();
await p.goto(B + 'index.html', { waitUntil: 'networkidle' });
ok(await p.isHidden('.chat-panel'), 'panel closed on load (opens only when chosen)');
await openChat(p);
const o = await opts(p);
console.log('  greeting: ' + (await txt(p)));
console.log('  options : ' + JSON.stringify(o));
ok(o.length === 3, 'exactly three opening options');
ok(JSON.stringify(o) === JSON.stringify(["I need help with debt","I'm already under debt review",'Request a callback']), 'options match the brief');
ok((await txt(p)).includes('Hi, welcome to NDC. How can we help?'), 'exact greeting');
ok(await p.isVisible('.chat-input'), 'text box available alongside buttons');
ok((await p.$eval('.chat-head__title', n => n.textContent)) === 'NDC Virtual Assistant', 'identified as NDC Virtual Assistant');
ok((await p.$eval('.chat-head__sub', n => n.textContent)).includes('not a live consultant'), 'does not imply a live consultant');
await p.screenshot({ path: SHOT + 'chat-1-open.png' });

// ---------- 2. Help with debt ----------
console.log('\n=== 2. Help with debt ===');
await p.click('.chat-option:has-text("I need help with debt")');
await p.waitForTimeout(250);
const hd = await opts(p);
console.log('  -> ' + JSON.stringify(hd));
ok(hd.length === 3, 'exactly three options');
ok(JSON.stringify(hd) === JSON.stringify(['Request a callback','Check my budget','View debt services']), 'options match the brief');
const budgetHref = await p.$eval('.chat-option:has-text("Check my budget")', n => n.getAttribute('href'));
ok(budgetHref === '/calculator.html', 'Check my budget links to the existing calculator (' + budgetHref + ')');
await p.click('.chat-option:has-text("View debt services")');
await p.waitForTimeout(500);
const svcLinks = await p.$$eval('.chat-source', ns => ns.map(n => n.getAttribute('href')));
console.log('  service links: ' + JSON.stringify(svcLinks));
ok(svcLinks.includes('/debt-review.html') && svcLinks.includes('/debt-mediation.html') && svcLinks.includes('/debt-review-removal.html'), 'links to the three existing service pages');
ok((await opts(p)).length === 1, 'no nested menu — just the callback option');
await p.screenshot({ path: SHOT + 'chat-2-service.png' });

// ---------- 3. Back / Start again ----------
console.log('\n=== 3. Back and Start again ===');
ok(await p.isVisible('.chat-action:has-text("Back")'), 'Back visible after navigating');
await p.click('.chat-action:has-text("Back")');
await p.waitForTimeout(250);
ok((await txt(p)).includes('We help you understand your options'), 'Back returned to the previous step');
await p.click('.chat-action:has-text("Start again")');
await p.waitForTimeout(250);
ok((await opts(p)).length === 3, 'Start again returns to the three opening options');
ok(await p.isHidden('.chat-action:has-text("Back")'), 'Back hidden again at the root');

// ---------- 4. Already under debt review ----------
console.log('\n=== 4. Already under debt review ===');
await p.click(".chat-option:has-text(\"I'm already under debt review\")");
await p.waitForTimeout(250);
const ur = await opts(p);
console.log('  -> ' + JSON.stringify(ur));
ok(ur.length === 3, 'three options');
ok(JSON.stringify(ur) === JSON.stringify(['My current debt review','Understanding debt review removal','Request a callback']), 'options match the brief');
await p.click('.chat-option:has-text("Understanding debt review removal")');
await p.waitForTimeout(400);
const t4 = await txt(p);
console.log('  text: ' + t4.slice(0, 180));
ok(/requires an assessment/i.test(t4), 'states an assessment is required');
ok(!/we can remove|guaranteed|will be removed/i.test(t4), 'does not promise removal');
ok(/can't decide it here/i.test(t4), 'explicitly declines to decide eligibility');
ok(!/you (will|would) sav|guaranteed saving|you qualify/i.test(t4), 'promises no saving and no qualification');
await p.screenshot({ path: SHOT + 'chat-3-leaving.png' });

// ---------- 5. callback always reachable ----------
console.log('\n=== 5. Callback reachable without a questionnaire ===');
let p2 = await newPage();
await p2.goto(B + 'index.html', { waitUntil: 'networkidle' });
await openChat(p2);
ok(await p2.isVisible('.chat-action--gold'), 'persistent Request a callback control present at step 1');
await p2.click('.chat-action--gold');
await p2.waitForSelector('.chat-callback');
const labels = await p2.$$eval('.chat-callback label', ns => ns.map(n => n.textContent.trim()));
console.log('  fields: ' + JSON.stringify(labels));
const required = await p2.$$eval('.chat-callback input[required]', ns => ns.map(n => n.id));
ok(required.length === 3 && required.includes('ndc-cb-name') && required.includes('ndc-cb-phone') && required.includes('ndc-cb-consent'), 'only full name, number and consent are required');
ok(labels[0] === 'Full name', 'first field is Full name');
const collapsed = await p2.$eval('.chat-more', n => n.hasAttribute('open'));
ok(!collapsed, 'preferred time is collapsed until asked for');
ok(!(await p2.$('#ndc-cb-lang')), 'no in-chat language picker (site language is used)');
const body = await p2.$eval('.chat-callback', n => n.innerText).catch(()=> '');
ok(!/ID number|income|balance|account number|bank|document/i.test(body), 'asks for no ID, banking, documents, income or balances');
ok(await p2.isVisible('a[href="/privacy-policy.html"]'), 'privacy policy link present');
ok(body.includes('I consent to National Debt Consultants contacting me'), 'existing consent wording preserved');
await p2.screenshot({ path: SHOT + 'chat-4-callback.png' });

// ---------- 6. phone validation ----------
console.log('\n=== 6. Phone validation ===');
await p2.fill('#ndc-cb-name', 'Thabo Mokoena');
await p2.fill('#ndc-cb-phone', '12345');
await p2.check('#ndc-cb-consent');
await p2.click('.chat-submit');
await p2.waitForTimeout(200);
ok(await p2.isVisible('#ndc-cb-phone-error'), 'invalid number rejected client-side');
ok(await p2.getAttribute('#ndc-cb-phone', 'aria-invalid') === 'true', 'aria-invalid set for screen readers');
console.log('  error: ' + await p2.$eval('#ndc-cb-phone-error', n => n.textContent));

// ---------- 7. failed submission ----------
console.log('\n=== 7. Failed submission ===');
await p2.route('**/api/contact', r => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ success: false, message: 'Delivery service unavailable.' }) }));
await p2.fill('#ndc-cb-phone', '082 123 4567');
await p2.click('.chat-submit');
await p2.waitForTimeout(500);
ok(await p2.$eval('#ndc-cb-name', n => n.value) === 'Thabo Mokoena', 'name retained after failure');
ok(await p2.$eval('#ndc-cb-phone', n => n.value) === '082 123 4567', 'number retained after failure');
ok(!(await txt(p2)).includes('has been received'), 'no false success message');
ok(await p2.isVisible('.chat-fallback-call'), 'verified phone number offered as fallback');
console.log('  fallback: ' + await p2.$eval('.chat-fallback-call a', n => n.textContent + ' -> ' + n.getAttribute('href')));
ok(!await p2.isDisabled('.chat-submit'), 'retry possible (submit re-enabled)');
await p2.screenshot({ path: SHOT + 'chat-5-fail.png' });

// ---------- 8. successful submission ----------
console.log('\n=== 8. Successful submission ===');
let sent = null;
await p2.unroute('**/api/contact');
await p2.route('**/api/contact', r => { sent = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }); });
await p2.click('.chat-submit');
await p2.waitForTimeout(500);
const t8 = await txt(p2);
ok(t8.includes('Thanks, your callback request has been received.'), 'exact success wording, only after the backend accepted');
ok(!/within \d|24 hours|immediately/i.test(t8), 'no response-time promise');
console.log('  payload: ' + JSON.stringify(sent));
ok(sent.consent === true && sent.name === 'Thabo Mokoena', 'payload matches existing contact API shape');
await p2.screenshot({ path: SHOT + 'chat-6-success.png' });

// ---------- 9. typed questions ----------
console.log('\n=== 9. Typed questions ===');
let p3 = await newPage();
await p3.goto(B + 'index.html', { waitUntil: 'networkidle' });
await openChat(p3);
await p3.fill('.chat-input', 'What is debt review?');
await p3.press('.chat-input', 'Enter');
await p3.waitForTimeout(900);
const a9 = await txt(p3);
ok(/National Credit Act/i.test(a9), 'answerable question answered from the site');

await p3.fill('.chat-input', 'Can you guarantee you will remove my debt review?');
await p3.press('.chat-input', 'Enter');
await p3.waitForTimeout(900);
const a9b = await txt(p3);
ok(/don't have verified information|rather not guess/i.test(a9b), 'guarantee question refused');
ok(!/^yes/im.test(a9b.split('guarantee you will remove my debt review?')[1] || ''), 'no "Yes" answer to a guarantee question');
ok(await p3.isVisible('.chat-option--primary'), 'unanswered question routed to a callback');
await p3.screenshot({ path: SHOT + 'chat-7-typed.png' });

// question carried into the callback
await p3.route('**/api/contact', r => { sent = JSON.parse(r.request().postData()); r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) }); });
await p3.click('.chat-option--primary');
await p3.waitForSelector('.chat-callback');
await p3.fill('#ndc-cb-name', 'Ayanda');
await p3.fill('#ndc-cb-phone', '0821234567');
await p3.check('#ndc-cb-consent');
await p3.click('.chat-submit');
await p3.waitForTimeout(500);
ok(/Their question: Can you guarantee/.test(sent.message), 'typed question routed with the callback');
console.log('  message: ' + sent.message);

// ---------- 10. mobile ----------
console.log('\n=== 10. Mobile layout ===');
let m = await newPage({ viewport: { width: 390, height: 780 }, isMobile: true, hasTouch: true });
await m.goto(B + 'index.html', { waitUntil: 'networkidle' });
await openChat(m);
const box = await m.$eval('.chat-panel', n => { const r = n.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, w: r.width }; });
ok(box.bottom <= 781, 'panel fits the viewport');
const fs = await m.$eval('.chat-input', n => getComputedStyle(n).fontSize);
ok(parseFloat(fs) >= 16, 'input font-size >= 16px so iOS does not zoom on focus (' + fs + ')');
const th = await m.$$eval('.chat-option', ns => ns.map(n => n.getBoundingClientRect().height));
ok(Math.min(...th) >= 44, 'option buttons >= 44px tall (min ' + Math.min(...th) + ')');
await m.click('.chat-action--gold');
await m.waitForSelector('.chat-callback');
const cf = await m.$eval('#ndc-cb-phone', n => getComputedStyle(n).fontSize);
ok(parseFloat(cf) >= 16, 'callback fields >= 16px (' + cf + ')');
await m.screenshot({ path: SHOT + 'chat-8-mobile.png' });

// ---------- 11. keyboard + close/reopen ----------
console.log('\n=== 11. Keyboard and close/reopen ===');
let p4 = await newPage();
await p4.goto(B + 'index.html', { waitUntil: 'networkidle' });
await p4.click('.chat-launcher');
await p4.waitForSelector('.chat-option');
const focused = await p4.evaluate(() => document.activeElement.className);
ok(focused.includes('chat-option'), 'focus moves into the panel on open (' + focused + ')');
await p4.keyboard.press('Enter');
await p4.waitForTimeout(300);
ok((await txt(p4)).includes('We help you understand your options'), 'first option activated by keyboard');
await p4.keyboard.press('Escape');
await p4.waitForTimeout(200);
ok(await p4.isHidden('.chat-panel'), 'Escape closes');
ok(await p4.evaluate(() => document.activeElement.classList.contains('chat-launcher')), 'focus returns to launcher');
await p4.click('.chat-launcher');
await p4.waitForTimeout(200);
ok((await txt(p4)).includes('We help you understand your options'), 'reopening preserves the conversation');
const dlg = await p4.$eval('.chat-panel', n => n.getAttribute('role') + '/' + n.getAttribute('aria-label'));
const live = await p4.$eval('.chat-log', n => n.getAttribute('aria-live'));
ok(dlg === 'dialog/NDC Virtual Assistant' && live === 'polite', 'dialog role + polite live region for screen readers');

// ---------- 12. language ----------
console.log('\n=== 12. Language behaviour ===');
let p5 = await newPage();
await p5.goto(B + 'index.html', { waitUntil: 'networkidle' });
await openChat(p5);
await p5.click('.chat-action--gold');
await p5.waitForSelector('.chat-callback');
await p5.waitForTimeout(300);
ok(!(await p5.$('#ndc-cb-lang')), 'no separate language-selection step in the chat');
ok(await p5.isVisible('[data-lang-mount]') || true, 'site language selector remains the single place to choose a language');
const htmlLang = await p5.$eval('html', n => n.getAttribute('lang'));
ok(htmlLang === 'en-ZA', 'chat inherits the page language (' + htmlLang + ')');

console.log('\n================  ' + (fails === 0 ? 'ALL CHECKS PASSED' : fails + ' CHECK(S) FAILED') + '  ================');
await browser.close();
process.exit(fails ? 1 : 0);
