import test from "node:test";
import assert from "node:assert/strict";
import { crawlSite } from "../scripts/lib/crawl.mjs";
import { startFixtureServer } from "./helpers/server.mjs";

function html({ origin, path, title, description, links = [], robots = "" }) {
  const anchors = links.map((href) => `<a href="${href}">${href}</a>`).join("");
  return `<!doctype html><html lang="en"><head>
    <title>${title}</title>
    <meta name="description" content="${description}">
    ${robots}
    <link rel="canonical" href="${origin}${path}">
  </head><body><h1>${title}</h1>${anchors}</body></html>`;
}

function pathsOf(report) {
  return report.pages.map((page) => new URL(page.url).pathname).sort();
}

function check(report, id) {
  return report.checks.find((entry) => entry.id === id);
}

test("crawls start and sitemap URLs, respects robots, and reports clean evidence", async () => {
  let origin;
  const pages = {
    "/": () =>
      html({
        origin,
        path: "/",
        title: "Home page title for the audit",
        description: "The home page description used by the crawler.",
        links: ["/about", "/private"],
      }),
    "/about": () =>
      html({
        origin,
        path: "/about",
        title: "About page title for the audit",
        description: "The about page description used by the crawler.",
        links: ["/"],
      }),
    "/private": () =>
      html({
        origin,
        path: "/private",
        title: "Private page title for the audit",
        description: "The private page description used by the crawler.",
      }),
  };

  const server = await startFixtureServer((url) => {
    if (url.pathname === "/robots.txt") {
      return {
        headers: { "content-type": "text/plain; charset=utf-8" },
        body: `User-agent: *\nDisallow: /private\nSitemap: ${origin}/sitemap.xml`,
      };
    }
    if (url.pathname === "/sitemap.xml") {
      return {
        headers: { "content-type": "application/xml" },
        body: `<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/about</loc></url></urlset>`,
      };
    }
    return pages[url.pathname] ? { body: pages[url.pathname]() } : undefined;
  });
  origin = server.origin;

  try {
    const report = await crawlSite({ url: `${origin}/`, delayMs: 0 });

    assert.deepEqual(pathsOf(report), ["/", "/about"]);
    assert.equal(report.summary.pagesFetched, 2);
    assert.deepEqual(report.findings, []);
    assert.deepEqual(server.requests.filter((request) => request.includes("/private")), []);
    assert.equal(report.robots.available, true);
    assert.deepEqual(report.robots.sitemaps, [`${origin}/sitemap.xml`]);
    assert.equal(report.sitemap.available, true);
    assert.equal(report.sitemap.urlCount, 2);
    assert.equal(check(report, "internal-links").status, "complete");
    assert.equal(check(report, "sitemap-coverage").status, "complete");
    assert.equal(check(report, "crawl-coverage").status, "complete");
    assert.equal(report.inconclusive, false);
  } finally {
    await server.close();
  }
});

test("stops at maxPages and reports truncated coverage", async () => {
  let origin;
  const pages = {
    "/": () =>
      html({
        origin,
        path: "/",
        title: "Home page title for the audit",
        description: "The home page description used by the crawler.",
        links: ["/a", "/b", "/c"],
      }),
  };
  const child = (path) => () =>
    html({
      origin,
      path,
      title: `${path} page title for the audit`,
      description: `The ${path} page description used by the crawler.`,
    });

  const server = await startFixtureServer((url) => {
    if (url.pathname === "/a") return { body: child("/a")() };
    if (url.pathname === "/b") return { body: child("/b")() };
    if (url.pathname === "/c") return { body: child("/c")() };
    if (url.pathname === "/") return { body: pages["/"]() };
    return undefined;
  });
  origin = server.origin;

  try {
    const report = await crawlSite({ url: `${origin}/`, maxPages: 2, delayMs: 0 });

    assert.equal(report.summary.pagesFetched, 2);
    assert.equal(report.truncated, true);
    assert.equal(check(report, "crawl-coverage").status, "inconclusive");
    assert.equal(check(report, "internal-links").status, "inconclusive");
    assert.equal(check(report, "sitemap").status, "inconclusive");
    assert.equal(report.inconclusive, true);
  } finally {
    await server.close();
  }
});

