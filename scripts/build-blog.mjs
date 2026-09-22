#!/usr/bin/env node
/*
  Static blog generator.

  Reads assets/data/articles.json (the content model — add an article by
  adding an entry here, no other file needs to change) and renders real
  static HTML into /debt-advice/, matching the rest of this site's plain
  HTML/CSS/vanilla-JS architecture (no framework, no client-side-only
  rendering, so crawlers see full content immediately).

  Run: node scripts/build-blog.mjs
  Also updates sitemap.xml with the generated URLs.
*/
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SITE = "https://ndcsa.co.za";
const CSS_V = "v=19";
const LOGO_V = "v=3";

const articles = JSON.parse(readFileSync(path.join(ROOT, "assets/data/articles.json"), "utf-8"));

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function readingTime(article) {
  const words = article.body
    .map((b) => (b.type === "faq" ? b.items.map((i) => i.q + " " + i.a).join(" ") : b.text || ""))
    .join(" ")
    .split(/\s+/).length;
  return Math.max(2, Math.round(words / 200));
}

function formatDate(iso) {
  return new Date(iso + "T00:00:00Z").toLocaleDateString("en-ZA", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

const CATEGORIES = [...new Set(articles.map((a) => a.category))];

function head({ title, description, canonical, ogImage, extraSchema }) {
  return `<!DOCTYPE html>
<html lang="en-ZA">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${canonical}">
<meta property="og:site_name" content="National Debt Consultants">
<meta property="og:image" content="${ogImage}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="National Debt Consultants logo">
<meta property="og:locale" content="en_ZA">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ogImage}">
<meta name="theme-color" content="#09161D">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="icon" href="/assets/img/favicon-32.png?${LOGO_V}" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/img/apple-touch-icon.png?${LOGO_V}">
<link rel="manifest" href="/site.webmanifest">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script>(function(){try{if(!window.matchMedia("(prefers-reduced-motion: reduce)").matches){document.documentElement.classList.add("js-motion");}}catch(e){}})();</script>
<link rel="stylesheet" href="/assets/css/styles.css?${CSS_V}">
${extraSchema || ""}</head>`;
}

function header(activePage) {
  const navItems = [
    ["/debt-review.html", "debt-review", "Debt Review"],
    ["/debt-mediation.html", "debt-mediation", "Debt Mediation"],
    ["/debt-review-removal.html", "debt-review-removal", "Debt Review Removal"],
    ["/calculator.html", "calculator", "Calculator"],
    ["/about.html", "about", "About"],
    ["/faqs.html", "faqs", "FAQs"],
    ["/contact.html", "contact", "Contact"],
  ];
  const links = navItems
    .map(([href, key, label]) => `<li><a href="${href}"${key === activePage ? ' aria-current="page"' : ""} data-page="${key}">${label}</a></li>`)
    .join("\n        ");
  return `<header class="site-header" data-site-header data-nav-open="false">
  <div class="wrap site-header__bar">
    <a class="brand" href="/">
      <picture>
        <source srcset="/assets/img/ndc-logo-header.webp?${LOGO_V}" type="image/webp">
        <img class="brand__mark" src="/assets/img/ndc-logo-header.png?${LOGO_V}" alt="National Debt Consultants" width="1031" height="785" loading="eager">
      </picture>
    </a>
    <button class="nav-toggle" type="button" data-nav-toggle aria-expanded="false" aria-controls="primary-nav">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
      <span class="visually-hidden">Menu</span>
    </button>
    <nav class="primary-nav" id="primary-nav" data-primary-nav aria-label="Primary">
      <ul class="primary-nav__list">
        ${links}
      </ul>
      <div class="primary-nav__actions">
        <a class="btn btn-gold" href="/calculator.html">Check my budget</a>
      </div>
    </nav>
  </div>
</header>`;
}

const FOOTER = `<footer class="site-footer">
  <div class="wrap footer-grid">
    <div>
      <a class="brand" href="/" style="color: var(--color-on-dark);">
        <picture>
        <source srcset="/assets/img/ndc-logo-header.webp?${LOGO_V}" type="image/webp">
        <img class="brand__mark" src="/assets/img/ndc-logo-header.png?${LOGO_V}" alt="National Debt Consultants" width="1031" height="785" loading="eager">
      </picture>
      </a>
      <p class="disclosure-note" style="margin-top: var(--space-sm);">Plain-language guidance on debt review, debt mediation and debt review removal for South African consumers.</p>
      <div class="footer-ncr">
        <p>NCR debt counsellor registration number: <strong>NCR DC 4382</strong></p>
      </div>
      <div class="footer-contact">
        <a href="tel:+27210541141">021 054 1141</a>
        <a href="mailto:Marketing@ndcsa.co.za">Marketing@ndcsa.co.za</a>
      </div>
    </div>
    <div>
      <h2>Explore</h2>
      <ul>
        <li><a href="/#how-it-works">How it works</a></li>
        <li><a href="/debt-advice/">Debt advice</a></li>
        <li><a href="/calculator.html">Budget calculator</a></li>
        <li><a href="/faqs.html">FAQs</a></li>
        <li><a href="/contact.html">Contact</a></li>
      </ul>
    </div>
    <div>
      <h2>Services</h2>
      <ul>
        <li><a href="/debt-review.html">Debt review</a></li>
        <li><a href="/debt-mediation.html">Debt mediation</a></li>
        <li><a href="/debt-review-removal.html">Debt review removal</a></li>
      </ul>
    </div>
    <div>
      <h2>Legal</h2>
      <ul>
        <li><a href="/privacy-policy.html">Privacy policy</a></li>
        <li><a href="/terms.html">Terms of use</a></li>
      </ul>
    </div>
  </div>
  <div class="wrap footer-creditors">
    <h2>Banks and credit providers</h2>
    <p class="footer-creditors__note">Logos identify the respective credit providers and do not imply partnership, sponsorship or endorsement of NDC.</p>
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

  <div class="wrap footer-bottom">
    <p>&copy; <span data-year>2026</span> National Debt Consultants. All rights reserved.</p>
    <p class="footer-credit">Powered By Telepride (Pty) Ltd</p>
  </div>
</footer>`;

function bodyEnd(extraScripts) {
  return `<nav class="mobile-actions" aria-label="Quick actions">
  <a href="/calculator.html" class="is-primary">Check my budget</a>
  <a href="/contact.html">Request a callback</a>
</nav>

<script src="/assets/js/nav.js?${CSS_V}" defer></script>
<script src="/assets/js/analytics.js?${CSS_V}" defer></script>
<script src="/assets/js/motion.js?${CSS_V}" defer></script>
<script src="/assets/js/lang.js?${CSS_V}" defer></script>
<script src="/assets/js/chat.js?${CSS_V}" defer></script>
${extraScripts || ""}<script>document.querySelectorAll('[data-year]').forEach(function(el){ el.textContent = new Date().getFullYear(); });</script>
</body>
</html>
`;
}

function renderBlock(b) {
  if (b.type === "h2") return `<h2>${esc(b.text)}</h2>`;
  if (b.type === "p") return `<p>${esc(b.text)}</p>`;
  if (b.type === "ul") return `<ul class="stack">${b.items.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`;
  if (b.type === "faq") {
    return `<div class="article-faq">
      <h2>Frequently asked</h2>
      ${b.items
        .map(
          (i) => `<details class="faq-item">
        <summary>${esc(i.q)}<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></summary>
        <p class="faq-answer">${esc(i.a)}</p>
      </details>`
        )
        .join("\n      ")}
    </div>`;
  }
  return "";
}

function breadcrumbSchema(items) {
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    ${items.map((it, i) => `{"@type": "ListItem", "position": ${i + 1}, "name": "${esc(it.name)}", "item": "${it.url}"}`).join(",\n    ")}
  ]
}
</script>
`;
}

function articleSchema(a, canonical) {
  const faqBlock = a.body.find((b) => b.type === "faq");
  let faqSchema = "";
  if (faqBlock) {
    faqSchema = `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    ${faqBlock.items
      .map(
        (i) => `{"@type": "Question", "name": "${esc(i.q)}", "acceptedAnswer": {"@type": "Answer", "text": "${esc(i.a)}"}}`
      )
      .join(",\n    ")}
  ]
}
</script>
`;
  }
  return `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Article",
  "headline": "${esc(a.title)}",
  "description": "${esc(a.excerpt)}",
  "datePublished": "${a.publishedDate}",
  "dateModified": "${a.updatedDate || a.publishedDate}",
  "author": {"@type": "Organization", "name": "National Debt Consultants"},
  "publisher": {"@type": "Organization", "name": "National Debt Consultants", "logo": {"@type": "ImageObject", "url": "${SITE}/assets/img/ndc-logo-512.png"}},
  "mainEntityOfPage": {"@type": "WebPage", "@id": "${canonical}"},
  "image": "${SITE}/assets/img/og-image.png"
}
</script>
${faqSchema}`;
}

// ---- Article pages ----
const outDir = path.join(ROOT, "debt-advice");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

for (const a of articles) {
  const canonical = `${SITE}/debt-advice/${a.slug}.html`;
  const rt = readingTime(a);
  const schema =
    breadcrumbSchema([
      { name: "Home", url: `${SITE}/` },
      { name: "Debt Advice", url: `${SITE}/debt-advice/` },
      { name: a.title, url: canonical },
    ]) + articleSchema(a, canonical);

  const related = (a.relatedSlugs || [])
    .map((slug) => articles.find((x) => x.slug === slug))
    .filter(Boolean)
    .slice(0, 3);

  // Brand suffix is appended only when the result still fits in a
  // search result (~60 chars). Mechanically appending it to an already
  // long headline just guarantees a truncated, worse-looking title.
  // `seoTitle` in articles.json overrides the H1 where a shorter,
  // search-intent-led title reads better than the editorial headline.
  const baseTitle = a.seoTitle || a.title;
  const BRAND = " | National Debt Consultants";
  const pageTitle = (baseTitle + BRAND).length <= 60 ? baseTitle + BRAND : baseTitle;

  const html = `${head({
    title: pageTitle,
    description: a.excerpt,
    canonical,
    ogImage: `${SITE}/assets/img/og-image.png`,
    extraSchema: schema,
  })}
