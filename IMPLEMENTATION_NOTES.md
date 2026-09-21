# Implementation notes — National Debt Consultants website rebuild

This file records what was audited, what was verified vs. assumed, the
design rationale, testing performed, and everything that needs business
confirmation before launch. Read this before publishing.

## 1. What could and couldn't be inspected

- **The live site (`https://ndcsa.co.za/`) could not be crawled.** Outbound
  network access to that domain was blocked by this build environment's
  egress proxy (`EGRESS_BLOCKED` error on the first fetch attempt). No page
  content, copy, layout, or contact details were read from the live site.
  Everything on the new site was written fresh — it is **not** a proofread
  or corrected version of the old copy, because the old copy was never
  seen.
- **UPDATE (later audit pass): the official logo was supplied and is now
  wired in.** `assets/img/ndc-logo-master.png` is the real NDC logo
  (square badge, 554×554 PNG, flat dark-navy background, no transparency)
  as provided by the business. It replaced the old placeholder in the
  header, footer, favicon, `apple-touch-icon`, web manifest and
  `og:image`/`twitter:image`, at generated sizes (192px WebP+PNG for
  header/footer, 32px/multi-size `.ico` for the browser tab, 180px for
  Apple touch icon, 512px for the manifest and social image). The brand
  colour tokens (`--color-gold-*`, `--color-charcoal-*`) in
  `assets/css/styles.css` were re-sampled directly from this file's actual
  pixels (gold ≈ `#EDBF25`, dark navy ≈ `#0C171E`), replacing the earlier
  interpreted placeholder values — see the palette note at the top of that
  file. `--color-slate-*` is unchanged (not a distinct tone in the logo).
  No transparent-background or vector version of the logo has been
  supplied; if one exists, swapping it in would remove the (very subtle,
  now near-invisible since the header/footer navy was corrected to match)
  square edge around the mark.
  - The known calculator regression (screenshot showing income R11,000,
    expenses R513,788, a fabricated "available income" of −R502,788
    alongside an advertised R5,524 saving and R3,719 proposed repayment)
    was fixed based on the **written description** of that bug, not by
    inspecting the screenshot pixel-for-pixel. The fix is verified against
    that exact scenario — see §4.
- **Web search was available** and was used to ground the legal/process
  content on the three service pages and FAQs in genuine South African
  consumer credit law, not to fill in business-specific facts.

## 2. Business details intentionally left out (not fabricated)

Rather than inventing plausible-looking but unverified details, the
following were deliberately **omitted from the live site** and flagged in
visible copy where a real business normally would show them:

- Phone number, WhatsApp number, email address, physical address.
- Company registration number, NCR debt counsellor registration number(s),
  accreditation/membership logos.
- Years in operation, client counts, testimonials, reviews, awards.

A web search for "National Debt Consultants ndcsa.co.za" returned contact
details and an address associated with a *similarly-named* entity
(`ndcsaafrica.co.za` / "National Debt Consolidation – NDCSA", Facebook
listing for Durban). This was **not** used anywhere on the site: it's a
different domain from the one specified for this project
(`ndcsa.co.za`), it could not be cross-verified against the real
`ndcsa.co.za`, and publishing an unverified phone number or address
carries real risk (a customer could reach the wrong business, or a
consultant NDC never authorised). Confirm the correct entity and its real
details directly with NDC before adding them.

**Where these gaps show up on the site**, and what to do about each:

| Location | What's there now | Action needed |
|---|---|---|
| Header/footer logo | Real NDC logo (badge mark), wired in | Done — swap for a transparent/vector version if the business has one |
| `assets/css/styles.css` palette tokens | Sampled from the real logo | Done |
| Footer, About, Privacy Policy, Terms | Plain-language notes that registration/company details are pending | Add the real, confirmed details |
| Contact page "Other ways to reach us" | States that phone/WhatsApp/email will be added once confirmed | Add real, verified numbers — and confirm separately whether the phone number is also a WhatsApp number, since these are not automatically the same |
| Mobile action bar | Only "Check my budget" and "Request a callback" (both safe, no fabricated contact channel) | Optionally add a direct Call/WhatsApp button once a verified number exists — the markup is a single `<a>` tag away in each page's `<nav class="mobile-actions">` |
| Contact form backend | Returns an honest "not configured yet" error | See §5 |
| Analytics | No provider connected; events recorded in-memory only | See §6 |

## 3. Legal/process content — sources and what needs sign-off

The debt review, debt mediation and debt review removal pages, and the
FAQ page, describe general principles of South African consumer credit
law (National Credit Act 34 of 2005, National Credit Regulator, debt
counsellors, clearance certificates). These were grounded in general web
research summarising the NCA and NCR's public guidance, including sources
such as golegal.co.za, legalrights.co.za (Campbell Attorneys), and several
South African debt-counselling explainer sites, rather than the primary
legislation text itself. The copy deliberately stays high-level and avoids
citing specific section numbers, because the sources consulted did not
fully agree on granular procedural detail (for example, the precise
court/tribunal routes and timing for debt review removal), and the brief
explicitly warned against overclaiming here.