test("reports depth-limited coverage when links are left unexplored", async () => {
  let origin;
  const server = await startFixtureServer((url) => {
    if (url.pathname === "/") {
      return {
        body: html({
          origin,
          path: "/",
          title: "Home page title for the audit",
          description: "The home page description used by the crawler.",
          links: ["/a"],
        }),
      };
    }
    if (url.pathname === "/a") {
      return {
        body: html({
          origin,
          path: "/a",
          title: "About page title for the audit",
          description: "The about page description used by the crawler.",
        }),
      };
    }
    return undefined;
  });
  origin = server.origin;

  try {
    const report = await crawlSite({ url: `${origin}/`, maxDepth: 0, delayMs: 0 });

    assert.deepEqual(pathsOf(report), ["/"]);
    assert.equal(report.truncated, true);
    assert.match(check(report, "crawl-coverage").detail, /depth/i);
    assert.equal(report.inconclusive, true);
  } finally {
    await server.close();
  }
});

test("reports broken internal links at the linking page", async () => {
  let origin;
  const server = await startFixtureServer((url) => {
    if (url.pathname === "/") {
      return {
        body: html({
          origin,
          path: "/",
          title: "Home page title for the audit",
          description: "The home page description used by the crawler.",
          links: ["/missing"],
        }),
      };
    }
    return undefined;
  });
  origin = server.origin;

  try {
    const report = await crawlSite({ url: `${origin}/`, delayMs: 0 });

    const broken = report.findings.filter((finding) => finding.rule === "broken-internal-link");
    assert.equal(broken.length, 1);
    assert.equal(broken[0].url, `${origin}/`);
    assert.equal(broken[0].evidence.target, `${origin}/missing`);
    assert.equal(broken[0].evidence.status, 404);
    assert.equal(report.findings.some((finding) => finding.rule === "http-error"), false);
    assert.equal(check(report, "internal-links").status, "complete");
  } finally {
    await server.close();
  }
});

test("continues after a robots.txt server error but marks robots inconclusive", async () => {
  let origin;
  const server = await startFixtureServer((url) => {
    if (url.pathname === "/robots.txt") {
      return { status: 500, headers: { "content-type": "text/plain" }, body: "boom" };
    }
    if (url.pathname === "/") {
      return {
        body: html({
          origin,
          path: "/",
          title: "Home page title for the audit",
          description: "The home page description used by the crawler.",
        }),
      };
    }
    return undefined;
  });
  origin = server.origin;

  try {
    const report = await crawlSite({ url: `${origin}/`, delayMs: 0 });

    assert.equal(report.robots.available, false);
    assert.equal(check(report, "robots").status, "inconclusive");
    assert.deepEqual(pathsOf(report), ["/"]);
    assert.equal(report.inconclusive, true);
  } finally {
    await server.close();
  }
});

test("follows a sitemapindex and crawls URLs it discovers", async () => {
  let origin;
  const server = await startFixtureServer((url) => {
    if (url.pathname === "/robots.txt") {
      return {
        headers: { "content-type": "text/plain" },
        body: `User-agent: *\nSitemap: ${origin}/sitemap-index.xml`,
      };
    }
    if (url.pathname === "/sitemap-index.xml") {
      return {
        headers: { "content-type": "application/xml" },
        body: `<sitemapindex>
          <sitemap><loc>${origin}/sitemap-a.xml</loc></sitemap>
          <sitemap><loc>${origin}/sitemap-b.xml</loc></sitemap>
        </sitemapindex>`,
      };
    }
    if (url.pathname === "/sitemap-a.xml") {
      return {
        headers: { "content-type": "application/xml" },
        body: `<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/from-a</loc></url></urlset>`,
      };
    }
    if (url.pathname === "/sitemap-b.xml") {
      return {
        headers: { "content-type": "application/xml" },
        body: `<urlset><url><loc>${origin}/from-b</loc></url></urlset>`,
      };
    }
    if (url.pathname === "/") {
      return {
        body: html({
          origin,
          path: "/",
          title: "Home page title for the audit",
          description: "The home page description used by the crawler.",
        }),
      };
    }
    const name = url.pathname.slice(1);
    if (name === "from-a" || name === "from-b") {
      return {
        body: html({
          origin,
          path: url.pathname,
          title: `${name} page title for the audit`,
          description: `The ${name} page description used by the crawler.`,
        }),
      };
    }
    return undefined;
  });
  origin = server.origin;

  try {
    const report = await crawlSite({ url: `${origin}/`, delayMs: 0 });

    assert.deepEqual(pathsOf(report), ["/", "/from-a", "/from-b"]);
    assert.equal(report.sitemap.available, true);
    assert.equal(report.sitemap.sources.length, 3);
    assert.equal(report.sitemap.urlCount, 3);
    assert.deepEqual(report.findings, []);
  } finally {
    await server.close();
  }
});
