import test from "node:test";
import assert from "node:assert/strict";
import { parseSitemap } from "../scripts/lib/sitemap.mjs";

test("parses a urlset with entities and CDATA", () => {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <url><loc>https://example.com/a?x=1&amp;y=2</loc><lastmod>2026-01-01</lastmod></url>
    <url>
      <loc><![CDATA[https://example.com/b?x=1&y=2]]></loc>
    </url>
  </urlset>`;

  const result = parseSitemap(xml);

  assert.equal(result.type, "urlset");
  assert.equal(result.invalid, false);
  assert.deepEqual(result.urls, [
    "https://example.com/a?x=1&y=2",
    "https://example.com/b?x=1&y=2",
  ]);
  assert.deepEqual(result.sitemaps, []);
});

test("parses a sitemapindex", () => {
  const xml = `<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
    <sitemap><loc>https://example.com/sitemap-pages.xml</loc></sitemap>
    <sitemap><loc> https://example.com/sitemap-posts.xml </loc><lastmod>2026-02-01</lastmod></sitemap>
  </sitemapindex>`;

  const result = parseSitemap(xml);

  assert.equal(result.type, "sitemapindex");
  assert.deepEqual(result.sitemaps, [
    "https://example.com/sitemap-pages.xml",
    "https://example.com/sitemap-posts.xml",
  ]);
  assert.deepEqual(result.urls, []);
});

test("skips entries without a loc", () => {
  const xml = `<urlset>
    <url><lastmod>2026-01-01</lastmod></url>
    <url><loc>https://example.com/kept</loc></url>
  </urlset>`;

  assert.deepEqual(parseSitemap(xml).urls, ["https://example.com/kept"]);
});

test("marks non-sitemap documents invalid instead of returning empty success", () => {
  for (const xml of ["", "<html><body>404</body></html>", "not xml"]) {
    const result = parseSitemap(xml);
    assert.equal(result.type, null);
    assert.equal(result.invalid, true);
    assert.deepEqual(result.urls, []);
    assert.deepEqual(result.sitemaps, []);
  }
});
