(function () {
  "use strict";

  var header = document.querySelector("[data-site-header]");
  if (!header) return;

  var toggle = header.querySelector("[data-nav-toggle]");
  var nav = header.querySelector("[data-primary-nav]");
  if (!toggle || !nav) return;

  /*
    Publish the header's real height so the open menu can sit exactly
    below it. It used to be hardcoded at 64px in CSS while the header is
    89px tall, so the overlay covered part of the header. The header no
    longer resizes on scroll, so this only has to be measured on load and
    on resize.
  */
  function syncHeaderHeight() {
    document.documentElement.style.setProperty(
      "--header-h", Math.round(header.getBoundingClientRect().height) + "px");
  }
  syncHeaderHeight();
  window.addEventListener("resize", syncHeaderHeight);

  function setOpen(open) {
    header.setAttribute("data-nav-open", open ? "true" : "false");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    /*
      Deliberately NOT locking scroll with overflow:hidden on <html>.
      Doing that removes the scrollport the sticky header sticks within,
      so the header fell back to its static position — measured jumping
      from top 0 to top -150 the instant the menu opened while scrolled,
      taking the close button off-screen with it.

      The menu is an opaque fixed overlay and overscroll-behavior:contain
      stops scroll chaining out of it, so there is nothing to gain from
      locking the page and a visible jump to lose.
    */
    if (open) {
      syncHeaderHeight();
      var firstLink = nav.querySelector("a");
      if (firstLink) firstLink.focus();
    }
  }

  toggle.addEventListener("click", function () {
    var isOpen = header.getAttribute("data-nav-open") === "true";
    setOpen(!isOpen);
  });

  nav.addEventListener("click", function (event) {
    if (event.target.tagName === "A") setOpen(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && header.getAttribute("data-nav-open") === "true") {
      setOpen(false);
      toggle.focus();
    }
  });

  // Must match the CSS breakpoint where the desktop nav takes over.
  var mq = window.matchMedia("(min-width: 70rem)");
  mq.addEventListener("change", function () {
    setOpen(false);
  });

  // Mark the current page link for styling + screen readers.
  var current = document.body.getAttribute("data-page");
  if (current) {
    var link = nav.querySelector('a[data-page="' + current + '"]');
    if (link) link.setAttribute("aria-current", "page");
  }
})();
