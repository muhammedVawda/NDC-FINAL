/*
  Central site configuration.

  Everything that appears on more than one page lives here: company details,
  contact routes, socials, the asset cache-bust version and logo geometry.
  The header, footer, mobile bar, JSON-LD and logo markup are all generated
  from this file by scripts/partials.mjs, so a phone number or address is
  changed in ONE place and applied everywhere with `npm run site:build`.
*/

export const SITE = "https://ndcsa.co.za";

// Appended to every /assets/css and /assets/js URL. /assets/* is served with
// `Cache-Control: immutable` for a year, so ANY css/js change must bump this
// (then run `npm run site:build` to rewrite every page).
export const ASSET_V = "v=23";

// Appended to the sized logo files. Bump if scripts/make-logo-assets.py is re-run.
export const LOGO_V = "v=4";

export const COMPANY = {
  name: "National Debt Consultants",
  abbreviation: "NDC",
  tagline: "We get your debt",
  // Displayed form and link form are deliberately separate.
  phoneDisplay: "(021) 054 1141",
  phoneHref: "tel:+27210541141",
  phoneSchema: "+27-21-054-1141",
  email: "marketing@ndcsa.co.za",
  address: {
    street: "Buchanan Square, 160 Sir Lowry Rd, Woodstock",
    locality: "Cape Town",
    region: "Western Cape",
    postalCode: "7915",
    country: "ZA",
    // Single-line display form.
    line: "Buchanan Square, 160 Sir Lowry Rd, Woodstock, Cape Town, 7915",
  },
  mapUrl: "https://maps.app.goo.gl/bq5FtkSw6TrXPfzp9",
  ncr: "NCRDC4382",
  socials: [
    { id: "facebook", name: "Facebook", url: "https://www.facebook.com/nationaldebtconsultants" },
    { id: "instagram", name: "Instagram", url: "https://www.instagram.com/national.debt.consultants/" },
    { id: "linkedin", name: "LinkedIn", url: "https://www.linkedin.com/company/national-debt-consultants/" },
  ],
  privacyUrl: "/privacy-policy.html",
  termsUrl: "/terms.html",
  careersUrl: "https://ndcsa.co.za/job-openings/",
  credit: "Powered by Telepride (Pty) Ltd",
};

// Logo geometry. The crop (756x709) is defined in scripts/make-logo-assets.py;
// widths below are what that script produces for each CSS height.
export const LOGO = {
  alt: "National Debt Consultants logo",
  // css height -> [1x, 2x, 3x] file heights, and the 2x PNG fallback size
  header: { desktop: 96, mobile: 64, breakpoint: "62rem" },
  footer: { height: 108 },
  fallback: { file: "ndc-logo-h192.png", width: 205, height: 192 },
};

export const SERVICES = [
  {
    key: "debt-review",
    name: "Debt Review",
    url: "/debt-review.html",
    description:
      "A formal process under the National Credit Act for over-indebted consumers, aiming to restructure repayments into one consolidated monthly payment.",
  },
  {
    key: "debt-mediation",
    name: "Debt Mediation",
    url: "/debt-mediation.html",
    description:
      "An informal route for manageable debt, agreeing arrangements with creditors directly while aiming to protect your credit profile.",
  },
  {
    key: "debt-review-removal",
    name: "Debt Review Removal",
    url: "/debt-review-removal.html",
    description:
      "Help clearing your debt review status once your debts are settled or your circumstances improve significantly, through the proper legal route.",
  },
];

// Pages whose <body data-page> value should highlight a primary-nav item.
export const NAV_KEYS = new Set([
  "debt-review",
  "debt-mediation",
  "debt-review-removal",
  "calculator",
  "about",
  "contact",
  "faqs",
  "debt-advice",
]);
