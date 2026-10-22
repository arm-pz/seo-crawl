const SEVERITY_RANK = { error: 0, warning: 1, info: 2 };
const TITLE_MIN = 15;
const TITLE_MAX = 60;
const DESCRIPTION_MAX = 160;

function normalizeUrl(value) {
  try {
    const url = new URL(value);
    url.hash = "";
    return url.href;
  } catch {
    return String(value ?? "");
  }
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

function makeFinding(rule, url, severity, message, evidence = {}, id = null) {
  return {
    id: id ?? `${rule}:${url}`,
    rule,
    severity,
    url,
    message,
    evidence,
    status: "open",
  };
}

function hasNoindex(page) {
  const meta = String(page.doc?.metaRobots ?? "").toLowerCase();
  const header = String(page.headers?.["x-robots-tag"] ?? "").toLowerCase();
  return /\bnoindex\b/.test(meta) || /\bnoindex\b/.test(header);
}

function isSameAsPage(canonical, page) {
  return normalizeUrl(canonical) === normalizeUrl(page.finalUrl ?? page.url);
}

function rankFindings(a, b) {
  return (
    SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
    a.rule.localeCompare(b.rule) ||
    a.url.localeCompare(b.url) ||
    a.id.localeCompare(b.id)
  );
}

export function evaluate(pages, context = {}) {
  const findings = [];
  const checks = [];
  const startUrl = context.startUrl ? normalizeUrl(context.startUrl) : null;
  const origin =
    context.origin ?? (pages[0] ? originOf(pages[0].finalUrl ?? pages[0].url) : null);
  const linkStatus = context.linkStatus ?? new Map();
  const isAllowed = typeof context.isAllowed === "function" ? context.isAllowed : () => true;

  const byUrl = new Map();
  for (const page of pages) {
    byUrl.set(normalizeUrl(page.url), page);
    if (page.finalUrl) byUrl.set(normalizeUrl(page.finalUrl), page);
  }

  const sitemapAvailable = Boolean(context.sitemapAvailable) && Array.isArray(context.sitemapUrls);
  const sitemapSet = new Set(
    sitemapAvailable ? context.sitemapUrls.map((url) => normalizeUrl(url)) : [],
  );
  const blockedSitemap = new Set();
  const unverifiedLinks = new Set();
  const indexable = [];

  if (context.startBlocked) {
    findings.push(
      makeFinding(
        "robots-blocked-start",
        context.startUrl,
        "error",
        "robots.txt disallows the start URL, so no pages were crawled.",
      ),
    );
  }

  for (const page of pages) {
    const pageUrl = page.url;

    if (page.error) {
      if (normalizeUrl(pageUrl) === startUrl) {
        findings.push(
          makeFinding(
            "fetch-failed",
            pageUrl,
            "error",
            `Could not fetch the start URL (${page.error.code}).`,
            { code: page.error.code, message: page.error.message ?? null },
          ),
        );
      }
      continue;
    }

    if (!page.ok) {
      if (normalizeUrl(pageUrl) === startUrl) {
        findings.push(
          makeFinding("http-error", pageUrl, "error", `Start URL returned HTTP ${page.status}.`, {
            status: page.status,
          }),
        );
      }
      continue;
    }

    if (!page.doc) continue;
    const doc = page.doc;

    if (page.redirects?.length) {
      findings.push(
        makeFinding("redirect", pageUrl, "info", "Page resolves through a redirect.", {
          finalUrl: page.finalUrl,
          hops: page.redirects.length,
        }),
      );
      const targetFetched = pages.some(
        (other) =>
          other !== page &&
          normalizeUrl(other.url) === normalizeUrl(page.finalUrl ?? page.url),
      );
      if (targetFetched) continue;
    }

    const metaRobots = String(doc.metaRobots ?? "");
    const headerRobots = String(page.headers?.["x-robots-tag"] ?? "");
    const metaNoindex = /\bnoindex\b/i.test(metaRobots);
    const headerNoindex = /\bnoindex\b/i.test(headerRobots);

    if (metaNoindex) {
      findings.push(
        makeFinding("noindex-meta", pageUrl, "warning", "Page sets noindex via meta robots.", {
          content: metaRobots,
        }),
      );
    }
    if (headerNoindex) {
      findings.push(
        makeFinding(
          "noindex-header",
          pageUrl,
          "warning",
          "Page sets noindex via the X-Robots-Tag header.",
          { content: headerRobots },
        ),
      );
    }

    if (!doc.title) {
      findings.push(makeFinding("title-missing", pageUrl, "error", "Page has no title."));
    } else {
      if (doc.titleCount > 1) {
        findings.push(
          makeFinding("title-multiple", pageUrl, "warning", "Page has more than one title tag.", {
            count: doc.titleCount,
          }),
        );
      }
      if (doc.title.length > TITLE_MAX) {
        findings.push(
          makeFinding("title-long", pageUrl, "info", "Title is longer than 60 characters.", {
            length: doc.title.length,
          }),
        );
      } else if (doc.title.length < TITLE_MIN) {
        findings.push(
          makeFinding("title-short", pageUrl, "info", "Title is shorter than 15 characters.", {
            length: doc.title.length,
          }),
        );
      }
    }

    if (!doc.metaDescription) {
      findings.push(
        makeFinding("description-missing", pageUrl, "warning", "Page has no meta description."),
      );
    } else if (doc.metaDescription.length > DESCRIPTION_MAX) {
      findings.push(
        makeFinding(
          "description-long",
          pageUrl,
          "info",
          "Meta description is longer than 160 characters.",
          { length: doc.metaDescription.length },
        ),
      );
    }

    if (doc.h1.length === 0) {
      findings.push(makeFinding("h1-missing", pageUrl, "warning", "Page has no h1."));
    } else if (doc.h1.length > 1) {
      findings.push(
        makeFinding("h1-multiple", pageUrl, "warning", "Page has more than one h1.", {
          count: doc.h1.length,
        }),
      );
    }

    if (!doc.lang) {
      findings.push(
        makeFinding("lang-missing", pageUrl, "warning", "The html element has no lang attribute."),
      );
    }

    if (doc.jsonLd.invalid) {
      findings.push(
        makeFinding("json-ld-invalid", pageUrl, "warning", "Page contains invalid JSON-LD.", {
          blocks: doc.jsonLd.count,
        }),
      );
    }

    if (doc.canonicalCount > 1) {
      findings.push(
        makeFinding(
          "canonical-multiple",
          pageUrl,
          "warning",
          "Page declares more than one canonical URL.",
          { count: doc.canonicalCount, canonical: doc.canonical },
        ),
      );
    }

    if (doc.canonical) {
      const canonical = normalizeUrl(doc.canonical);
      const offsite = origin && originOf(canonical) !== origin;
      if (offsite) {
        findings.push(
          makeFinding("canonical-offsite", pageUrl, "warning", "Canonical points to another site.", {
            canonical,
          }),
        );
      } else if (doc.canonicalCount === 1 && !isSameAsPage(canonical, page)) {
        const entry = linkStatus.get(canonical);
        if (entry && (entry.error || entry.status >= 400)) {
          findings.push(
            makeFinding(
              "canonical-broken",
              pageUrl,
              "error",
              "Canonical target failed when fetched.",
              { canonical, status: entry.status ?? null },
            ),
          );
        } else {
          findings.push(
            makeFinding(
              "canonical-other",
              pageUrl,
              "info",
              "Canonical points to a different same-site URL.",
              { canonical },
            ),
          );
        }
      }
    }

    if (
      !page.redirects?.length &&
      !metaNoindex &&
      !headerNoindex &&
      (!doc.canonical || isSameAsPage(doc.canonical, page))
    ) {
      indexable.push(page);
    }

    for (const anchor of doc.anchors) {
      const target = normalizeUrl(anchor.href);
      if (originOf(target) !== origin) continue;
      if (!isAllowed(target)) continue;
      const entry = linkStatus.get(target);
      if (!entry) {
        unverifiedLinks.add(target);
        continue;
      }
      if (entry.error || (entry.status !== null && entry.status >= 400)) {
        const evidence = { target, status: entry.status ?? null };
        if (entry.error) evidence.error = entry.error.code;
        findings.push(
          makeFinding(
            "broken-internal-link",
            pageUrl,
            "error",
            `Internal link failed with ${entry.error ? entry.error.code : `HTTP ${entry.status}`}.`,
            evidence,
            `broken-internal-link:${pageUrl}->${target}`,
          ),
        );
      }
    }
  }

  const titles = new Map();
  const descriptions = new Map();
  for (const page of indexable) {
    const title = normalizeText(page.doc.title);
    if (title) {
      if (!titles.has(title)) titles.set(title, []);
      titles.get(title).push(page.url);
    }
    const description = normalizeText(page.doc.metaDescription);
    if (description) {
      if (!descriptions.has(description)) descriptions.set(description, []);
      descriptions.get(description).push(page.url);
    }
  }

  for (const [title, urls] of titles) {
    if (urls.length < 2) continue;
    for (const url of urls) {
      findings.push(
        makeFinding("duplicate-title", url, "warning", "Title is shared by multiple indexable pages.", {
          title,
          duplicatesWith: urls.filter((other) => other !== url),
        }),
      );
    }
  }

  for (const [description, urls] of descriptions) {
    if (urls.length < 2) continue;
    for (const url of urls) {
      findings.push(
        makeFinding(
          "duplicate-description",
          url,
          "warning",
          "Meta description is shared by multiple indexable pages.",
          { description, duplicatesWith: urls.filter((other) => other !== url) },
        ),
      );
    }
  }

  if (sitemapAvailable) {
    for (const sitemapUrl of context.sitemapUrls) {
      const key = normalizeUrl(sitemapUrl);
      if (!isAllowed(sitemapUrl)) {
        blockedSitemap.add(key);
        findings.push(
          makeFinding("sitemap-blocked", sitemapUrl, "error", "Sitemap URL is disallowed by robots.txt."),
        );
        continue;
      }
      const page = byUrl.get(key);
      if (!page) continue;
      if (page.error || !page.ok) {
        if (key !== startUrl) {
          const evidence = { status: page.status ?? null };
          if (page.error) evidence.error = page.error.code;
          findings.push(
            makeFinding(
              "sitemap-url-error",
              sitemapUrl,
              "error",
              `Sitemap URL failed with ${page.error ? page.error.code : `HTTP ${page.status}`}.`,
              evidence,
            ),
          );
        }
        continue;
      }
      if (hasNoindex(page)) {
        findings.push(
          makeFinding("sitemap-noindex", sitemapUrl, "warning", "Sitemap URL is marked noindex."),
        );
      }
    }

    for (const page of indexable) {
      const key = normalizeUrl(page.url);
      const finalKey = normalizeUrl(page.finalUrl ?? page.url);
      if (sitemapSet.has(key) || sitemapSet.has(finalKey)) continue;
      findings.push(
        makeFinding("not-in-sitemap", page.url, "warning", "Indexable page is not listed in the sitemap."),
      );
    }
  }

  findings.sort(rankFindings);

  const unresolved = sitemapAvailable
    ? [...sitemapSet].filter((url) => !byUrl.has(url) && !blockedSitemap.has(url))
    : [];

  checks.push({
    id: "robots",
    status: context.robotsAvailable === false ? "inconclusive" : "complete",
    detail: context.robotsAvailable === false ? "robots.txt could not be fetched" : "robots.txt resolved",
  });
  checks.push({
    id: "sitemap",
    status: sitemapAvailable ? "complete" : "inconclusive",
    detail: sitemapAvailable ? `${sitemapSet.size} sitemap URLs` : context.sitemapError || "sitemap unavailable",
  });
  checks.push({
    id: "sitemap-coverage",
    status: sitemapAvailable && unresolved.length === 0 ? "complete" : "inconclusive",
    detail:
      sitemapAvailable && unresolved.length === 0
        ? "every sitemap URL was fetched or blocked"
        : sitemapAvailable
          ? `${unresolved.length} sitemap URLs were not crawled`
          : "sitemap unavailable",
  });
  checks.push({
    id: "internal-links",
    status: unverifiedLinks.size === 0 ? "complete" : "inconclusive",
    detail:
      unverifiedLinks.size === 0
        ? "all internal link targets were fetched"
        : `${unverifiedLinks.size} internal link targets were not crawled`,
  });
  checks.push({
    id: "crawl-coverage",
    status: context.crawlTruncated ? "inconclusive" : "complete",
    detail: context.crawlTruncated
      ? context.crawlTruncationReason === "depth"
        ? "crawl stopped at the depth limit"
        : "crawl stopped at the page limit"
      : "crawl reached every queued page",
  });

  return { findings, checks };
}
