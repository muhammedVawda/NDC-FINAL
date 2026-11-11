/*
  Shared HTML partials: logo, header, footer, mobile action bar, head extras,
  FAQ accordion and JSON-LD. Used by scripts/build-site.mjs (root pages) and
  scripts/build-blog.mjs (generated guidance pages), so there is exactly one
  definition of each.
*/
import { SITE, ASSET_V, LOGO_V, COMPANY, LOGO, SERVICES } from "./site-config.mjs";

export function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- logo -----------------------------------------------------------------

const f = (h) => `/assets/img/ndc-logo-h${h}.webp?${LOGO_V}`;
const set = (h) => `${f(h)} 1x, ${f(h * 2)} 2x, ${f(h * 3)} 3x`;

/**
 * The logo is cropped to the artwork and pre-sized for each use at 1x/2x/3x,
 * so the browser never does a large downscale (which is what made the small
 * lettering unreadable). Width/height attributes reserve the box: no layout
 * shift while it loads.
 */
export function logoPicture(kind, extraImgAttrs = "") {
  const fb = LOGO.fallback;
  if (kind === "footer") {
    return `<picture>
        <source type="image/webp" srcset="${set(LOGO.footer.height)}">
        <img class="brand__mark" src="/assets/img/${fb.file}?${LOGO_V}" width="${fb.width}" height="${fb.height}" alt="${LOGO.alt}" loading="lazy" decoding="async"${extraImgAttrs}>
      </picture>`;
  }
  const { desktop, mobile, breakpoint } = LOGO.header;
  return `<picture>
        <source media="(min-width: ${breakpoint})" type="image/webp" srcset="${set(desktop)}">
        <source type="image/webp" srcset="${set(mobile)}">
        <img class="brand__mark" src="/assets/img/${fb.file}?${LOGO_V}" width="${fb.width}" height="${fb.height}" alt="${LOGO.alt}" loading="eager" decoding="async" fetchpriority="high"${extraImgAttrs}>
      </picture>`;
}

/** Preload the header logo for the viewport that will actually use it. */
// Manrope is self-hosted (see @font-face in styles.css). Only the Latin file is preloaded:
// it carries every character on the page that is not in a rarely used extended range.
export function fontPreloads() {
  return `<link rel="preload" href="/assets/fonts/manrope-latin.woff2?v=1" as="font" type="font/woff2" crossorigin>`;
}

export function logoPreloads() {
  const { desktop, mobile, breakpoint } = LOGO.header;
  const maxw = `${parseFloat(breakpoint) - 0.01}rem`;
  return [
    `<link rel="preload" as="image" type="image/webp" href="${f(desktop)}" imagesrcset="${set(desktop)}" media="(min-width: ${breakpoint})" fetchpriority="high">`,
    `<link rel="preload" as="image" type="image/webp" href="${f(mobile)}" imagesrcset="${set(mobile)}" media="(max-width: ${maxw})" fetchpriority="high">`,
  ].join("\n");
}

// ---- header ---------------------------------------------------------------

export function header(activePage) {
  const a = (href, key, label) =>
    `<a href="${href}"${key === activePage ? ' aria-current="page"' : ""} data-page="${key}">${label}</a>`;
  const servicesCurrent = SERVICES.some((s) => s.key === activePage);
  return `<header class="site-header" data-site-header data-nav-open="false">
  <div class="wrap site-header__bar">
    <a class="brand" href="/">
      ${logoPicture("header")}
    </a>
    <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="primary-nav">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      <span class="visually-hidden">Menu</span>
    </button>
    <nav class="primary-nav" id="primary-nav" data-primary-nav aria-label="Primary">
      <ul class="primary-nav__list">
        <li class="nav-item nav-item--menu" data-menu${servicesCurrent ? ' data-current="true"' : ""}>
          <button class="nav-menu__btn" type="button" aria-expanded="false" aria-controls="nav-services" data-menu-btn>Services<svg class="nav-menu__chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></button>
          <span class="nav-menu__label" aria-hidden="true">Services</span>
          <ul class="nav-menu" id="nav-services" data-menu-panel>
            ${SERVICES.map((s) => `<li>${a(s.url, s.key, s.name)}</li>`).join("\n            ")}
          </ul>
        </li>
        <li>${a("/calculator.html", "calculator", "Calculator")}</li>
        <li>${a("/about.html", "about", "About")}</li>
        <li>${a("/contact.html", "contact", "Contact")}</li>
        <li class="nav-item--mobile-only">${a("/faqs.html", "faqs", "FAQs")}</li>
        <li class="nav-item--mobile-only">${a("/debt-advice/", "debt-advice", "Debt Advice")}</li>
      </ul>
      <div class="primary-nav__actions">
        <a class="btn btn-gold" href="/#callback-form">Request a callback</a>
      </div>
    </nav>
  </div>
</header>`;
}

