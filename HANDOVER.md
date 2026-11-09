# NDC website — launch handover

Static HTML/CSS/vanilla-JS site. No framework, no build step for pages.
Serverless functions in `netlify/functions/` (wrapped for Vercel in `api/`).
Production branch: `claude/ndc-website-rebuild-nhsynb`. Working branch for
changes: `claude/dazzling-planck-l2ifut` (merge via PR).

## 1. Deployment status — read this first

**The build is merged but has NOT been verified live by the developer.**
The build environment cannot reach vercel.com, api.vercel.com,
ndcsa.co.za or ndcfiinal.vercel.app (all connections rejected by network
policy) and holds no hosting token. Nothing in this repository has been
confirmed on a public URL.

What is known about the hosting picture:

- `ndcsa.co.za` — the current live site. Whether it still serves the OLD
  site or the new build depends entirely on whether the domain has been
  pointed at the new Vercel project. **Until that is done, the public
  domain serves the old site.**
- `ndcfiinal.vercel.app` — the previous development site. Its role is not
  recorded in this project and could not be inspected. Treat it as legacy
  unless someone confirms otherwise.
- A Vercel import of this repo was started (project name `ndc-final-jvz2`,
  production branch `claude/ndc-website-rebuild-nhsynb`). If it completed,
  the new build is at `ndc-final-jvz2.vercel.app` — a **preview address,
  not production**, until `ndcsa.co.za` is attached.

**To go live:** Vercel → project → Settings → Domains → add `ndcsa.co.za`
→ update DNS at the registrar as instructed → wait for the certificate.
Then run the live checks in §9 against `https://ndcsa.co.za/`.

**Rollback:** Vercel → Deployments → previous deployment → "Promote to
Production" (instant, no rebuild). Or revert the merge commit on the
production branch and push.

**Environment variables to set in Vercel** (all optional; each feature
fails closed without its key):

| Variable | Purpose |
|---|---|
| `RESEND_API_KEY`, `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL` | Callback form delivery by email. `CONTACT_TO_EMAIL` should be `marketing@ndcsa.co.za`; `CONTACT_FROM_EMAIL` must be an address on a domain verified in Resend |
| `CONTACT_WEBHOOK_URL` | Alternative: forward callbacks to a webhook (CRM etc.) |
| `CONTACT_RATE_LIMIT_MAX`, `CONTACT_RATE_LIMIT_WINDOW_MS` | Optional. Per-address limit on form submissions (default 5 per 10 minutes) |
| `ANTHROPIC_API_KEY` | Conversational answers in the assistant (else extractive fallback) |
| `NEWS_FEEDS`, `NEWS_MAX_ITEMS`, `NEWS_MAX_AGE_DAYS` | Financial news ingestion tuning |

Without the contact variables the form returns an honest "service
unavailable" and the chat offers the phone number. **Leads will not be
delivered until one of the two contact routes is configured.**

## 2. Where to change things

Contact details, the header, the footer, the mobile bar, the logo markup,
the FAQ block and the home-page structured data are now generated from
three files, so each is edited in ONE place and then applied with
`npm run site:build` (safe to run repeatedly; it only rewrites what
changed):

| What | Where |
|---|---|
| Phone, email, address, NCR number, map and social links, legal credit line, Privacy/Careers URLs, logo sizes, asset version | `scripts/site-config.mjs` |
| Header, footer, mobile "Call us / Call me back" bar, logo `<picture>`, JSON-LD | `scripts/partials.mjs` (applied to every top-level page by `scripts/build-site.mjs`; blog pages by `scripts/build-blog.mjs`) |
| The 12 homepage FAQs | `assets/data/home-faqs.json`. The visible accordion and the FAQPage JSON-LD are both generated from it, so they always match word for word (`scripts/check-site.mjs` enforces this) |
| Assistant's own copy of the company details | `assets/data/knowledge.json` → `company` |
| Brand colours, spacing, type | `:root` tokens at the top of `assets/css/styles.css` |
| Logo and hero watermark | Source of truth is the approved artwork in `assets/img/`. `python scripts/make-logo-assets.py` regenerates the header/footer sizes (1x/2x/3x WebP + PNG fallback) and the watermark. The header logo is 96px tall on desktop and 64px on mobile (`LOGO` in `site-config.mjs`; CSS vars `--logo-h-desktop` / `--logo-h-mobile`). See §10 for why not 80/56 |
| Debt advice articles | `assets/data/articles.json`, then `node scripts/build-blog.mjs` |
| Assistant flow | `NODES` in `assets/js/chat.js` |
| Callback form fields | `index.html` and `contact.html` forms; `assets/js/contact-form.js` (behaviour); `assets/js/sa-validate.js` (phone rules and the list of "best time to call" options, shared by the pages, the assistant and the server); `netlify/functions/contact.js` (server validation + email template) |
| Calculator | `calculator.html` (markup), `assets/js/budget-engine.js` (`estimateSimple`, the tested maths), `assets/js/calculator.js` (live UI) |
| Languages | `assets/data/languages.json`: flip `status` to `published` only after human review (see §6) |
| Page metadata | `<head>` of each page; blog pages from `head()` in the build script |