<body data-page="debt-advice-article" data-has-mobile-bar="true">
<a class="skip-link" href="#main">Skip to main content</a>

${header("debt-advice")}

<main id="main">
  <article class="section--tight surface-page">
    <div class="wrap" style="max-width: 46rem;">
      <nav aria-label="Breadcrumb" class="breadcrumb">
        <a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/debt-advice/">Debt Advice</a> <span aria-hidden="true">/</span> <span aria-current="page">${esc(a.title)}</span>
      </nav>
      <p class="eyebrow">${esc(a.category)}</p>
      <h1>${esc(a.title)}</h1>
      <p class="lede">${esc(a.excerpt)}</p>
      <p class="article-meta">Published ${formatDate(a.publishedDate)}${a.updatedDate ? ` &middot; Updated ${formatDate(a.updatedDate)}` : ""} &middot; ${rt} min read</p>
    </div>
  </article>

  <section class="section">
    <div class="wrap" style="max-width: 46rem;">
      <div class="article-body stack">
        ${a.body.map(renderBlock).join("\n        ")}
      </div>

      ${
        a.sources && a.sources.length
          ? `<div class="article-sources">
        <h2>Sources</h2>
        <p class="article-sources__note">Legal and regulatory points in this article are based on the following public sources. Legislation and regulator guidance can change &mdash; check the source for the current position.</p>
        <ul class="article-sources__list">
          ${a.sources
            .map(
              (s) => `<li><a href="${esc(s.url)}" rel="nofollow noopener" target="_blank">${esc(s.title)}</a>${s.publisher ? ` <span class="article-sources__publisher">&mdash; ${esc(s.publisher)}</span>` : ""}</li>`
            )
            .join("\n          ")}
        </ul>
      </div>`
          : ""
      }

      ${
        (a.relatedServices || []).length
          ? `<div class="article-parent">
        <p class="article-parent__label">Part of</p>
        <div class="article-parent__links">
          ${(a.relatedServices || [])
            .map(function (s) {
              var names = {
                "/debt-review.html": "Debt Review",
                "/debt-mediation.html": "Debt Mediation",
                "/debt-review-removal.html": "Debt Review Removal",
                "/calculator.html": "Budget Calculator",
                "/contact.html": "Contact",
              };
              return `<a href="${s}">${names[s] || s}</a>`;
            })
            .join("\n          ")}
        </div>
      </div>`
          : ""
      }

      <div class="card" style="margin-top: var(--space-xl);">
        <h2>Want to talk through your own situation?</h2>
        <p>This article is general information, not a personal assessment. A consultant can look at your actual numbers and explain what applies to you.</p>
        <div class="hero__actions" style="margin-top: var(--space-sm);">
          <a class="btn btn-gold" href="/calculator.html">Check my budget</a>
          <a class="btn btn-outline" href="/contact.html">Request a callback</a>
        </div>
      </div>

      ${
        related.length
          ? `<div style="margin-top: var(--space-2xl);">
        <h2>Related articles</h2>
        <div class="grid grid--3" style="margin-top: var(--space-md);">
          ${related
            .map(
              (r) => `<a class="card blog-card" href="/debt-advice/${r.slug}.html">
            <p class="eyebrow">${esc(r.category)}</p>
            <h3>${esc(r.title)}</h3>
            <p class="blog-card__excerpt">${esc(r.excerpt)}</p>
          </a>`
            )
            .join("\n          ")}
        </div>
      </div>`
          : ""
      }
    </div>
  </section>
