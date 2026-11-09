/*
  ESLint (v9 flat config) for the site's own code. Deliberately dependency-free
  (no @eslint/js import) so `npm run lint` works with `npx eslint@9` and nothing
  has to be installed into the project or into the Vercel build.
*/
const browser = Object.fromEntries(
  [
    "window", "document", "navigator", "location", "history", "localStorage", "sessionStorage",
    "fetch", "FormData", "URLSearchParams", "URL", "performance", "console",
    "requestAnimationFrame", "cancelAnimationFrame", "setTimeout", "clearTimeout", "setInterval", "clearInterval",
    "IntersectionObserver", "MutationObserver", "PointerEvent", "MouseEvent", "Event", "CSS",
    "getComputedStyle", "matchMedia", "Promise", "self",
  ].map((n) => [n, "readonly"])
);
const node = Object.fromEntries(
  ["require", "module", "exports", "process", "console", "Buffer", "URL", "fetch", "setTimeout", "global", "__dirname"].map((n) => [n, "readonly"])
);

const rules = {
  "no-undef": "error",
  "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
  "no-redeclare": "error",
  "no-dupe-keys": "error",
  "no-dupe-args": "error",
  "no-duplicate-case": "error",
  "no-unreachable": "error",
  "no-empty": ["error", { allowEmptyCatch: true }],
  "no-cond-assign": "error",
  "no-constant-condition": ["error", { checkLoops: false }],
  "no-self-assign": "error",
  "no-sparse-arrays": "error",
  "no-unsafe-negation": "error",
  "use-isnan": "error",
  "valid-typeof": "error",
  eqeqeq: ["error", "always", { null: "ignore" }],
};

export default [
  { ignores: ["node_modules/**", ".vercel/**", "debt-advice/**"] },
  {
    files: ["assets/js/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "script", globals: { ...browser, module: "readonly" } },
    rules,
  },
  {
    files: ["netlify/functions/**/*.js", "api/**/*.js"],
    languageOptions: { ecmaVersion: 2022, sourceType: "commonjs", globals: node },
    rules,
  },
  {
    files: ["scripts/**/*.mjs", "eslint.config.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: node },
    rules,
  },
  {
    // The Playwright suites also contain code that runs inside the page (page.evaluate).
    files: ["scripts/test-browser.mjs", "scripts/test-chat.mjs"],
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: { ...browser, ...node, axe: "readonly", Image: "readonly", createImageBitmap: "readonly" } },
    rules,
  },
];