**Before publishing, have NDC's compliance/legal function review:**
- `debt-review.html`, `debt-mediation.html`, `debt-review-removal.html`,
  and the legal-facts FAQ answers on `faqs.html`, for current accuracy.
- The specific legal routes described for debt review removal (clearance
  certificate after settlement vs. a court/tribunal route) — phrased
  generally on purpose, pending confirmation of NDC's own process and
  current case law.
- Whether NDC's actual process differs from what's described (e.g. its
  specific assessment steps, who it works with for restructured payment
  distribution).

None of the "must not imply" constraints from the brief were violated
intentionally — every service page explicitly states that not everyone
qualifies, creditors don't have to accept proposals, mediation doesn't
guarantee protection from legal action, credit records are affected, and
interest rates/instalments aren't guaranteed to fall. See the "Important
limitations" callout on each service page and the FAQ page's structured
data.

## 4. Calculator — logic, assumptions and the regression fix

Engine: `assets/js/budget-engine.js` (pure functions, no DOM access — also
used by the Node test harness). UI driver: `assets/js/calculator.js`.

- All money is handled as **integer cents** internally; conversion to/from
  decimal Rand only happens at input parsing (`parseCurrency`) and output
  formatting (`formatRands`), which avoids floating-point currency errors.
- `parseCurrency` accepts "R11 000", "11,000.50", "11000.5",
  "11.000,50", padded/pasted values, and explicitly rejects negative and
  non-numeric input. It flags (but never clamps or silently changes)
  amounts over R1,000,000.
- Formula, exactly as specified: `available = income − essentialExpenses`;
  `surplus = available − debtRepayments`. Negative results are never
  clamped to zero and are always displayed, with sensitive wording (e.g.
  "R502 788 short" rather than a bare negative currency string).
- Result states A–E are implemented as a single decision tree in
  `computeBudget()` (see `budget-engine.js`), matching the specification's
  five states with an explicit precedence: expenses > income (A) →
  available exactly zero (B) → no debts entered (E) → repayments exceed
  budget (C) → balances with money left over (D).
- **No repayment estimate is ever computed or displayed.** The results
  screen always shows "A personalised repayment estimate requires an
  assessment," because no business-approved, validated restructuring model
  was supplied. This is a deliberate, permanent design choice, not a
  placeholder to fill in later without a genuine model behind it.
- The regression case from the spec (income R11,000, expenses R513,788)
  now produces state A with a shortfall of exactly R502,788, and no
  savings or repayment figures — verified by an automated test (§7) that
  will fail the build if this regression is ever reintroduced.
- Inputs are **not persisted** (no `localStorage`/`sessionStorage`) — they
  live only in the page's in-memory form state for that session, per the
  "don't store sensitive financial inputs persistently" requirement.
  Refreshing the page clears them; this is intentional, not a bug.
- A real bug was found and fixed during testing: clicking "Next" while a
  field's inline error was visible could silently fail to register in some
  browsers, because blurring the field cleared the error text and shifted
  the button between mousedown and mouseup. Fixed by preventing default on
  `mousedown` for the step-navigation buttons (`calculator.js`).

## 5. Contact form — current state and what's needed to go live

`netlify/functions/contact.js` is a complete, validated server-side
handler, but it **intentionally refuses to report success** until a real
destination is configured, per the brief's "never simulate a successful
real submission" requirement. Right now, submitting the form on any page
correctly shows an honest failure message (verified by an automated
browser test, §7) rather than a fake confirmation.

To make it live, set **one** of these in your hosting provider's
environment variables:

- `CONTACT_WEBHOOK_URL` — a URL (CRM, Zapier, Make, Slack incoming
  webhook, etc.) that accepts a JSON POST of the lead payload, **or**
- `RESEND_API_KEY`, `CONTACT_TO_EMAIL`, `CONTACT_FROM_EMAIL` — sends the
  lead by email via the Resend API. Swap this block for a different
  provider's API if preferred.

Optional: `CONTACT_RATE_LIMIT_MAX` (default 5) and
`CONTACT_RATE_LIMIT_WINDOW_MS` (default 600000) tune the basic server-side
rate limiter. That limiter is **in-memory and per warm serverless
instance** — real protection against sustained abuse should sit in front
of it (Cloudflare Turnstile, Netlify's own bot filtering, or a shared store
like Upstash Redis / Netlify Blobs for the counter). This is flagged in
comments in the function file itself.

