import test from "node:test";
import assert from "node:assert/strict";
import { renderMarkdown } from "../scripts/lib/report.mjs";

function sampleReport(overrides = {}) {
  return {
    schemaVersion: 1,
    generator: { name: "seo-crawl", version: "0.1.0" },
    generatedAt: "2026-10-22T10:00:00.000Z",
    startUrl: "https://example.com/",
    origin: "https://example.com",
    limits: { maxPages: 25, maxDepth: 3, timeoutMs: 10_000, maxBytes: 2_000_000, delayMs: 250 },
    robots: { available: true, found: true, sitemaps: [], crawlDelay: null },
    sitemap: { available: true, urlCount: 1, sources: [], error: null },
    pages: [],
    findings: [],
    checks: [
      { id: "robots", status: "complete", detail: "robots.txt resolved" },
      { id: "sitemap", status: "inconclusive", detail: "no readable sitemap found" },
    ],
    summary: {
      pagesFetched: 3,
      findings: { error: 1, warning: 2, info: 0 },
      checks: { complete: 1, inconclusive: 1 },
    },
    truncated: false,
    inconclusive: true,
    ...overrides,
  };
}

test("renders a report with no findings without claiming a pass", () => {
  const markdown = renderMarkdown(
    sampleReport({ findings: [], summary: { pagesFetched: 1, findings: { error: 0, warning: 0, info: 0 }, checks: { complete: 2, inconclusive: 0 } }, checks: [{ id: "robots", status: "complete", detail: "ok" }], inconclusive: false }),
  );

  assert.match(markdown, /^# seo-crawl report/);
  assert.match(markdown, /Start URL: https:\/\/example\.com\//);
  assert.match(markdown, /No findings\./);
});

test("marks inconclusive checks and refuses to imply completeness", () => {
  const markdown = renderMarkdown(sampleReport());

  assert.match(markdown, /INCONCLUSIVE — sitemap/);
  assert.match(markdown, /INCOMPLETE/);
  assert.match(markdown, /not a pass/i);
});

test("lists findings with id, url, severity and evidence", () => {
  const markdown = renderMarkdown(
    sampleReport({
      findings: [
        {
          id: "title-missing:https://example.com/a",
          rule: "title-missing",
          severity: "error",
          url: "https://example.com/a",
          message: "Page has no title.",
          evidence: {},
          status: "open",
        },
        {
          id: "duplicate-title:https://example.com/b",
          rule: "duplicate-title",
          severity: "warning",
          url: "https://example.com/b",
          message: "Title is shared by multiple indexable pages.",
          evidence: { title: "shared", duplicatesWith: ["https://example.com/c"] },
          status: "open",
        },
      ],
    }),
  );

  assert.match(markdown, /\[ERROR\] title-missing/);
  assert.match(markdown, /title-missing:https:\/\/example\.com\/a/);
  assert.match(markdown, /\[WARNING\] duplicate-title/);
  assert.match(markdown, /"duplicatesWith":\["https:\/\/example\.com\/c"\]/);
});