</main>

${FOOTER}
${bodyEnd()}`;

  writeFileSync(path.join(outDir, `${a.slug}.html`), html);
}

// ---- Landing page ----
const canonical = `${SITE}/debt-advice/`;
const landingSchema = breadcrumbSchema([
  { name: "Home", url: `${SITE}/` },
  { name: "Debt Advice", url: canonical },
]);

const featured = articles.filter((a) => a.featured);
// Search index includes the full body text, so a search for a term that
// only appears inside an article (e.g. "clearance certificate") still
// finds it — not just title/excerpt matches.
function searchIndex(a) {
  const bodyText = a.body
    .map((b) => (b.type === "faq" ? b.items.map((i) => i.q + " " + i.a).join(" ") : b.type === "ul" ? b.items.join(" ") : b.text || ""))
    .join(" ");
  return (a.title + " " + a.excerpt + " " + a.category + " " + bodyText).toLowerCase().replace(/\s+/g, " ");
}

const cardsHtml = (list) =>
  list
    .map(
      (a) => `<a class="card blog-card" href="/debt-advice/${a.slug}.html" data-category="${esc(a.category)}" data-search="${esc(searchIndex(a))}">
        <p class="eyebrow">${esc(a.category)}</p>
        <h3>${esc(a.title)}</h3>
        <p class="blog-card__excerpt">${esc(a.excerpt)}</p>
        <p class="blog-card__meta">${formatDate(a.publishedDate)} &middot; ${readingTime(a)} min read</p>
      </a>`
    )
    .join("\n        ");

const categoryButtons = ["All"]
  .concat(CATEGORIES)
  .map((c) => `<button type="button" class="blog-filter${c === "All" ? " is-active" : ""}" data-category="${esc(c)}">${esc(c)}</button>`)
  .join("\n        ");

const landingHtml = `${head({
  title: "Debt Advice & Resources | National Debt Consultants",
  description: "Practical, plain-language guides on debt review, debt counselling, budgeting and credit in South Africa — to help you understand your options and take the next step.",
  canonical,
  ogImage: `${SITE}/assets/img/og-image.png`,
  extraSchema: landingSchema,
})}
<body data-page="debt-advice" data-has-mobile-bar="true">
<a class="skip-link" href="#main">Skip to main content</a>

