# Findings JSON schema

The crawler writes one JSON object per crawl. The shape is versioned by `schemaVersion` (currently `1`). Fields with fixed meaning are listed here; consumers should ignore unknown fields.

## Top level

| Field | Type | Meaning |
| --- | --- | --- |
| `schemaVersion` | number | Report schema version |
| `generator` | `{ name, version }` | `seo-crawl` and its package version |
| `generatedAt` | ISO 8601 string | The only time-varying field; everything else is deterministic for the same crawl |
| `startUrl` | string | Normalized start URL |
| `origin` | string | Origin used as the crawl boundary |
| `limits` | object | `maxPages`, `maxDepth`, `timeoutMs`, `maxBytes`, `delayMs` in effect |
| `robots` | object | `available`, `found`, `sitemaps`, `crawlDelay` |
| `sitemap` | object | `available`, `urlCount`, `sources[]`, `error` |
| `pages` | array | Per-fetched-URL evidence |
| `findings` | array | Defects and observations, sorted |
| `checks` | array | Coverage states, five fixed ids |
| `summary` | object | `pagesFetched`, `findings` by severity, `checks` by status |
| `truncated` | boolean | A page or depth limit stopped the crawl |
| `inconclusive` | boolean | At least one check is inconclusive |

## Finding

```json
{
  "id": "title-missing:https://example.com/pricing",
  "rule": "title-missing",
  "severity": "error",
  "url": "https://example.com/pricing",
  "message": "Page has no title.",
  "evidence": {},
  "status": "open"
}
```

- `id` is stable across runs and unique within a report. It is `rule:url`, except `broken-internal-link` uses `rule:sourceUrl->targetUrl`.
- `rule` is the machine key. The full table with severities and evidence is in `references/checks.md`.
- `severity` is `error`, `warning`, or `info`. It describes technical impact, not traffic or ranking impact.
- `url` is the page the finding is attributed to. For sitemap findings it is the sitemap URL; for broken links it is the linking page, with the target in evidence.
- `evidence` is a compact object. It never contains raw page bodies, secrets, or credentials.
- `status` is always `open` from this tool. A calling workflow may set `fixed-verified`, `fixed-unproven`, or `accepted-risk` in its own ledger; do not write those states into the crawler report.

Findings are sorted by severity (`error`, `warning`, `info`), then rule, then URL, then id. A re-crawl can therefore be diffed by `id` without post-processing.

## Check

```json
{
  "id": "sitemap",
  "status": "inconclusive",
  "detail": "no readable sitemap found"
}
```

- `status` is `complete` or `inconclusive`.
- `complete` means the named coverage was actually assessed; it does not mean the site is defect-free.
- `inconclusive` means absence of related findings is not evidence of correctness.
- The five ids are `robots`, `sitemap`, `sitemap-coverage`, `internal-links`, and `crawl-coverage`.

## Page record

Each entry carries `url`, `finalUrl`, `status`, `ok`, `contentType`, `bytes`, `truncated`, `redirects[]`, `error`, and parsed facts when the response was HTML: `title`, `metaDescription`, `canonical`, `h1Count`, `lang`, and `jsonLd` (`types[]`, `invalid`). Facts are `null` for non-HTML or failed responses. `truncated` means the body hit `maxBytes`; facts may then be incomplete.

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Report produced |
| 1 | `--fail-on` matched a finding severity, or the output file could not be written |
| 2 | Usage error: missing/invalid URL, unknown option, invalid numeric value |

`--fail-on` defaults to `none`. A non-zero exit does not change the report; it only gates a pipeline.

## Determinism rules

- Same site state, same options, and the same crawler version produce the same report except `generatedAt`.
- Crawl order is deterministic: start URL, sorted sitemap seeds, then breadth-first discovered links in document order.
- Findings and page records are sorted before output.
- Changing `maxPages`, `maxDepth`, or the start URL can change findings; compare runs only under identical limits.
