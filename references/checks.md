# Checks and findings

Every rule below is deterministic and derived from fetched evidence. Values are normalized: URLs drop fragments, text is entity-decoded and whitespace-collapsed, and comparisons for duplicates are case-insensitive.

Severities: `error` breaks fetching or indexation; `warning` degrades discovery or presentation; `info` is an observation with no implied action.

## Page rules

| Rule | Severity | Fires when | Evidence |
| --- | --- | --- | --- |
| `fetch-failed` | error | The start URL could not be fetched (timeout or network) | `code`, `message` |
| `http-error` | error | The start URL returned a non-2xx status | `status` |
| `redirect` | info | A fetched HTML page resolved through at least one redirect | `finalUrl`, `hops` |
| `noindex-meta` | warning | `<meta name="robots">` contains `noindex` | `content` |
| `noindex-header` | warning | `X-Robots-Tag` contains `noindex` | `content` |
| `title-missing` | error | No `<title>` element, or an empty one | — |
| `title-multiple` | warning | More than one `<title>`; the last one is evaluated | `count` |
| `title-long` | info | Title exceeds 60 characters | `length` |
| `title-short` | info | Title is under 15 characters | `length` |
| `description-missing` | warning | No `meta[name=description]` with content | — |
| `description-long` | info | Description exceeds 160 characters | `length` |
| `h1-missing` | warning | No `<h1>` element | — |
| `h1-multiple` | warning | More than one `<h1>` | `count` |
| `lang-missing` | warning | `<html>` has no `lang` attribute | — |
| `json-ld-invalid` | warning | At least one `application/ld+json` block fails `JSON.parse` | `blocks` |
| `canonical-multiple` | warning | More than one `rel=canonical` link; the first is evaluated | `count`, `canonical` |
| `canonical-offsite` | warning | First canonical points to a different origin | `canonical` |
| `canonical-other` | info | First canonical is same-origin, differs from the page, and its target did not fail | `canonical` |
| `canonical-broken` | error | Canonical target was fetched and returned 4xx/5xx or a fetch error | `canonical`, `status` |

`canonical-other` and `canonical-broken` require a single canonical. Nothing is reported for a missing canonical: many valid pages omit it, and its absence is not evidence of a defect.

## Cross-page rules

Duplicate checks consider only **indexable pages**: HTTP 2xx, HTML, not noindex (meta or header), and with no canonical pointing elsewhere. A page canonicalized to another URL does not compete for the same query.

| Rule | Severity | Fires when | Evidence |
| --- | --- | --- | --- |
| `duplicate-title` | warning | Two or more indexable pages share a normalized title; one finding per URL | `title`, `duplicatesWith` |
| `duplicate-description` | warning | Two or more indexable pages share a normalized description; one finding per URL | `description`, `duplicatesWith` |
| `broken-internal-link` | error | A same-origin, robots-allowed link target was fetched and failed | `target`, `status`, `error` when applicable |
| `not-in-sitemap` | warning | An indexable crawled page is absent from every parsed sitemap | — |

`broken-internal-link` is attributed to the linking page, not the target. There is no `http-error` finding for a non-start URL that fails only because it was linked; the broken-link finding is the actionable record.

## Sitemap rules

| Rule | Severity | Fires when | Evidence |
| --- | --- | --- | --- |
| `sitemap-blocked` | error | robots.txt disallows a URL listed in the sitemap | — |
| `sitemap-url-error` | error | A sitemap URL was fetched and failed; the start URL is excluded because `fetch-failed`/`http-error` already covers it | `status`, `error` when applicable |
| `sitemap-noindex` | warning | A sitemap URL resolves to a page marked noindex | — |

`not-in-sitemap` is reported only when at least one URL set parsed. A missing or unreadable sitemap never produces sitemap findings; it makes the `sitemap` and `sitemap-coverage` checks inconclusive.

## Start blocked

| Rule | Severity | Fires when | Evidence |
| --- | --- | --- | --- |
| `robots-blocked-start` | error | robots.txt disallows the start URL; no pages are fetched | — |

## Checks

Checks state what the crawl could actually assess. They are never folded into "no findings".

| Check | Complete when | Otherwise |
| --- | --- | --- |
| `robots` | robots.txt was fetched, or returned 4xx (treated as absent) | network failure or 5xx: inconclusive; crawling continues |
| `sitemap` | at least one sitemap URL set parsed | no readable sitemap: inconclusive |
| `sitemap-coverage` | every collected same-origin sitemap URL was fetched or robots-blocked | unconsumed URLs (budget, depth, errors): inconclusive |
| `internal-links` | every same-origin, robots-allowed anchor target was fetched | unfetched targets: inconclusive |
| `crawl-coverage` | the queue emptied without hitting a page or depth limit | limit reached: inconclusive; `detail` names which |

## Deliberate non-checks

Do not invent findings for these:

- Missing canonical tags, missing JSON-LD, short meta descriptions, keyword density, word count, heading order (h2 before h3), or image alt text. They are style or content decisions, not measured crawl defects.
- Soft 404s (a 200 page that says "not found"), hreflang reciprocity, canonical chains, trailing-slash duplication, or near-duplicate content. The crawler cannot establish these from a bounded static crawl.
- Client-rendered titles, canonicals, links, or JSON-LD. If the HTML shell is empty, report the affected checks INCONCLUSIVE, not missing.

## Reading evidence carefully

- **JavaScript-rendered sites** — an empty shell can look like every tag is missing. Check whether the fetched HTML actually contains the page content before reporting.
- **Bot protection** — a challenge or WAF page returned as 200 is not the site's page. Mark affected facts inconclusive.
- **Duplicates** — only exact normalized matches are reported. Near-duplicates are out of scope.
- **Sitemap absence** — the site may simply use another discovery path. Inconclusive is not a defect.
- **Title and description lengths** — thresholds are advisory; the finding is informational, not a ranking claim.
- **`redirect`** — a redirect is often intentional (HTTP to HTTPS, canonical host). Treat it as evidence, not automatically a fix.
