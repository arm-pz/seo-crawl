import test from "node:test";
import assert from "node:assert/strict";
import { extractDocument } from "../scripts/lib/parse.mjs";
import { evaluate } from "../scripts/lib/checks.mjs";

function makePage(url, html, options = {}) {
  const status = options.status ?? 200;
  const finalUrl = options.finalUrl ?? url;
  const doc = html == null ? null : extractDocument(html, finalUrl);
  return {
    url,
    finalUrl,
    status,
    ok: status >= 200 && status < 300,
    contentType: "text/html; charset=utf-8",
    charset: "utf-8",
    headers: { "content-type": "text/html", ...options.headers },
    body: html,
    bytes: html ? html.length : 0,
    truncated: options.truncated ?? false,
    redirects: options.redirects ?? [],
    error: options.error ?? null,
    doc,
  };
}

function context(overrides = {}) {
  return {
    startUrl: "https://example.com/page",
    origin: "https://example.com",
    linkStatus: new Map(),
    robotsAvailable: true,
    isAllowed: () => true,
    sitemapAvailable: true,
    sitemapUrls: [],
    sitemapError: null,
    crawlTruncated: false,
    ...overrides,
  };
}

function goodHtml(url, overrides = {}) {
  const title = overrides.title ?? "A reasonably descriptive page title";
  const description =
    overrides.description ?? "A useful description of this page for search results.";
  return `<html lang="en"><head>
    <title>${title}</title>
    <meta name="description" content="${description}">
    <link rel="canonical" href="${overrides.canonical ?? url}">
  </head><body><h1>Heading</h1>${overrides.body ?? ""}</body></html>`;
}

function rules(findings) {
  return findings.map((finding) => finding.rule).sort();
}

test("a clean page produces no findings and complete checks", () => {
  const url = "https://example.com/page";
  const result = evaluate([makePage(url, goodHtml(url))], context({ sitemapUrls: [url] }));

  assert.deepEqual(result.findings, []);
  assert.deepEqual(
    result.checks.map((check) => check.status),
    ["complete", "complete", "complete", "complete", "complete"],
  );
});

test("flags missing title, description, lang, multiple h1s, invalid JSON-LD and canonical problems", () => {
  const url = "https://example.com/broken";
  const html = `<html><head>
    <link rel="canonical" href="https://other.example/x">
    <link rel="canonical" href="https://example.com/broken">
    <script type="application/ld+json">{oops}</script>
  </head><body><h1>A</h1><h1>B</h1></body></html>`;

  const result = evaluate([makePage(url, html)], context({ sitemapUrls: [url] }));

  assert.deepEqual(rules(result.findings), [
    "canonical-multiple",
    "canonical-offsite",
    "description-missing",
    "h1-multiple",
    "json-ld-invalid",
    "lang-missing",
    "title-missing",
  ]);
  assert.equal(result.findings.find((f) => f.rule === "title-missing").severity, "error");
  assert.equal(result.findings.find((f) => f.rule === "description-missing").severity, "warning");
});

test("reports noindex from meta and X-Robots-Tag separately", () => {
  const url = "https://example.com/hidden";
  const html = `<html lang="en"><head>
    <title>A reasonably descriptive page title</title>
    <meta name="description" content="A useful description of this page for search results.">
    <meta name="robots" content="noindex, follow">
  </head><body><h1>Hidden</h1></body></html>`;

  const result = evaluate(
    [makePage(url, html, { headers: { "x-robots-tag": "noindex" } })],
    context({ sitemapUrls: [] }),
  );

  assert.deepEqual(rules(result.findings), ["noindex-header", "noindex-meta"]);
  assert.equal(result.checks.find((check) => check.status === "inconclusive"), undefined);
});

test("flags duplicate titles but not duplicate descriptions when they differ", () => {
  const first = "https://example.com/one";
  const second = "https://example.com/two";
  const title = "A shared title that two pages both use";
  const pages = [
    makePage(first, goodHtml(first, { title, description: "Description for the first page only." })),
    makePage(second, goodHtml(second, { title, description: "Description for the second page only." })),
  ];

  const result = evaluate(pages, context({ sitemapUrls: [first, second] }));
  const duplicates = result.findings.filter((finding) => finding.rule === "duplicate-title");

  assert.equal(duplicates.length, 2);
  assert.deepEqual(
    duplicates.map((finding) => finding.url).sort(),
    [first, second],
  );
  assert.deepEqual(duplicates[0].evidence.duplicatesWith, [second]);
  assert.equal(result.findings.some((finding) => finding.rule === "duplicate-description"), false);
});

test("reports broken internal links with target evidence and marks link checking inconclusive", () => {
  const source = "https://example.com/page";
  const missing = "https://example.com/missing";
  const unknown = "https://example.com/unknown";
  const html = goodHtml(source, {
    body: `<a href="/missing">Missing</a><a href="/unknown">Unknown</a>`,
  });
  const linkStatus = new Map([
    [source, { status: 200, error: null }],
    [missing, { status: 404, error: null }],
  ]);

  const result = evaluate(
    [makePage(source, html), makePage(missing, "<html><body>gone</body></html>", { status: 404 })],
    context({ sitemapUrls: [source], linkStatus }),
  );

  const broken = result.findings.filter((finding) => finding.rule === "broken-internal-link");
  assert.equal(broken.length, 1);
  assert.equal(broken[0].severity, "error");
  assert.deepEqual(broken[0].evidence, { target: missing, status: 404 });
  assert.equal(
    result.checks.find((check) => check.id === "internal-links").status,
    "inconclusive",
  );
});

