/*
  Debt Advice listing: category filter + client-side search.

  The article cards are rendered as real HTML by scripts/build-blog.mjs —
  this only filters what's already in the DOM, so the page still works
  (all articles visible) with JavaScript disabled, and crawlers always see
  the full list.
*/
(function () {
  "use strict";

  var grid = document.getElementById("blog-grid");
  if (!grid) return;

  var cards = Array.prototype.slice.call(grid.querySelectorAll(".blog-card"));
  var filters = Array.prototype.slice.call(document.querySelectorAll(".blog-filter"));
  var searchInput = document.getElementById("blog-search-input");
  var empty = document.getElementById("blog-empty");

  var activeCategory = "All";
  var query = "";

  function apply() {
    var visible = 0;
    cards.forEach(function (card) {
      var matchesCategory = activeCategory === "All" || card.dataset.category === activeCategory;
      var matchesQuery = !query || (card.dataset.search || "").indexOf(query) !== -1;
      var show = matchesCategory && matchesQuery;
      card.hidden = !show;
      if (show) visible++;
    });
    if (empty) empty.hidden = visible !== 0;
  }

  filters.forEach(function (btn) {
    btn.addEventListener("click", function () {
      filters.forEach(function (b) {
        b.classList.toggle("is-active", b === btn);
        b.setAttribute("aria-pressed", b === btn ? "true" : "false");
      });
      activeCategory = btn.dataset.category;
      apply();
      if (window.ndcTrack) window.ndcTrack("blog_category_clicked", { category: activeCategory });
    });
    btn.setAttribute("aria-pressed", btn.classList.contains("is-active") ? "true" : "false");
  });

  if (searchInput) {
    var searchTimer;
    searchInput.addEventListener("input", function () {
      query = searchInput.value.trim().toLowerCase();
      apply();
      clearTimeout(searchTimer);
      // Only report the fact that a search happened (length bucket), never the text typed.
      searchTimer = setTimeout(function () {
        if (query && window.ndcTrack) window.ndcTrack("blog_search_performed", { hasResults: !empty || empty.hidden });
      }, 800);
    });
  }

  grid.addEventListener("click", function (e) {
    var card = e.target.closest(".blog-card");
    if (card && window.ndcTrack) {
      window.ndcTrack("blog_article_clicked", { category: card.dataset.category || "unknown" });
    }
  });
})();