// ---- footer ---------------------------------------------------------------

const ICONS = {
  facebook: '<path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"/>',
  instagram:
    '<rect x="2" y="2" width="20" height="20" rx="5" ry="5"/><path d="M16 11.4A4 4 0 1 1 12.6 8 4 4 0 0 1 16 11.4z"/><path d="M17.5 6.5h.01"/>',
  linkedin:
    '<path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"/><rect x="2" y="9" width="4" height="12"/><circle cx="4" cy="4" r="2"/>',
};

export function footer(year = new Date().getFullYear()) {
  const social = COMPANY.socials
    .map(
      (s) =>
        `<li><a href="${s.url}" target="_blank" rel="noopener noreferrer" aria-label="${COMPANY.abbreviation} on ${s.name} (opens in a new tab)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICONS[s.id]}</svg></a></li>`
    )
    .join("\n          ");
  return `<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="brand" href="/" style="color: var(--color-on-dark);">
      ${logoPicture("footer")}
      </a>
      <p class="disclosure-note" style="margin-top: var(--space-sm);">Plain-language guidance on debt review, debt mediation and debt review removal for South African consumers.</p>
      <address class="footer-contact">
        <a href="${COMPANY.phoneHref}">${COMPANY.phoneDisplay}</a>
        <a href="mailto:${COMPANY.email}">${COMPANY.email}</a>
        <a href="${COMPANY.mapUrl}" target="_blank" rel="noopener noreferrer">${COMPANY.address.line}<span class="visually-hidden"> (opens map in a new tab)</span></a>
      </address>
      <ul class="footer-social" aria-label="${COMPANY.name} on social media">
          ${social}
      </ul>
    </div>
    <div>
      <h2>Explore</h2>
      <ul>
        <li><a href="/#how-it-works">How it works</a></li>
        <li><a href="/about.html">About NDC</a></li>
        <li><a href="/debt-advice/">Debt advice</a></li>
        <li><a href="/calculator.html">Budget calculator</a></li>
        <li><a href="/faqs.html">FAQs</a></li>
        <li><a href="/contact.html">Contact</a></li>
      </ul>
    </div>
    <div>
      <h2>Services</h2>
      <ul>
        ${SERVICES.map((s) => `<li><a href="${s.url}">${s.name}</a></li>`).join("\n        ")}
      </ul>
    </div>
    <div>
      <h2>Legal</h2>
      <ul>
        <li><a href="${COMPANY.privacyUrl}">Privacy policy</a></li>
        <li><a href="${COMPANY.termsUrl}">Terms of use</a></li>
        <li><a href="${COMPANY.careersUrl}">Careers</a></li>
      </ul>
    </div>
  </div>
  <div class="wrap footer-creditors">
    <h2>Banks and credit providers</h2>
    <p class="footer-creditors__note">Names identify the respective credit providers and do not imply partnership, sponsorship or endorsement of NDC.</p>
    <ul class="footer-creditors__list">
      <li class="creditor-badge">Absa</li>
      <li class="creditor-badge">FNB</li>
      <li class="creditor-badge">Standard Bank</li>
      <li class="creditor-badge">Nedbank</li>
      <li class="creditor-badge">Capitec</li>
      <li class="creditor-badge">African Bank</li>
      <li class="creditor-badge">WesBank</li>
      <li class="creditor-badge">MFC</li>
    </ul>
  </div>

  <div class="wrap footer-lang" data-lang-mount></div>

  <div class="wrap footer-legal">
    <p>${COMPANY.name} is a debt counsellor registered with the National Credit Regulator (${COMPANY.ncr}) under the National Credit Act 34 of 2005. Outcomes depend on your circumstances and your creditors&rsquo; responses. Fees are explained at your consultation. Personal information is processed in line with POPIA. See our <a href="${COMPANY.privacyUrl}">Privacy Policy</a>. This website offers general information, not financial or legal advice.</p>
  </div>

  <div class="wrap footer-bottom">
    <p>&copy; <span data-year>${year}</span> ${COMPANY.name}. <span class="footer-credit">${COMPANY.credit}.</span></p>
    <p class="footer-regulated">Regulated by the NCR &middot; <strong>${COMPANY.ncr}</strong></p>
  </div>
</footer>`;
}

