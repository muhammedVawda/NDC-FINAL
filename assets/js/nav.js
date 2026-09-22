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

  /*
    Services dropdown (desktop). Hover opens it via CSS; this adds click
    and keyboard control, closes on outside click and Escape, and keeps
    aria-expanded truthful. On mobile the same list is rendered flat and
    the button is hidden, so none of this fires.
  */
  var menus = header.querySelectorAll("[data-menu]");
  function closeMenus(except) {
    menus.forEach(function (m) {
      if (m === except) return;
      m.removeAttribute("data-open");
      var b = m.querySelector("[data-menu-btn]");
      if (b) b.setAttribute("aria-expanded", "false");
    });
  }
  menus.forEach(function (m) {
    var btn = m.querySelector("[data-menu-btn]");
    if (!btn) return;
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = m.getAttribute("data-open") === "true";
      closeMenus(m);
      m.setAttribute("data-open", open ? "false" : "true");
      btn.setAttribute("aria-expanded", open ? "false" : "true");
      if (!open) {
        var first = m.querySelector("[data-menu-panel] a");
        if (first) first.focus();
      }
    });
    m.addEventListener("keydown", function (e) {
      if (e.key === "Escape") { closeMenus(); btn.focus(); }
    });
    // Leaving the group by keyboard closes it so it cannot linger open.
    m.addEventListener("focusout", function (e) {
      if (!m.contains(e.relatedTarget)) closeMenus();
    });
  });
  document.addEventListener("click", function () { closeMenus(); });

  // Must match the CSS breakpoint where the desktop nav takes over.
  var mq = window.matchMedia("(min-width: 64rem)");
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
