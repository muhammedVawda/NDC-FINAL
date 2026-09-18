(function () {
  "use strict";

  var header = document.querySelector("[data-site-header]");
  if (!header) return;

  var toggle = header.querySelector("[data-nav-toggle]");
  var nav = header.querySelector("[data-primary-nav]");
  if (!toggle || !nav) return;

  function setOpen(open) {
    header.setAttribute("data-nav-open", open ? "true" : "false");
    toggle.setAttribute("aria-expanded", open ? "true" : "false");
    document.documentElement.style.overflow = open ? "hidden" : "";
    if (open) {
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