Deployment target assumed: **Netlify** (`netlify.toml` + `netlify/functions`).
If NDC hosts elsewhere, the function logic ports easily to any Node-based
serverless platform (Vercel, AWS Lambda, Cloudflare Workers with minor
adaptation) — only the `exports.handler` wrapper is Netlify-specific.

## 6. Analytics — current state

`assets/js/analytics.js` defines a minimal `window.ndcTrack(eventName, meta)`
call used by the calculator (`calculator_step_viewed`, `calculator_completed`)
and the contact form (`callback_submitted`). No provider is connected —
events are currently only kept in an in-memory `window.ndcDataLayer` array
for verification during development. No field values, names, phone numbers,
or amounts are ever included in an event, and the "ref" query parameter used
to link the calculator to the contact form carries only a fixed page name,
never entered figures.

To connect a real provider (Plausible, GA4, Fathom, etc.), implement the
`send()` function body in `analytics.js` — no call sites need to change.

## 7. Testing performed

**Automated (all passing at last run):**
- `node scripts/test-calculator.mjs` — 39 unit tests against the pure
  calculation engine: currency parsing (grouped, decimal-comma,
  decimal-dot, padded, pasted, negative/non-numeric rejection, large-value
  flagging), Rand formatting, and all five result states, **including the
  exact supplied regression scenario** (asserts the shortfall is correct
  and that the fabricated R5,524/R3,719 figures never reappear).
- `node scripts/e2e-check.cjs` (Playwright, Chromium) — loads all 11 pages
  at 375px and 1440px viewports and asserts: HTTP 200, no horizontal
  scroll, no console errors (excluding a TLS interception artifact specific
  to this sandbox's network proxy, not a real hosting condition). It then
  drives the calculator through a full keyboard-and-mouse-accessible flow:
  blank required-field validation, the regression scenario end-to-end,
  Edit-preserves-input, large-value warning, invalid-input rejection, Reset,
  and a second full run through the positive-surplus state. It also drives
  the contact form: empty-submit validation, and confirms a failed
  submission (no backend configured) shows an honest error and **never**
  a fake success, with entered values preserved.
- Screenshots were captured at both viewport widths for every page and
  visually reviewed for layout, spacing, and hierarchy.

**Manually verified via the above:** normal inputs, zero income, zero
expenses-and-income (state B), expenses above income (state A, including
the exact regression case), debts exceeding available budget (state C),
balanced budget with a surplus (state D), no debts entered (state E),
invalid/non-numeric input, unusually large values, edit/back navigation,
reset, and repeated/duplicate form submission (guarded client-side by a
disabled-while-submitting button and a rolling rate limit, and
server-side by the function's own rate limiter).

**Not tested (no means to in this environment):**
- A real deployed contact-form submission end-to-end (no hosting account or
  credentials exist in this session — see §5).
- Real Lighthouse/Core Web Vitals scores (no ability to run Lighthouse
  against a deployed URL from here). The site is built for a strong score —
  no render-blocking JS frameworks, minimal CSS/JS payload, system-first
  font stack with two optional webfonts loaded via `font-display: swap`,
  no unoptimised images (none used) — but this is a design expectation, not
  a measured result. **Run Lighthouse against the deployed URL and report
  the real numbers before claiming a score.**
- Screen reader testing with an actual assistive technology (VoiceOver/NVDA/
  JAWS). Semantic HTML, labels, `aria-live` regions, focus management, and
  visible focus states were implemented deliberately and reviewed by
  reading the DOM structure, but this is not a substitute for testing with
  real assistive technology.

## 8. Design system summary

- Palette, type scale, spacing, radii, shadows and motion are all defined
  as CSS custom properties in `assets/css/styles.css` — a single file to
  edit for brand updates.
- Typography: a single family, "Manrope", used throughout for headings and
  body/UI text (differentiated by size/weight, not a separate display
  face), loaded from Google Fonts with `font-display: swap`; falls back to
  the system sans-serif stack if the font request fails or is blocked, so
  the page never blocks on it.
- The homepage hero's visual is the official NDC logo itself (with a
  restrained entrance animation and soft glow, gated behind
  `@media (prefers-reduced-motion: no-preference)`) rather than a
  decorative graphic. The calculator's four-stage progress indicator still
  uses the same gold-fill-resolves-left-to-right language.
- No stock photography is used anywhere, by design — all visual interest
  comes from typography, colour, spacing and the logo itself.

## 9. Redirects

`netlify.toml` includes a handful of best-guess redirects (e.g.
`/debt-counselling` → `/debt-review.html`) based on common URL patterns for
this type of site. **These are unverified**, because the real
`ndcsa.co.za` site could not be crawled from this environment (§1). Before
launch, pull the real list of indexed URLs for the old site (Google Search
Console, an XML sitemap if one exists, or server logs) and replace these
placeholder redirects with accurate ones.