test("checks sitemap coverage: errors, noindex entries, robots-blocked URLs and missing pages", () => {
  const ok = "https://example.com/ok";
  const gone = "https://example.com/gone";
  const hidden = "https://example.com/hidden";
  const blocked = "https://example.com/private";
  const extra = "https://example.com/extra";

  const hiddenHtml = goodHtml(hidden).replace(
    '<link rel="canonical"',
    '<meta name="robots" content="noindex"><link rel="canonical"',
  );

  const pages = [
    makePage(ok, goodHtml(ok)),
    makePage(gone, "<html><body>gone</body></html>", { status: 404 }),
    makePage(hidden, hiddenHtml),
    makePage(extra, goodHtml(extra)),
  ];
  const linkStatus = new Map(pages.map((page) => [page.url, { status: page.status, error: null }]));

  const result = evaluate(
    pages,
    context({
      startUrl: ok,
      sitemapUrls: [ok, gone, hidden, blocked],
      linkStatus,
      isAllowed: (url) => url !== blocked,
    }),
  );

  const byRule = Object.fromEntries(result.findings.map((finding) => [finding.rule, finding]));
  assert.equal(byRule["sitemap-url-error"].url, gone);
  assert.equal(byRule["sitemap-noindex"].url, hidden);
  assert.equal(byRule["sitemap-blocked"].url, blocked);
  assert.equal(byRule["not-in-sitemap"].url, extra);
  assert.equal(result.findings.some((finding) => finding.rule === "http-error"), false);
});

test("reports INCONCLUSIVE sitemap coverage instead of inventing findings", () => {
  const url = "https://example.com/page";
  const result = evaluate(
    [makePage(url, goodHtml(url))],
    context({ sitemapAvailable: false, sitemapUrls: null, sitemapError: "404" }),
  );

  const sitemap = result.checks.find((check) => check.id === "sitemap");
  assert.equal(sitemap.status, "inconclusive");
  assert.equal(sitemap.detail, "404");
  assert.equal(result.findings.some((finding) => finding.rule === "not-in-sitemap"), false);
});

test("reports INCONCLUSIVE robots when robots.txt could not be fetched", () => {
  const url = "https://example.com/page";
  const result = evaluate(
    [makePage(url, goodHtml(url))],
    context({ robotsAvailable: false, sitemapUrls: [url] }),
  );
  assert.equal(result.checks.find((check) => check.id === "robots").status, "inconclusive");
});

test("flags long titles and descriptions as informational only", () => {
  const url = "https://example.com/long";
  const html = goodHtml(url, {
    title: "T".repeat(80),
    description: "D".repeat(200),
  });

  const result = evaluate([makePage(url, html)], context({ sitemapUrls: [url] }));
  const long = result.findings.filter((finding) => finding.severity === "info");

  assert.deepEqual(rules(long), ["description-long", "title-long"]);
  assert.equal(result.findings.filter((finding) => finding.severity !== "info").length, 0);
});

test("flags same-origin canonical targets that differ and canonical targets that fail", () => {
  const other = "https://example.com/other";
  const gone = "https://example.com/gone";
  const first = "https://example.com/first";
  const second = "https://example.com/second";
  const linkStatus = new Map([
    [other, { status: 200, error: null }],
    [gone, { status: 404, error: null }],
  ]);

  const result = evaluate(
    [
      makePage(first, goodHtml(first, { canonical: other })),
      makePage(second, goodHtml(second, { canonical: gone })),
    ],
    context({ sitemapUrls: [first, second], linkStatus }),
  );

  assert.equal(result.findings.find((finding) => finding.rule === "canonical-other").severity, "info");
  const broken = result.findings.find((finding) => finding.rule === "canonical-broken");
  assert.equal(broken.severity, "error");
  assert.deepEqual(broken.evidence, { canonical: gone, status: 404 });
});

test("reports when robots blocks the start URL", () => {
  const url = "https://example.com/page";
  const result = evaluate(
    [],
    context({ startUrl: url, startBlocked: true, sitemapAvailable: false, sitemapUrls: null }),
  );

  assert.equal(result.findings[0].rule, "robots-blocked-start");
  assert.equal(result.findings[0].severity, "error");
  assert.equal(result.findings[0].url, url);
});

test("ignores internal links disallowed by robots instead of marking them unverified", () => {
  const source = "https://example.com/page";
  const html = goodHtml(source, { body: `<a href="/private">Private</a>` });
  const result = evaluate(
    [makePage(source, html)],
    context({
      sitemapUrls: [source],
      isAllowed: (url) => !url.includes("/private"),
    }),
  );

  assert.equal(result.checks.find((check) => check.id === "internal-links").status, "complete");
  assert.equal(result.findings.length, 0);
});

test("flags a failing start URL and never emits duplicate finding ids", () => {
  const url = "https://example.com/page";
  const failed = makePage(url, null, {
    status: null,
    ok: false,
    error: { code: "timeout", message: "request exceeded 10000 ms" },
  });

  const result = evaluate([failed], context({ sitemapUrls: [url] }));

  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].rule, "fetch-failed");
  assert.equal(result.findings[0].severity, "error");

  const ids = result.findings.map((finding) => finding.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(ids[0], /^fetch-failed:https:\/\/example\.com\/page$/);
});