// ---- mobile action bar ----------------------------------------------------

export function mobileBar() {
  return `<nav class="mobile-actions" aria-label="Quick contact">
    <a href="${COMPANY.phoneHref}">Call us</a>
    <a class="is-primary" href="/#callback-form">Call me back</a>
  </nav>`;
}

// ---- script block ---------------------------------------------------------

export function coreScripts(extra = "") {
  const s = (name) => `<script src="/assets/js/${name}.js?${ASSET_V}" defer></script>`;
  return [s("nav"), s("analytics"), s("motion"), s("lang"), s("sa-validate"), s("chat"), extra]
    .filter(Boolean)
    .join("\n");
}

// ---- FAQ accordion + JSON-LD ---------------------------------------------

export function faqItemsHtml(faqs, indent = "        ") {
  return faqs
    .map(
      (i) => `${indent}<details class="faq-item">
${indent}  <summary>${esc(i.q)}<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>
${indent}  <p class="faq-answer">${esc(i.a)}</p>
${indent}</details>`
    )
    .join("\n");
}

export function homeJsonLd(faqs) {
  const orgId = `${SITE}/#organization`;
  const org = {
    "@context": "https://schema.org",
    "@type": "FinancialService",
    "@id": orgId,
    name: COMPANY.name,
    alternateName: COMPANY.abbreviation,
    url: `${SITE}/`,
    logo: `${SITE}/assets/img/ndc-logo-512.png`,
    image: `${SITE}/assets/img/og-image.png`,
    description:
      "NCR-registered debt counsellor in Cape Town offering debt review, debt mediation and debt review removal for South African consumers, with a free assessment.",
    telephone: COMPANY.phoneSchema,
    email: COMPANY.email,
    address: {
      "@type": "PostalAddress",
      streetAddress: COMPANY.address.street,
      addressLocality: COMPANY.address.locality,
      addressRegion: COMPANY.address.region,
      postalCode: COMPANY.address.postalCode,
      addressCountry: COMPANY.address.country,
    },
    areaServed: { "@type": "Country", name: "South Africa" },
    hasMap: COMPANY.mapUrl,
    sameAs: COMPANY.socials.map((s) => s.url),
    identifier: {
      "@type": "PropertyValue",
      name: "NCR debt counsellor registration number",
      value: COMPANY.ncr,
    },
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "Debt help services",
      itemListElement: SERVICES.map((s) => ({
        "@type": "Offer",
        itemOffered: {
          "@type": "Service",
          name: s.name,
          description: s.description,
          url: `${SITE}${s.url}`,
          provider: { "@id": orgId },
        },
      })),
    },
  };
  const site = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: COMPANY.name,
    url: `${SITE}/`,
    publisher: { "@id": orgId },
  };
  const faq = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((i) => ({
      "@type": "Question",
      name: i.q,
      acceptedAnswer: { "@type": "Answer", text: i.a },
    })),
  };
  return [org, site, faq]
    .map((o) => `<script type="application/ld+json">\n${JSON.stringify(o, null, 2)}\n</script>`)
    .join("\n");
}