${header("debt-advice")}

<main id="main">
  <section class="section--tight surface-dark-alt">
    <div class="wrap">
      <p class="eyebrow">Debt Advice</p>
      <h1>Practical advice to help you take control of your debt</h1>
      <p class="lede">Plain-language guides on debt review, budgeting, credit and debt counselling in South Africa &mdash; written to help you understand your situation, not overwhelm you.</p>
      <div class="hero__actions">
        <a class="btn btn-gold" href="/calculator.html">Check my budget</a>
        <a class="btn btn-outline" href="/contact.html">Request a callback</a>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap">
      <h2>Featured</h2>
      <div class="grid grid--3" style="margin-top: var(--space-md);">
        ${cardsHtml(featured)}
      </div>
    </div>
  </section>

  <section class="section surface-page-alt" id="all-articles">
    <div class="wrap">
      <h2>All articles</h2>
      <div class="blog-controls">
        <div class="blog-filters" role="group" aria-label="Filter by category">
          ${categoryButtons}
        </div>
        <div class="blog-search">
          <label for="blog-search-input" class="visually-hidden">Search debt advice articles</label>
          <input type="search" id="blog-search-input" placeholder="Search e.g. “credit score”, “budget”…" autocomplete="off">
        </div>
      </div>
      <div class="grid grid--3" id="blog-grid" style="margin-top: var(--space-lg);">
        ${cardsHtml(articles)}
      </div>
      <p id="blog-empty" class="blog-empty" hidden>No articles match your search yet. Try a different term, or <a href="/contact.html">ask us directly</a>.</p>
    </div>
  </section>
</main>

