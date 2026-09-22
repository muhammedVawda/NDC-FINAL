/*
  NDC motion system.

  WHY THIS ISN'T GSAP
  -------------------
  GSAP + ScrollTrigger is ~45KB gzipped. Everything this site
  actually needs — one-shot reveals with stagger, a header state, a
  capped pointer tilt, and a count-up — is an IntersectionObserver
  and a few CSS custom properties. This file is ~3KB and adds no
  third-party runtime dependency to a financial-services site.
  If scrub-linked or timeline-sequenced effects are ever wanted,
  GSAP can be added for those specific cases; it isn't justified
  for fade-and-rise.

  RULES THIS FILE FOLLOWS
  - Content is visible until JS proves it can animate. The
    `js-motion` class is set by an inline snippet before paint, so
    there is no flash of hidden content and no-JS users see a
    normal page.
  - prefers-reduced-motion short-circuits everything.
  - Reveals fire ONCE and then unobserve. Re-animating on scroll-up
    is the single most common way motion starts feeling cheap.
  - Elements already in view on load are revealed immediately
    rather than animating in, so the first screen never feels late.
*/
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduced) return;

  var EASE_DURATION = 620;

  /* ---------------------------------------------------------------
     1. Reveal system
     Selectors are applied automatically so the 20+ existing pages
     don't each need hand-annotating, and new pages inherit it free.
     --------------------------------------------------------------- */
  function armReveals() {
    var GROUPS = [
      // Section intros: eyebrow/heading/lede move together as a unit.
      { sel: "main section > .wrap > .eyebrow, main section > .wrap > h2, main section > .wrap > .lede", stagger: true },
      // Cards and repeated items stagger across the row.
      { sel: ".grid > .card, .grid > .pathway-card, .grid > .blog-card, .grid > a.card", stagger: true },
      { sel: ".steps > .step", stagger: true },
      { sel: ".faq-item", stagger: true },
      { sel: ".footer-creditors__list > .creditor-badge", stagger: true },
      // Article prose: blocks rise as you read down.
      { sel: ".article-body > h2, .article-body > p, .article-body > ul", stagger: false },
    ];

    var seen = new Set();
    GROUPS.forEach(function (group) {
      var nodes = Array.prototype.slice.call(document.querySelectorAll(group.sel));
      // Stagger index resets per parent so a second row doesn't
      // inherit a long delay from the first.
      var perParent = new Map();
      nodes.forEach(function (node) {
        if (seen.has(node)) return;
        seen.add(node);
        node.setAttribute("data-reveal", "");
        if (group.stagger) {
          var parent = node.parentNode;
          var i = perParent.get(parent) || 0;
          // Cap the stagger: past ~5 items the last card feels late.
          node.style.setProperty("--reveal-index", String(Math.min(i, 5)));
          perParent.set(parent, i + 1);
        }
      });
    });
  }

  function observeReveals() {
    var targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length) return;

    if (!("IntersectionObserver" in window)) {
      // Old browser: just show everything.
      Array.prototype.forEach.call(targets, function (el) { el.classList.add("is-revealed"); });
      return;
    }

    var vh = window.innerHeight;
    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          io.unobserve(entry.target); // one-shot, by design
        });
      },
      // Fire slightly before the element reaches the viewport edge so
      // the movement completes as it arrives, not after.
      { rootMargin: "0px 0px -8% 0px", threshold: 0.01 }
    );

    Array.prototype.forEach.call(targets, function (el) {
      // Anything already on the first screen shows immediately —
      // the hero area should never appear to load in late.
      if (el.getBoundingClientRect().top < vh * 0.9) {
        el.classList.add("is-revealed");
        return;
      }
      io.observe(el);
    });

    /*
      Catch-up pass.

      IntersectionObserver only fires when an element actually
      crosses the viewport. If the page JUMPS — an anchor link
      (#callback-form, #how-it-works), "skip to main content",
      or the browser restoring a scroll position on reload —
      everything skipped over never intersects and would stay
      invisible, leaving blank space when the user scrolls back up.
      This reveals anything already at or above the fold line.
    */
    var ticking = false;
    function catchUp() {
      ticking = false;
      var fold = window.innerHeight * 0.9;
      var remaining = document.querySelectorAll("[data-reveal]:not(.is-revealed)");
      if (!remaining.length) {
        window.removeEventListener("scroll", onScroll);
        return;
      }
      Array.prototype.forEach.call(remaining, function (el) {
        if (el.getBoundingClientRect().top < fold) {
          el.classList.add("is-revealed");
          io.unobserve(el);
        }
      });
    }
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(catchUp);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("hashchange", function () {
      window.requestAnimationFrame(catchUp);
    });
  }

  /* ---------------------------------------------------------------
     2. Header scroll state
     --------------------------------------------------------------- */
  /*
     The header's scrolled state now only adds a shadow — no height, no
     padding, no position change — so it can no longer resize the page
     and drive its own threshold. That was the jitter: the header shrank,
     the browser's scroll anchoring compensated by moving scrollY, and
     scrollY crossed back over the trigger, 100 times in 2.5 seconds with
     the user perfectly still.

     Separate on/off thresholds are kept as a second line of defence. A
     single threshold flips on every 1px tremor of a trackpad or a
     precision mouse wheel while parked near the trigger; with a 40px
     dead band the state cannot chatter, whatever a future change to the
     scrolled styles might reintroduce.
  */
  function header() {
    var el = document.querySelector("[data-site-header]");
    if (!el) return;
    var ON_AT = 80;   // must scroll past here to turn the shadow on
    var OFF_AT = 40;  // and back above here to turn it off
    var scrolled = false;
    var ticking = false;
    function update() {
      var y = window.scrollY;
      if (!scrolled && y > ON_AT) scrolled = true;
      else if (scrolled && y < OFF_AT) scrolled = false;
      el.setAttribute("data-scrolled", scrolled ? "true" : "false");
      ticking = false;
    }
    window.addEventListener(
      "scroll",
      function () {
        if (ticking) return;
        ticking = true;
        window.requestAnimationFrame(update);
      },
      { passive: true }
    );
    update();
  }

  /* ---------------------------------------------------------------
     3. Hero pointer depth (desktop pointers only, capped at 6px)
     Applied via custom properties on the wrapper so the logo asset's
     own background blending is never transformed or filtered.
     --------------------------------------------------------------- */
  function heroTilt() {
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
    var visual = document.querySelector(".hero__brand-visual");
    var hero = document.querySelector(".hero");
    if (!visual || !hero) return;

    var MAX = 6;
    var raf = null;
    hero.addEventListener(
      "pointermove",
      function (e) {
        if (raf) return;
        raf = window.requestAnimationFrame(function () {
          var r = hero.getBoundingClientRect();
          var dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
          var dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
          visual.style.setProperty("--tilt-x", (dx * MAX).toFixed(2) + "px");
          visual.style.setProperty("--tilt-y", (dy * MAX).toFixed(2) + "px");
          raf = null;
        });
      },
      { passive: true }
    );
    hero.addEventListener("pointerleave", function () {
      visual.style.setProperty("--tilt-x", "0px");
      visual.style.setProperty("--tilt-y", "0px");
    });
  }

  /* ---------------------------------------------------------------
     4. Count-up for calculator results
     Reads the rendered rand figure, counts to it, then writes the
     ORIGINAL string back so formatting is never altered by motion.
     The calculation itself is untouched.
     --------------------------------------------------------------- */
  function countUp(el) {
    var finalText = el.textContent;

    // Match the digit run only. Trailing whitespace is deliberately NOT
    // consumed: the figure sits inside a sentence ("R9 000 left over each
    // month"), and swallowing the space rendered "R5004left over".
    var match = finalText.match(/-?\d[\d  .,]*\d|-?\d/);
    if (!match) return;

    var raw = match[0];
    var target = parseFloat(raw.replace(/[\s  ,]/g, "").replace(/\.(?=\d{3}\b)/g, ""));
    if (!isFinite(target) || Math.abs(target) < 100) return; // small numbers aren't worth animating

    // Mirror the site's own thousands separator rather than imposing a
    // locale default — these figures render as "R9 000", not "R9,000".
    var sep = /\d[  ]\d/.test(raw) ? (raw.indexOf(" ") !== -1 ? " " : " ") : "";
    function format(n) {
      var s = String(Math.abs(Math.round(n)));
      if (sep) s = s.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
      return (n < 0 ? "-" : "") + s;
    }

    var startAt = performance.now();
    var DURATION = 700;
    var head = finalText.slice(0, match.index);
    var tail = finalText.slice(match.index + raw.length);

    function frame(now) {
      var t = Math.min((now - startAt) / DURATION, 1);
      var eased = 1 - Math.pow(1 - t, 3);
      if (t < 1) {
        el.textContent = head + format(target * eased) + tail;
        window.requestAnimationFrame(frame);
      } else {
        el.textContent = finalText; // exact original string restored
      }
    }
    window.requestAnimationFrame(frame);
  }

  function watchCalculatorResults() {
    // Real hook in calculator.html — the results block is replaced
    // wholesale via innerHTML each time the form is submitted.
    var mount = document.querySelector("[data-calc-results]");
    if (!mount) return;

    var mo = new MutationObserver(function () {
      // The headline figure and the summary-table amounts. Both are
      // pre-formatted rand strings; countUp rewrites only the digits
      // and restores the original string exactly on the last frame.
      var figures = mount.querySelectorAll(".result-figure__amount, .summary-table td");
      Array.prototype.forEach.call(figures, function (el) {
        if (el.dataset.counted === "1") return;
        el.dataset.counted = "1";
        countUp(el);
      });

      // Result block itself rises in once, so the answer feels
      // delivered rather than simply appearing.
      var block = mount.querySelector(".result-figure");
      if (block && block.dataset.revealed !== "1") {
        block.dataset.revealed = "1";
        block.style.opacity = "0";
        block.style.transform = "translate3d(0,10px,0)";
        window.requestAnimationFrame(function () {
          block.style.transition =
            "opacity 480ms var(--ease-out-soft), transform 480ms var(--ease-out-soft)";
          block.style.opacity = "1";
          block.style.transform = "none";
        });
      }
    });
    mo.observe(mount, { childList: true, subtree: true });
  }

  function init() {
    armReveals();
    observeReveals();
    header();
    heroTilt();
    watchCalculatorResults();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
