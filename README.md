# seo-crawl

An agent skill that crawls a site you own and returns deterministic, evidence-backed technical SEO findings.

**Status: scaffold.** The skill contract is being written. The crawler, findings schema, tests, and install line land in the next commits. Do not install this repo as a working skill yet.

## What it will own

- A bounded, read-only crawl of an authorized site.
- Per-URL evidence: HTTP status, final URL, indexability, canonical, title, meta description, H1s, internal-link status, and static JSON-LD presence.
- Sitemap discovery and coverage.
- Findings JSON with stable IDs, evidence, retrieval timestamps, confidence, and explicit `INCONCLUSIVE` states.

## What it will not do

- No Search Console, analytics, or keyword-volume access.
- No Core Web Vitals or Lighthouse measurement. Use `pre-ship-performance-audit`.
- No SEO strategy or prioritization. Use `seo-audit`.
- No query-ownership or cannibalization decisions. Use `keyword-guard`.
- No release-security checks. Use `web-preflight`.
- No implementation, content rewrites, or CMS changes.

## Why this exists

The existing SEO skills in this collection are prose frameworks. None ships deterministic evidence collection. `seo-crawl` produces the evidence layer those skills consume, with the same `INCONCLUSIVE` discipline as `web-preflight`.

## Planned layout

```
seo-crawl/
├── SKILL.md
├── README.md
├── LICENSE
├── package.json
├── .claude-plugin/plugin.json
├── scripts/
│   ├── seo-crawl.mjs
│   └── lib/
├── references/
│   ├── checks.md
│   └── findings-schema.md
├── tests/
│   ├── fixtures/
│   └── seo-crawl.test.mjs
└── examples/
    └── sample-report.md
```

## Provenance

Original work. The finding-record shape follows the MIT-licensed [`arm-pz/web-preflight`](https://github.com/arm-pz/web-preflight).

## License

MIT. See `LICENSE`.