${FOOTER}
${bodyEnd('<script src="/assets/js/blog.js?' + CSS_V + '" defer></script>\n')}`;

writeFileSync(path.join(outDir, "index.html"), landingHtml);

// ---- Sitemap ----
const sitemapPath = path.join(ROOT, "sitemap.xml");
let sitemap = readFileSync(sitemapPath, "utf-8");
const today = new Date().toISOString().slice(0, 10);
const blogUrls = [`  <url><loc>${SITE}/debt-advice/</loc><lastmod>${today}</lastmod><priority>0.8</priority></url>`]
  .concat(articles.map((a) => `  <url><loc>${SITE}/debt-advice/${a.slug}.html</loc><lastmod>${a.updatedDate || a.publishedDate}</lastmod><priority>0.6</priority></url>`))
  .join("\n");

// Rebuild the debt-advice block every run. A previous version only
// appended when the section was absent, so articles added later never
// reached the sitemap.
sitemap = sitemap.replace(/\n?[ \t]*<url>(?:(?!<\/url>)[\s\S])*?\/debt-advice\/[\s\S]*?<\/url>/g, "");
sitemap = sitemap.replace("</urlset>", `${blogUrls}\n</urlset>`);
writeFileSync(sitemapPath, sitemap);

console.log(`Generated ${articles.length} articles + landing page in /debt-advice/`);
console.log("Categories:", CATEGORIES.join(", "));

// ---- Chatbot knowledge index ----
// Append blog articles into the chatbot's knowledge base so the assistant
// can cite and link to them, using the same source of truth as the site.
const kbPath = path.join(ROOT, "assets/data/knowledge.json");
const kb = JSON.parse(readFileSync(kbPath, "utf-8"));
kb.entries = kb.entries.filter((e) => e.type !== "article" && e.type !== "alias");
for (const a of articles) {
  const bodyText = a.body
    .map((b) => (b.type === "faq" ? b.items.map((i) => i.q + " " + i.a).join(" ") : b.type === "ul" ? b.items.join(" ") : b.text || ""))
    .join(" ");
  kb.entries.push({
    id: `article-${a.slug}`,
    type: "article",
    title: a.title,
    url: `/debt-advice/${a.slug}.html`,
    text: `${a.excerpt} ${bodyText}`.slice(0, 1400),
  });
}
/*
  Vocabulary aliases.

  Retrieval matches on the words people actually type, which are often
  not the words an article title uses. "How does inflation affect my
  finances?" scored below threshold because "finances" appears nowhere
  in the inflation article. These entries add natural phrasings that
  point at the same canonical article.

  Generated here rather than hand-added to knowledge.json: an earlier
  hand-added entry was silently wiped on the next build, because this
  script rebuilds the article-typed entries from scratch.
*/
const ALIASES = [
  {
    id: "alias-inflation",
    title: "How inflation affects your finances, money and household budget",
    slug: "how-inflation-affects-household-debt",
    text: "Inflation affects your finances by raising the cost of everyday living while your debt repayments stay fixed. Statistics South Africa publishes the Consumer Price Index (CPI) monthly as the official measure of consumer inflation. When prices rise faster than income, the money left over each month shrinks, which is why repayments become unmanageable without borrowing anything new. Headline inflation is an average; your experience depends on what you actually spend on, such as food, transport and electricity."
  },
  {
    id: "alias-interest-rates",
    title: "Interest rates, repo rate and prime explained for your money",
    slug: "how-interest-rates-affect-your-repayments",
    text: "The South African Reserve Bank sets the repo rate and banks price lending off it, with prime as the common benchmark. Whether a rate change reaches your monthly payment depends on whether your credit agreement is linked to a variable rate or fixed. Home loans are usually linked; personal loans are often fixed. The National Credit Act prescribes maximum interest rates for different categories of credit agreement."
  },
  {
    id: "alias-getting-out-of-debt",
    title: "Getting out of debt, paying off debt and debt help options",
    slug: "what-to-do-when-you-cant-afford-repayments",
    text: "If you are struggling to pay debt, the useful first step is an honest picture of your numbers: total income, essential expenses and every debt with its monthly repayment. Options depend on your situation and may include formal debt review with legal protection, informal debt mediation without statutory protection, or restructuring your own budget first. Acting earlier generally leaves more options open."
  }
];
for (const al of ALIASES) {
  kb.entries.push({
    id: al.id,
    type: "alias",
    title: al.title,
    url: `/debt-advice/${al.slug}.html`,
    text: al.text
  });
}

writeFileSync(kbPath, JSON.stringify(kb, null, 2) + "\n");
console.log(`Knowledge base: ${kb.entries.length} entries`);
