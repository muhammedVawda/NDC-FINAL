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
| `RESEND_API_KEY`, `CONTACT_FROM_EMAIL`, `CONTACT_TO_EMAIL` | Callback form delivery by email |
| `CONTACT_WEBHOOK_URL` | Alternative: forward callbacks to a webhook (CRM etc.) |
| `ANTHROPIC_API_KEY` | Conversational answers in the assistant (else extractive fallback) |
| `NEWS_FEEDS`, `NEWS_MAX_ITEMS`, `NEWS_MAX_AGE_DAYS` | Financial news ingestion tuning |

Without the contact variables the form returns an honest "service
unavailable" and the chat offers the phone number. **Leads will not be
delivered until one of the two contact routes is configured.**

## 2. Where to change things

| What | Where |
|---|---|
| Phone, email, address, NCR number | Hardcoded in each page's footer + `assets/data/knowledge.json` → `company` (drives the assistant) + `scripts/build-blog.mjs` FOOTER (blog pages). Search-and-replace the literal string across `*.html`, then run the blog build. |
| Navigation | `<ul class="primary-nav__list">` in each page + `navItems` in `scripts/build-blog.mjs` |
| Brand colours, spacing, type | `:root` tokens at the top of `assets/css/styles.css` |
| Logo assets | `assets/img/ndc-logo-master.png` is the source of truth. Header/footer use `ndc-logo-header.*`, hero uses `ndc-logo-hero.*`. Both are flattened to `#09161D` — do not place them on any other colour. Bump `LOGO_V` and the `?v=` on `<img>` tags when replacing. |
| FAQs | `faqs.html` (and the `faq-*` entries in `knowledge.json` if the assistant should know them) |
| Debt advice articles | `assets/data/articles.json`, then `node scripts/build-blog.mjs` (regenerates `/debt-advice/`, the sitemap and the assistant's knowledge base) |
| Assistant flow | `NODES` in `assets/js/chat.js` |
| Callback form fields | `index.html` and `contact.html` forms; `assets/js/contact-form.js` payload; `netlify/functions/contact.js` validation + email template |
| Creditor list | `.footer-creditors__list` in each page footer + `scripts/build-blog.mjs` |
| Languages | `assets/data/languages.json` — flip `status` to `published` only after human review (see §6) |
| Metadata | `<head>` of each page; blog pages from `head()` in the build script |

**Cache busting:** `/assets/*` is served `immutable` for a year. After
ANY change to CSS or JS, bump the `?v=` number on every page (`sed -i
's/v=18/v=19/g' *.html`) and `CSS_V` in the build script, then rebuild
the blog. Skipping this means returning visitors never see the change.

## 3. Tests

```
python3 -m http.server 8099            # from repo root, leave running
node scripts/test-calculator.mjs       # 39 engine assertions, no browser
node scripts/test-chat.mjs             # 58 assistant assertions (Chromium)
```
Contact endpoint is intercepted in the chat tests; no real leads are sent.
To test the live form without creating a real enquiry, submit with the
hidden honeypot field filled (`company` on the page forms) — the server
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
sitemap of 26 canonical URLs, `robots.txt`, Organization + WebSite +
BreadcrumbList schema (no ratings, no FAQ rich-result promises), legacy
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
   *Buchanan Square Building, 160 Sir Lowry Road, Woodstock, Cape Town,
   7915*, phone *021 054 1141*, website `https://ndcsa.co.za/`, category
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
`calculator_started`, `calculator_step_viewed`, `calculator_completed`,
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