**Cache busting:** `/assets/*` is served `immutable` for a year. After ANY
change to CSS or JS, bump `ASSET_V` in `scripts/site-config.mjs` (and
`LOGO_V` if an image changed) and run `npm run site:build` and
`node scripts/build-blog.mjs`. The build rewrites the `?v=` on every page.
Skipping this means returning visitors never see the change.

## 3. Tests

```
npm test               # calculator maths, phone validation, contact API, static site checks (no browser)
npm run lint           # ESLint 9 (flat config), must report nothing
npm run dev            # local server on http://localhost:8099 (static site + the real /api handlers)
npm run test:browser   # Playwright suites against the running dev server (see below)
```

`npm test` runs: `test-calculator.mjs` (66 assertions, including the
R15 000 / R8 000 / R9 000 example), `test-validators.mjs` (69, phone rules
and best-time options), `test-contact-api.mjs` (20, server validation,
honeypot, minimum time, language field) and `check-site.mjs` (every page:
one H1, titles/descriptions, canonicals, phone/email/NCR consistency, no
`#` links, every anchor has an id, FAQ HTML equals FAQ JSON-LD, asset
versions, and so on).

The browser suites need Chromium with Playwright, a local lead receiver
and the dev server pointed at it, so that no real enquiry or email is ever
created:

```
node <a small server on :9000 that appends each POST body to $LEADS_LOG>
CONTACT_RATE_LIMIT_MAX=1000 CONTACT_WEBHOOK_URL=http://127.0.0.1:9000/lead npm run dev
LEADS_LOG=/path/to/leads.log AXE=/path/to/axe.min.js npm run test:browser
```

`scripts/test-browser.mjs` covers overflow at 360/390/768/1280/1440,
header on one row, logo size and sharpness per pixel density, scroll
stability, watermark, both forms (errors, success, failure, double click,
honeypot), the calculator, FAQ, navigation and every internal link,
console errors, layout shift, reduced motion and axe-core. `test-chat.mjs`
covers the assistant.

To test the LIVE form without creating a real enquiry, submit with the
hidden honeypot field filled (`company` on the page forms). The server
returns a quiet 200 and discards it.

## 4. Assets: sources and omissions

**Photograph needed for the hero.** The hero now uses a branded budget
visual (the same summary the calculator produces) in place of the second
logo. The intended final treatment is one excellent photograph of the
actual NDC team or office — landscape, natural light, no stock people.
Drop it in as `assets/img/hero-team.webp` (+ `.jpg` fallback, ~1600px
wide, explicit width/height) and replace the `.hero__visual` block in
`index.html`. Do not use stock or generated people as NDC staff.


| Asset | Source | Status |
|---|---|---|
| NDC logo | Supplied by NDC (`ndc-logo-master.png`, 1254×1254) | Approved. Background flattened by morphological processing; artwork untouched. |
| Social preview `og-image.png` | Generated from the approved logo on the brand charcoal, DejaVu Sans text | 1200×630 |
| Favicons, manifest icons | Derived from the logo | Done |
| Bank / credit-provider logos | **NOT sourced.** The build environment has no access to the providers' brand sites. | Text badges remain. Replace with official SVGs from each provider's brand resources; keep official colours or official mono variants; do not recolour. |
| NCR mark | **NOT sourced** for the same reason. | Registration is shown as text. Obtain the mark from the NCR and place beside the registration line only — never in a way that implies endorsement. |
| Photography | None used. | If team/office photos are supplied, add with explicit `width`/`height`, WebP + fallback, `loading="lazy"` below the fold. Never present stock people as staff. |

## 5. SEO — done, and owner steps

