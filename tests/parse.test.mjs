import test from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, extractDocument } from "../scripts/lib/parse.mjs";

test("decodeEntities handles named and numeric entities", () => {
  assert.equal(decodeEntities("A &amp; B &lt; C &#39;x&#x2F;y&#8364;"), "A & B < C 'x/y€");
});

test("extracts title, meta, canonical, h1 and lang", () => {
  const html = `<!doctype html><html lang="en"><head>
    <base href="https://example.com/blog/">
    <title>  A &amp; B  </title>
    <meta name="description" content="Desc &quot;quoted&quot;">
    <meta name="robots" content="noindex, follow">
    <link rel="canonical" href="../canonical">
  </head><body><h1>Hello <em>world</em></h1></body></html>`;

  const doc = extractDocument(html, "https://example.com/page");

  assert.equal(doc.title, "A & B");
  assert.equal(doc.titleCount, 1);
  assert.equal(doc.metaDescription, 'Desc "quoted"');
  assert.equal(doc.metaRobots, "noindex, follow");
  assert.equal(doc.canonical, "https://example.com/canonical");
  assert.deepEqual(doc.h1, ["Hello world"]);
  assert.equal(doc.lang, "en");
});

test("ignores title and meta text inside scripts", () => {
  const html = `<html><head>
    <script>document.write('<title>Fake</title><meta name="description" content="fake">')</script>
    <title>Real</title>
  </head><body><h1>One</h1></body></html>`;

  const doc = extractDocument(html, "https://example.com/");

  assert.equal(doc.title, "Real");
  assert.equal(doc.titleCount, 1);
  assert.equal(doc.metaDescription, null);
});

test("counts multiple titles, canonicals and h1s", () => {
  const html = `<html><head>
    <title>One</title><title>Two</title>
    <link rel="canonical" href="https://example.com/a">
    <link rel="canonical" href="https://example.com/b">
  </head><body><h1>First</h1><h1>Second</h1></body></html>`;

  const doc = extractDocument(html, "https://example.com/");

  assert.equal(doc.titleCount, 2);
  assert.equal(doc.title, "Two");
  assert.equal(doc.canonicalCount, 2);
  assert.equal(doc.canonical, "https://example.com/a");
  assert.deepEqual(doc.h1, ["First", "Second"]);
});

test("resolves and deduplicates http anchors", () => {
  const html = `<html><body>
    <a href="/a">A</a>
    <a href="/a">Again</a>
    <a href="#frag">Skip</a>
    <a href="mailto:x@example.com">Mail</a>
    <a href="https://other.example/x">External</a>
  </body></html>`;

  const doc = extractDocument(html, "https://example.com/page");

  assert.deepEqual(doc.anchors, [
    { href: "https://example.com/a", text: "A" },
    { href: "https://other.example/x", text: "External" },
  ]);
});

test("collects JSON-LD types including @graph arrays", () => {
  const html = `<html><head>
    <script type="application/ld+json">{"@context":"https://schema.org","@type":"Article"}</script>
    <script type="application/ld+json">{"@graph":[{"@type":["WebSite","Organization"]}]}</script>
  </head><body></body></html>`;

  const doc = extractDocument(html, "https://example.com/");

  assert.equal(doc.jsonLd.count, 2);
  assert.deepEqual(doc.jsonLd.types, ["Article", "Organization", "WebSite"]);
  assert.equal(doc.jsonLd.invalid, false);
});

test("flags invalid JSON-LD without inventing schema absence", () => {
  const html = `<html><head>
    <script type="application/ld+json">{not json}</script>
  </head><body></body></html>`;

  const doc = extractDocument(html, "https://example.com/");

  assert.equal(doc.jsonLd.count, 1);
  assert.equal(doc.jsonLd.invalid, true);
  assert.deepEqual(doc.jsonLd.types, []);
});
