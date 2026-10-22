import test from "node:test";
import assert from "node:assert/strict";
import { isAllowed, parseRobots, selectRules } from "../scripts/lib/robots.mjs";

const UA = "seo-crawl/0.1 (+https://github.com/arm-pz/seo-crawl)";

test("permits everything when robots.txt is empty or missing", () => {
  for (const text of ["", null, undefined]) {
    const robots = parseRobots(text);
    assert.equal(isAllowed(robots, "/anything", UA), true);
  }
});

test("disallow root blocks every path", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /");
  assert.equal(isAllowed(robots, "/", UA), false);
  assert.equal(isAllowed(robots, "/blog/post", UA), false);
});

test("an empty disallow rule permits everything", () => {
  const robots = parseRobots("User-agent: *\nDisallow:\nAllow: /");
  assert.equal(isAllowed(robots, "/blog", UA), true);
});

test("longest matching rule wins and allow wins ties", () => {
  const robots = parseRobots(
    ["User-agent: *", "Disallow: /private", "Allow: /private/public"].join("\n"),
  );
  assert.equal(isAllowed(robots, "/private/secret", UA), false);
  assert.equal(isAllowed(robots, "/private/public/page", UA), true);
  assert.equal(isAllowed(robots, "/public", UA), true);

  const tie = parseRobots(["User-agent: *", "Disallow: /same", "Allow: /same"].join("\n"));
  assert.equal(isAllowed(tie, "/same", UA), true);
});

test("supports wildcard and end-anchor patterns", () => {
  const robots = parseRobots(
    ["User-agent: *", "Disallow: /*.pdf$", "Disallow: /exact$"].join("\n"),
  );
  assert.equal(isAllowed(robots, "/files/report.pdf", UA), false);
  assert.equal(isAllowed(robots, "/files/report.pdf?v=2", UA), true);
  assert.equal(isAllowed(robots, "/exact", UA), false);
  assert.equal(isAllowed(robots, "/exact/more", UA), true);
});

test("a named user-agent group overrides the wildcard group", () => {
  const robots = parseRobots(
    [
      "User-agent: *",
      "Disallow: /",
      "",
      "User-agent: seo-crawl",
      "Disallow: /admin",
      "",
      "User-agent: other-bot",
      "Disallow: /",
    ].join("\n"),
  );
  assert.equal(isAllowed(robots, "/blog", UA), true);
  assert.equal(isAllowed(robots, "/admin/users", UA), false);
  assert.equal(isAllowed(robots, "/anything", "other-bot/2.0"), false);
});

test("groups sharing the same agents are combined", () => {
  const robots = parseRobots(
    ["User-agent: seo-crawl", "Disallow: /a", "", "User-agent: seo-crawl", "Disallow: /b"].join(
      "\n",
    ),
  );
  assert.equal(isAllowed(robots, "/a", UA), false);
  assert.equal(isAllowed(robots, "/b", UA), false);
  assert.equal(isAllowed(robots, "/c", UA), true);

  const rules = selectRules(robots, UA);
  assert.equal(rules.length, 2);
});

test("collects sitemap directives with comments and blank lines", () => {
  const robots = parseRobots(
    [
      "# robots for example.com",
      "User-agent: *",
      "Disallow: /tmp",
      "",
      "Sitemap: https://example.com/sitemap.xml",
      "sitemap: https://example.com/news-sitemap.xml ",
    ].join("\n"),
  );
  assert.deepEqual(robots.sitemaps, [
    "https://example.com/sitemap.xml",
    "https://example.com/news-sitemap.xml",
  ]);
});

test("records crawl-delay when present", () => {
  const robots = parseRobots("User-agent: *\nCrawl-delay: 2.5\nDisallow: /x");
  assert.equal(robots.crawlDelay, 2.5);
  assert.equal(parseRobots("User-agent: *").crawlDelay, null);
});

test("accepts absolute URLs and keeps query strings", () => {
  const robots = parseRobots(["User-agent: *", "Disallow: /search?q=", "Disallow: /login"].join("\n"));
  assert.equal(isAllowed(robots, "https://example.com/search?q=abc", UA), false);
  assert.equal(isAllowed(robots, "https://example.com/search", UA), true);
  assert.equal(isAllowed(robots, "/login?next=/home", UA), false);
});
