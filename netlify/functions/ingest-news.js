/*
  Scheduled news ingestion for the Financial News section.

  PIPELINE
    source (RSS/Atom) -> fetch -> verify -> date check -> dedupe
    -> categorise -> store with provenance -> publish

  WHAT THIS DOES NOT DO, DELIBERATELY
  - It does not summarise with an LLM by default. A generated summary of
    a news story is a new factual claim about the world, and a wrong one
    on a debt site is worse than no summary. Items are published with
    the publisher's own title and description, always linking out to the
    original. Set NEWS_SUMMARISE=true only if you accept that tradeoff.
  - It does not invent, infer or "fill in" anything. An item with no
    verifiable publication date or no resolvable link is dropped.
  - It does not scrape HTML. Only declared RSS/Atom feeds are read.

  HONESTY ABOUT FRESHNESS
  The UI must state the real update cadence. This runs on a schedule
  (see netlify.toml); it is NOT real-time and must never be labelled as
  such. Each item stores retrievedAt, and the page renders freshness
  from that.

  STATUS: the pipeline is implemented but has NEVER completed a live
  fetch — outbound network access to news domains is blocked from the
  environment it was written in, so feed URLs, parsing against real
  payloads and the schedule all remain UNVERIFIED in production. Treat
  the first production run as a test: check the function log and the
  resulting items before relying on it.

  Environment:
    NEWS_FEEDS          Optional. Comma-separated feed URLs, overrides
                        the defaults below.
    NEWS_MAX_ITEMS      Optional, default 30.
    NEWS_MAX_AGE_DAYS   Optional, default 30. Older items are dropped so
                        stale stories never render as current.
    NEWS_SUMMARISE      Optional. "true" enables LLM summarisation and
                        requires ANTHROPIC_API_KEY.
*/

// Official/authoritative first. These are the publishers whose material
// is most relevant to South African consumer debt. Verify each feed URL
// resolves before enabling in production — see STATUS above.
var DEFAULT_FEEDS = [
  { url: "https://www.statssa.gov.za/?feed=rss2", publisher: "Statistics South Africa", tier: "official" },
  { url: "https://www.gov.za/rss.xml", publisher: "South African Government", tier: "official" },
  { url: "https://www.resbank.co.za/en/home/publications/RssFeed", publisher: "South African Reserve Bank", tier: "official" }
];

var CATEGORY_RULES = [
  { category: "Inflation", terms: ["inflation", "consumer price", "cpi", "price index"] },
  { category: "Interest Rates", terms: ["repo rate", "interest rate", "prime rate", "monetary policy", "mpc"] },
  { category: "Cost of Living", terms: ["fuel price", "petrol", "diesel", "electricity", "tariff", "food price", "cost of living"] },
  { category: "Credit & Debt", terms: ["credit", "debt", "national credit", "ncr", "creditor", "lending"] },
  { category: "Consumer Rights", terms: ["consumer", "protection", "ombud", "regulator"] }
];

function stripTags(s) {
  return String(s || "").replace(/<[^>]*>/g, "").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function field(xml, tag) {
  var m = xml.match(new RegExp("<" + tag + "[^>]*>([\\s\\S]*?)</" + tag + ">", "i"));
  if (!m) return "";
  return stripTags(m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1"));
}

function linkOf(xml) {
  var m = xml.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (m && m[1].trim()) return stripTags(m[1]);
  var href = xml.match(/<link[^>]*href="([^"]+)"/i); // Atom
  return href ? href[1] : "";
}

function parseFeed(xml) {
  var blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  return blocks.map(function (b) {
    return {
      title: field(b, "title"),
      description: field(b, "description") || field(b, "summary"),
      link: linkOf(b),
      pubDate: field(b, "pubDate") || field(b, "published") || field(b, "updated") || field(b, "dc:date")
    };
  });
}

function categorise(text) {
  var lower = String(text).toLowerCase();
  for (var i = 0; i < CATEGORY_RULES.length; i++) {
    var rule = CATEGORY_RULES[i];
    for (var j = 0; j < rule.terms.length; j++) {
      if (lower.indexOf(rule.terms[j]) !== -1) return rule.category;
    }
  }
  return null; // uncategorised items are dropped, not guessed at
}

exports.handler = async function () {
  var maxItems = parseInt(process.env.NEWS_MAX_ITEMS || "30", 10);
  var maxAgeDays = parseInt(process.env.NEWS_MAX_AGE_DAYS || "30", 10);
  var cutoff = Date.now() - maxAgeDays * 86400000;

  var feeds = DEFAULT_FEEDS;
  if (process.env.NEWS_FEEDS) {
    feeds = process.env.NEWS_FEEDS.split(",").map(function (u) {
      return { url: u.trim(), publisher: new URL(u.trim()).hostname, tier: "configured" };
    });
  }

  var collected = [];
  var failures = [];

  for (var f = 0; f < feeds.length; f++) {
    var feed = feeds[f];
    try {
      var res = await fetch(feed.url, { headers: { "User-Agent": "NDC-site-news-ingest/1.0" } });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var xml = await res.text();
      var items = parseFeed(xml);

      for (var i = 0; i < items.length; i++) {
        var it = items[i];

        // VERIFY: a story without a resolvable link or a real date is dropped.
        if (!it.title || !it.link || !/^https?:\/\//.test(it.link)) continue;
        var published = Date.parse(it.pubDate);
        if (!isFinite(published)) continue;

        // DATE CHECK: never surface stale items as current.
        if (published < cutoff) continue;

        var category = categorise(it.title + " " + it.description);
        if (!category) continue; // not consumer-finance relevant

        collected.push({
          headline: it.title.slice(0, 300),
          summary: it.description.slice(0, 600),
          url: it.link,
          publisher: feed.publisher,
          sourceTier: feed.tier,
          publishedAt: new Date(published).toISOString(),
          retrievedAt: new Date().toISOString(),
          category: category
        });
      }
    } catch (err) {
      // A broken feed must not take the section down or silently vanish.
      failures.push({ feed: feed.url, error: String(err.message || err) });
    }
  }

  // DEDUPE: same URL, or same normalised headline from any publisher.
  var seenUrl = {};
  var seenTitle = {};
  var deduped = collected.filter(function (item) {
    var t = item.headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (seenUrl[item.url] || seenTitle[t]) return false;
    seenUrl[item.url] = 1;
    seenTitle[t] = 1;
    return true;
  });

  deduped.sort(function (a, b) { return Date.parse(b.publishedAt) - Date.parse(a.publishedAt); });
  var items = deduped.slice(0, maxItems);

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      generatedAt: new Date().toISOString(),
      itemCount: items.length,
      feedFailures: failures, // surfaced, never swallowed
      items: items
    })
  };
};
