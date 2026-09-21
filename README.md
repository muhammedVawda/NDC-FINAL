# National Debt Consultants — website

A static, framework-free website (semantic HTML, CSS custom properties,
vanilla JS) plus one small serverless function for the contact form.
No build step is required to run or deploy the site itself.

**Read `IMPLEMENTATION_NOTES.md` before launch** — it documents what
still needs real business details, credentials, and legal sign-off.

## Project structure

```
/                      Page templates (index.html, calculator.html, ...)
/assets/css/           Design tokens + all styles (styles.css)
/assets/js/            budget-engine.js (pure calc logic), calculator.js,
                        contact-form.js, nav.js, analytics.js
/assets/svg/           Placeholder logo — replace before launch
/netlify/functions/    contact.js — server-side lead handler
/scripts/              Test harnesses (not shipped to production)
netlify.toml           Hosting config: redirects, headers, function routing
```

## Running locally

No dependencies to install for the site itself.

```bash
npx http-server -p 8080 -c-1
# or: python3 -m http.server 8080
```

Then open `http://localhost:8080`. The contact form will show an honest
"not configured" message locally unless you run `netlify dev` with the
environment variables below set (or point `/api/contact` at a local stub).

## Testing

```bash
node scripts/test-calculator.mjs   # unit tests for the calculator engine
node scripts/e2e-check.cjs         # Playwright browser tests (needs Playwright + a local server on :8080)
```

`e2e-check.cjs` requires the `playwright` package and its Chromium
browser to be available (`require("playwright")` must resolve — set
`NODE_PATH` to wherever it's installed if it's not in this project's own
`node_modules`).

## Deployment (Netlify)

1. Connect this repository to a new Netlify site.
2. Build settings: no build command needed; publish directory `.`
   (already set in `netlify.toml`).
3. Set environment variables (Site settings → Environment variables) —
   at minimum one contact-form destination:
   - `CONTACT_WEBHOOK_URL`, **or**
   - `RESEND_API_KEY` + `CONTACT_TO_EMAIL` + `CONTACT_FROM_EMAIL`
   Optional: `CONTACT_RATE_LIMIT_MAX`, `CONTACT_RATE_LIMIT_WINDOW_MS`.
4. Deploy. `/api/*` is redirected to the Netlify Function automatically
   (see `netlify.toml`).
5. Point DNS for `ndcsa.co.za` at the Netlify site once approved.

Deploying elsewhere: the site is plain static files and will work on any
static host (Vercel, S3+CloudFront, GitHub Pages, etc.). Only the contact
form's backend (`netlify/functions/contact.js`) is Netlify-specific — port
it to your platform's equivalent (a single Node function with the same
validation logic) and update the `/api/contact` route accordingly.

## Maintenance notes

- **Brand colours & type**: all defined as CSS custom properties at the
  top of `assets/css/styles.css`. The `--color-gold-*` and
  `--color-charcoal-*` tokens are sampled from the real logo
  (`assets/img/ndc-logo-master.png`) — if the business supplies an updated
  or vector logo, re-sample from that file and update the tokens the same
  way.
- **Logo**: `assets/img/ndc-logo-master.png` is the real NDC logo. The
  header/footer, favicon, `apple-touch-icon.png`, `site.webmanifest` and
  `og-image.png`/`twitter:image` are all generated from it (see
  `assets/img/`). To replace it with a newer or vector version, drop the
  new file in as `ndc-logo-master.png` and regenerate the derivative sizes
  (192px WebP+PNG, 32px, 180px, 512px, and `favicon.ico`) the same way —
  no other markup needs to change unless the aspect ratio changes.
- **Calculator categories/copy**: edit the fields directly in
  `calculator.html`; the calculation logic in `assets/js/budget-engine.js`
  reads field values by `name` attribute, so keep `name="..."` in sync
  with `INCOME_FIELDS`/`EXPENSE_FIELDS`/`DEBT_FIELDS` in that file if you
  add or rename a category.
- **Legal/service copy**: `debt-review.html`, `debt-mediation.html`,
  `debt-review-removal.html`, `faqs.html` — see
  `IMPLEMENTATION_NOTES.md` §3 for sourcing and what needs legal sign-off
  before publishing.
- **Adding a redirect**: add a `[[redirects]]` block to `netlify.toml`.
- **Sitemap**: update `sitemap.xml` if pages are added, removed, or
  renamed.