**Preview deployments and search.** `vercel.json` now sends
`X-Robots-Tag: noindex, nofollow` for any request whose host ends in
`.vercel.app`, so `ndc-final-jvz3.vercel.app` (and every preview) stays
out of Google while `ndcsa.co.za` — once attached — is served without
that header and remains indexable. Canonicals already point at
`https://ndcsa.co.za/`. Verify after attaching the domain:
`curl -I https://ndcsa.co.za/ | grep -i robots` must print nothing.


Done in the repo: unique titles/descriptions/canonicals on all 27 pages,
sitemap of 26 canonical URLs, `robots.txt`, FinancialService + WebSite +
FAQPage schema on the home page (BreadcrumbList on inner pages; no ratings,
no reviews), legacy
redirects, a real 410 for the removed game page, 1200×630 social image,
hub-and-spoke internal linking between services and guidance.

**Not done, needs the owner's Google account:**

1. Search Console → Add property → Domain → `ndcsa.co.za` → verify via
   the DNS TXT record.
2. Sitemaps → submit `https://ndcsa.co.za/sitemap.xml`.
3. URL Inspection → request indexing for `/`, `/debt-review.html`,
   `/debt-mediation.html`, `/debt-review-removal.html`,
   `/calculator.html`.
4. Google Business Profile: name *National Debt Consultants*, address
   *Buchanan Square, 160 Sir Lowry Rd, Woodstock, Cape Town,
   7915*, phone *(021) 054 1141*, website `https://ndcsa.co.za/`, category
   *Debt counselling* (or closest available). Do not add hours until they
   are confirmed. Once the profile is verified, add its map link to the
   contact page and the `Organization` schema `sameAs`.
5. Once `ndcsa.co.za` is attached in Vercel, add a redirect from the
   `*.vercel.app` alias to the domain (Vercel → Domains → redirect) so
   the preview address does not get indexed alongside production.

No ranking is promised. Nothing above has been submitted.

## 6. Translations

`assets/data/languages.json` lists all 11 official languages; only `en`
is `published`. The selector shows the rest as in progress and does not
offer them. To publish a language: create `assets/data/i18n/<code>.json`,
have a translator with financial/legal terminology experience review it,
record `reviewedBy` / `reviewedDate`, set `status` to `published`. The
selector, hreflang and the assistant's language handling read from that
one file. Do not publish machine translation — a mistranslated protection
on this site can cause real harm.

Consultant support in languages other than English is **not confirmed**;
the callback form says "we'll do our best to match this" and nothing more.

## 7. Analytics

`assets/js/analytics.js` exposes `window.ndcTrack(event, meta)`. No
provider is connected; events accumulate in `window.ndcDataLayer`. Wire
`send()` to Plausible/GA4 when an account exists. Events emitted:
`calculator_started`, `calculator_completed`,
`callback_submitted` (only on backend success), `phone_link_selected`,
`email_link_selected`, `chat_opened`, `chat_callback_submitted` (only on
backend success), `chat_callback_failed`, `language_selected`. No event
ever carries a name, number, email, amount or free text.

## 8. 90-day plan (marketing work, not yet done)

- **Weekly:** Search Console → Pages: fix any "Not indexed" reasons; Core
  Web Vitals report once field data exists (~28 days of traffic).
- **Weekly:** check the function logs for `/api/contact` errors and the
  news ingestion result (`feedFailures` must be empty).
- **Monthly:** one new guidance article in `articles.json` answering a
  real question consultants hear; rebuild and push.
- **Monthly:** ask consenting clients for Google reviews at the moment a
  clearance certificate is issued; publish only genuine ones with
  permission. No testimonials are on the site today because none were
  supplied.
- **Monthly:** confirm Business Profile hours/phone still correct.
- **From day 1:** count `callback_submitted` + `chat_callback_submitted`
  against enquiries actually received by the business, so delivery
  failures are caught by the numbers, not by silence.

## 9. Live checks to run after the domain is attached

Open `https://ndcsa.co.za/` and confirm: pages load with no mixed-content
warnings; header stays still when you stop scrolling; calculator gives a
result without contact details; the callback form returns a success
message and the enquiry arrives; the assistant opens with three options;
`view-source:` shows `<link rel="canonical" href="https://ndcsa.co.za/…">`
(no vercel.app URL); `curl -I https://ndcsa.co.za/` shows no
`x-robots-tag: noindex`; `/sitemap.xml` and `/robots.txt` serve;
`/month-end-challenge.html` returns 410.

## 10. Latest round: what changed, decisions to review, and what is missing

