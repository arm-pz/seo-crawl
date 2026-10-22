import { evaluate } from "./checks.mjs";
import { fetchResource } from "./fetch.mjs";
import { extractDocument } from "./parse.mjs";
import { isAllowed as isUrlAllowed, parseRobots } from "./robots.mjs";
import { parseSitemap } from "./sitemap.mjs";

export const VERSION = "0.1.0";
export const USER_AGENT = `seo-crawl/${VERSION} (+https://github.com/arm-pz/seo-crawl)`;

const ASSET_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|avif|svg|ico|pdf|zip|gz|tgz|css|js|mjs|json|xml|txt|woff2?|ttf|otf|mp4|webm|mov|mp3|wav|ogg)$/i;

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

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isHtml(contentType) {
  return /html/i.test(String(contentType ?? ""));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function crawlSite(options = {}) {
  if (!options.url) throw new Error("url is required");
  let parsedStart;
  try {
    parsedStart = new URL(options.url);
  } catch {
    throw new Error(`Invalid URL: ${options.url}`);
  }
  if (parsedStart.protocol !== "http:" && parsedStart.protocol !== "https:") {
    throw new Error("Only http and https URLs are supported");
  }
  parsedStart.hash = "";
  const startUrl = normalizeUrl(parsedStart.href);
  const origin = parsedStart.origin;

  const maxPages = options.maxPages ?? 25;
  const maxDepth = options.maxDepth ?? 3;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const maxBytes = options.maxBytes ?? 2_000_000;
  const maxSitemaps = options.maxSitemaps ?? 5;
  const userAgent = options.userAgent ?? USER_AGENT;
  let delayMs = options.delayMs ?? 250;

  const fetchOptions = { userAgent, timeoutMs, maxBytes, fetchImpl: options.fetchImpl };
  let requestsMade = 0;
  const throttle = async () => {
    if (requestsMade > 0 && delayMs > 0) await sleep(delayMs);
    requestsMade += 1;
  };

  await throttle();
  const robotsResponse = await fetchResource(new URL("/robots.txt", origin).href, fetchOptions);
  let robots = null;
  let robotsAvailable = true;
  let robotsFound = false;

  if (robotsResponse.error || robotsResponse.status >= 500) {
    robotsAvailable = false;
  } else if (robotsResponse.ok && typeof robotsResponse.body === "string") {
    robots = parseRobots(robotsResponse.body);
    robotsFound = true;
  }

  const allows = (url) => isUrlAllowed(robots, url, userAgent);

  if (options.delayMs === undefined && robots?.crawlDelay) {
    delayMs = Math.round(robots.crawlDelay * 1000);
  }

  const sitemapSources = [];
  const sitemapUrls = new Set();
  const seenSitemaps = new Set();
  let sitemapError = null;
  let sitemapAvailable = false;
  let urlsetSeen = false;

  const sitemapCandidates = (robots?.sitemaps ?? []).filter(
    (url) => isHttpUrl(url) && originOf(url) === origin,
  );
  if (sitemapCandidates.length === 0) {
    sitemapCandidates.push(new URL("/sitemap.xml", origin).href);
  }

  const loadSitemap = async (url) => {
    const key = normalizeUrl(url);
    if (seenSitemaps.has(key)) return;
    if (seenSitemaps.size >= maxSitemaps) {
      sitemapError ??= `sitemap limit of ${maxSitemaps} reached`;
      return;
    }
    if (!allows(key)) return;
    seenSitemaps.add(key);

    await throttle();
    const response = await fetchResource(key, fetchOptions);
    const source = { url: key, status: response.status, type: null, count: 0 };
    sitemapSources.push(source);

    if (response.error || !response.ok || typeof response.body !== "string") {
      sitemapError ??= `${key} ${response.error ? response.error.code : `HTTP ${response.status}`}`;
      return;
    }

    const sitemap = parseSitemap(response.body);
    source.type = sitemap.type;
    if (sitemap.invalid) {
      sitemapError ??= `${key} is not a valid sitemap`;
      return;
    }

    if (sitemap.type === "urlset") {
      urlsetSeen = true;
      let accepted = 0;
      for (const loc of sitemap.urls) {
        if (!isHttpUrl(loc) || originOf(loc) !== origin) continue;
        sitemapUrls.add(normalizeUrl(loc));
        accepted += 1;
      }
      source.count = accepted;
      return;
    }

    for (const child of sitemap.sitemaps) {
      if (!isHttpUrl(child) || originOf(child) !== origin) continue;
      await loadSitemap(child);
    }
  };

  for (const candidate of sitemapCandidates) {
    await loadSitemap(candidate);
  }
  sitemapAvailable = urlsetSeen;
  if (!sitemapAvailable) sitemapError ??= "no readable sitemap found";
  const sitemapList = [...sitemapUrls].sort();

  const startBlocked = !allows(startUrl);
  const pages = [];
  const linkStatus = new Map();
  let truncated = false;
  let truncationReason = null;

  if (!startBlocked) {
    const queue = [{ url: startUrl, depth: 0 }];
    const seen = new Set([startUrl]);
    for (const url of sitemapList) {
      if (seen.has(url)) continue;
      seen.add(url);
      queue.push({ url, depth: 0 });
    }

    while (queue.length > 0) {
      if (pages.length >= maxPages) {
        truncated = true;
        truncationReason = "pages";
        break;
      }

      const { url, depth } = queue.shift();
      if (!allows(url)) continue;

      await throttle();
      const response = await fetchResource(url, fetchOptions);
      const entry = { status: response.status, error: response.error ?? null };
      linkStatus.set(normalizeUrl(url), entry);
      if (response.finalUrl && normalizeUrl(response.finalUrl) !== normalizeUrl(url)) {
        linkStatus.set(normalizeUrl(response.finalUrl), entry);
      }

      const doc =
        response.ok && isHtml(response.contentType) && typeof response.body === "string"
          ? extractDocument(response.body, response.finalUrl)
          : null;
      pages.push({ ...response, doc });

      if (!doc) continue;

      const discovered = [];
      for (const anchor of doc.anchors) {
        const target = normalizeUrl(anchor.href);
        if (originOf(target) !== origin) continue;
        if (seen.has(target)) continue;
        if (ASSET_EXTENSION.test(new URL(target).pathname)) continue;
        if (!allows(target)) continue;
        discovered.push(target);
      }

      if (depth < maxDepth) {
        for (const target of discovered) {
          seen.add(target);
          queue.push({ url: target, depth: depth + 1 });
        }
      } else if (discovered.length > 0) {
        truncated = true;
        truncationReason = "depth";
      }
    }
  }

  const { findings, checks } = evaluate(pages, {
    startUrl,
    origin,
    linkStatus,
    robotsAvailable,
    isAllowed: allows,
    sitemapAvailable,
    sitemapUrls: sitemapList,
    sitemapError,
    crawlTruncated: truncated,
    crawlTruncationReason: truncationReason,
    startBlocked,
  });

  const severityCounts = { error: 0, warning: 0, info: 0 };
  for (const finding of findings) severityCounts[finding.severity] += 1;

  const reportPages = [...pages]
    .sort((a, b) => a.url.localeCompare(b.url))
    .map((page) => ({
      url: page.url,
      finalUrl: page.finalUrl,
      status: page.status,
      ok: page.ok,
      contentType: page.contentType,
      bytes: page.bytes,
      truncated: page.truncated,
      redirects: page.redirects,
      error: page.error,
      title: page.doc?.title ?? null,
      metaDescription: page.doc?.metaDescription ?? null,
      canonical: page.doc?.canonical ?? null,
      h1Count: page.doc ? page.doc.h1.length : null,
      lang: page.doc?.lang ?? null,
      jsonLd: page.doc
        ? { types: page.doc.jsonLd.types, invalid: page.doc.jsonLd.invalid }
        : null,
    }));

  return {
    schemaVersion: 1,
    generator: { name: "seo-crawl", version: VERSION },
    generatedAt: (options.now ?? (() => new Date().toISOString()))(),
    startUrl,
    origin,
    limits: { maxPages, maxDepth, timeoutMs, maxBytes, delayMs },
    robots: {
      available: robotsAvailable,
      found: robotsFound,
      sitemaps: robots?.sitemaps ?? [],
      crawlDelay: robots?.crawlDelay ?? null,
    },
    sitemap: {
      available: sitemapAvailable,
      urlCount: sitemapList.length,
      sources: sitemapSources,
      error: sitemapError,
    },
    pages: reportPages,
    findings,
    checks,
    summary: {
      pagesFetched: pages.length,
      findings: severityCounts,
      checks: {
        complete: checks.filter((check) => check.status === "complete").length,
        inconclusive: checks.filter((check) => check.status === "inconclusive").length,
      },
    },
    truncated,
    inconclusive: checks.some((check) => check.status === "inconclusive"),
  };
}
