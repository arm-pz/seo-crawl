# seo-crawl

An agent skill that crawls a site you own and returns deterministic, evidence-backed technical SEO findings as JSON.

**Status: v0.1.0.** Read-only, bounded, zero dependencies, Node 20+.

## What it does

- Runs a bounded same-origin crawl seeded by the start URL, robots.txt sitemaps, and `/sitemap.xml`; follows internal links breadth-first.
- Records per-URL evidence: HTTP status, final URL and redirect chain, indexability (meta and header robots), canonical, title, meta description, H1s, `lang`, internal links, and static JSON-LD.
- Cross-checks duplicate titles and descriptions, broken internal links, sitemap coverage, and invalid JSON-LD.
- Emits findings with stable IDs and explicit `complete`/`inconclusive` coverage checks, so an unassessable area is never reported as a pass.
- Obeys robots.txt, stays on one origin, ignores assets and external links, and bounds every request by timeout, byte cap, page limit, depth, and delay.

## What it does not do

- No Search Console, analytics, rankings, keyword volumes, or backlinks.
- No JavaScript rendering, so client-injected content and tags are not assessable.
- No Core Web Vitals or Lighthouse. Use `pre-ship-performance-audit`.
- No diagnosis or prioritization. Use `seo-audit`.
- No query ownership or cannibalization decisions. Use `keyword-guard`.
- No release-security checks. Use `web-preflight`.
- No implementation, content rewrites, or CMS changes. Use `wordsmith` after findings are approved.

## Install

```
npx skills add arm-pz/seo-crawl --skill seo-crawl
```

Or copy the folder into your user skills directory:

```bash
cp -r SKILL.md scripts references examples ~/.qoder/skills/seo-crawl/
```

Then run `/skills reload` (or restart the session) and invoke with `/seo-crawl`.

## Use

```bash
node scripts/seo-crawl.mjs --url https://example.com --out reports/seo-crawl.json
node scripts/seo-crawl.mjs --url https://example.com --format markdown
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--url <url>` | required | Start URL; `http` or `https` |
| `--out <file>` | stdout | Write the report to a file |
| `--format json\|markdown` | `json` | Machine or human output |
| `--max-pages <n>` | 25 | Hard page budget |
| `--max-depth <n>` | 3 | Link hops from the seeds |
| `--timeout <ms>` | 10000 | Per-request timeout |
| `--delay <ms>` | 250 | Delay between requests |
| `--fail-on none\|error\|warning` | none | Exit 1 when findings at that severity exist |

Exit codes: `0` report produced, `1` `--fail-on` matched or the output file could not be written, `2` usage error.

## Output

The report contains `checks` (five coverage states), `findings` (severity, rule, URL, evidence, stable ID), `pages` (per-URL evidence), and a summary. See [references/findings-schema.md](references/findings-schema.md) for the contract and [examples/sample-report.md](examples/sample-report.md) for a real-shaped report.

A finding is `open` from this tool. A calling workflow records `fixed-verified` only when a re-crawl no longer fires the same ID and the covering check is `complete`; `fixed-unproven` when the check is inconclusive; `accepted-risk` when the owner accepts it. See [references/checks.md](references/checks.md) for every rule, severity, and false-positive note.

## Known limits

- Static HTML only. The crawler fetches same-origin HTML pages up to the page and depth limits; assets, PDFs, and external links are not verified.
- Link checks only cover targets actually crawled. Unfetched targets make `internal-links` inconclusive.
- A robots.txt network error or 5xx does not stop the crawl, but marks `robots` inconclusive.
- A missing, unreadable, or invalid sitemap leaves sitemap coverage inconclusive.
- Gzipped sitemaps are not supported.
- No soft-404, hreflang, canonical-chain, or near-duplicate detection.

## Development

```bash
npm test
```

The suite uses `node:test` only and runs against a local fixture HTTP server; no network access is required. The crawler, parser, robots, sitemap, checks, report renderer, and CLI each have their own tests.

```
seo-crawl/
├── SKILL.md
├── scripts/
│   ├── seo-crawl.mjs
│   └── lib/
│       ├── parse.mjs
│       ├── robots.mjs
│       ├── fetch.mjs
│       ├── sitemap.mjs
│       ├── checks.mjs
│       ├── crawl.mjs
│       └── report.mjs
├── references/
│   ├── checks.md
│   └── findings-schema.md
├── examples/sample-report.md
├── tests/
│   ├── helpers/server.mjs
│   └── *.test.mjs
└── .claude-plugin/plugin.json
```

## Provenance

Original work. The finding-record shape and the `INCONCLUSIVE` discipline follow the MIT-licensed [`arm-pz/web-preflight`](https://github.com/arm-pz/web-preflight). Complements the Caffeinity SEO stack: `seo-audit` (third-party, MIT), `keyword-guard`, `pre-ship-performance-audit`, and `wordsmith`.

## License

MIT. See `LICENSE`.