**Changed**

- One header, footer, mobile bar and set of contact details, generated
  from `site-config.mjs` / `partials.mjs`. Every phone link is
  `tel:+27210541141` shown as `(021) 054 1141`; every email is
  `marketing@ndcsa.co.za`; the NCR registration `NCRDC4382` is in the hero
  trust row and the footer, with the legal line (National Credit Act 34 of
  2005, outcomes depend on circumstances and creditors, fees explained at
  consultation, POPIA).
- Header: larger, sharper logo (cropped tighter, 1x/2x/3x files), nav links
  17px / weight 600 with hover and keyboard focus, logo, menu and "Request
  a callback" on one row at 1024, 1280 and 1440. Mobile hamburger is 44px.
- A single very faint logo watermark behind the home hero (5% opacity,
  about half the hero width, fainter and smaller on phones, decorative,
  not clickable).
- Home page rewritten from the ndcsa.co.za content: three services,
  Assessment → Negotiation → Implementation, key facts, fee note (no
  amounts), 12 FAQs, and an About page with mission, vision and values.
- Callback form reduced to name, contact number, best time to call and a
  required, unticked consent box that links to the Privacy Policy. No ID
  number is collected. Delivery goes through `/api/contact`; with no
  delivery configured it says so honestly and shows the phone number.
- Calculator rebuilt to three inputs (take-home pay, living costs, monthly
  debt repayments) with a live estimate and three outcomes. It states that
  it is an estimate, that nothing is sent unless a form is submitted, and
  that a consultant confirms the numbers.
- Two defects found and fixed while testing in a browser: the homepage
  consent field had lost its error message (an unticked box showed
  nothing), and the server silently dropped the "language" field. Also: the
  404 page had a menu button that did nothing, the form inserted the
  visitor's name as HTML, an invalid optional email did not move focus
  into the opened "Add more details" panel, the home hero's small heading
  failed colour contrast, and on phones the floating assistant button
  covered the end of the NCR line at the bottom of every page.

**Decisions you may want to reverse**

1. **Logo is 96px / 64px, not 80px / 56px.** The supplied artwork has a lot
   of empty space; after cropping it, 80px would have made the lettering no
   bigger than before. Keeping the larger height gives the larger, sharper
   lettering that was asked for without changing header height. To use
   80/56 anyway, change `LOGO.header.desktop/mobile` in `site-config.mjs`,
   run `python scripts/make-logo-assets.py` and `npm run site:build`.
2. **Phone rule.** Ten digits starting 01 to 08, or +27/27 followed by nine
   digits whose first digit is 1 to 8 (so +27 9… is rejected). The same
   rule runs in the page, the assistant and the server.
3. **Minimum-time spam check** compares the time the form was shown (sent
   by the browser) with the time it is submitted: under 2 seconds is
   refused with a friendly "please try again". A request with no timestamp
   is allowed, so a real visitor is never blocked; bots that omit it are
   caught by the honeypot and rate limit instead.
4. **The old four-step itemised calculator was replaced**, not extended. It
   is recoverable from commit `3799bfb` if wanted.

**Not invented; needs your input (marked in the pages as TODO where relevant)**

- A vector (SVG) or higher-resolution logo. None exists in the project; the
  assets are made from the approved PNG.
- Google reviews or testimonials, and the star rating. None are shown and
  none are in the structured data.
- Opening hours, association memberships and the company registration
  number (see the TODO comment in `about.html`).
- How long debt review takes. The FAQ says it depends on the situation
  because no figure was supplied.
- Fee amounts. None are published on purpose; the copy says they depend on
  the situation and are explained at the first consultation.
- A real team photograph, official bank logos (text badges remain) and the
  NCR mark.
- A careers page. The footer links to `https://ndcsa.co.za/job-openings/`,
  which only exists while the WordPress site is live. After the domain
  moves, either recreate that page or point the link elsewhere.
- Old WordPress URLs. `/privacy-policy/` already redirects to the local
  page. Any other WordPress paths that Google has indexed should be
  listed from Search Console and redirected in `vercel.json` before the
  domain is switched. They are not known from inside this project.

**Before pointing ndcsa.co.za at Vercel**

1. Set the delivery variables in §1 (Resend or webhook) and submit one real
   test enquiry; confirm it arrives at marketing@ndcsa.co.za.
2. Add the domain in Vercel, update DNS, wait for the certificate.
3. Run the live checks in §9, then the Search Console steps in §5.

