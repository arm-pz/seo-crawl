import test from "node:test";
import assert from "node:assert/strict";
import { fetchResource } from "../scripts/lib/fetch.mjs";

const BASE = {
  userAgent: "seo-crawl/0.1 (+https://github.com/arm-pz/seo-crawl)",
  timeoutMs: 5_000,
  maxBytes: 1_024,
  maxRedirects: 3,
};

function html(body = "<html></html>", contentType = "text/html; charset=utf-8") {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

test("follows redirects manually and records the chain", async () => {
  const calls = [];
  const routes = {
    "https://example.com/a": new Response(null, {
      status: 301,
      headers: { location: "/b" },
    }),
    "https://example.com/b": new Response(null, {
      status: 302,
      headers: { location: "https://example.com/c" },
    }),
    "https://example.com/c": html("<title>Final</title>"),
  };
  const fetchImpl = async (url, init) => {
    calls.push({ url, init });
    return routes[url];
  };

  const result = await fetchResource("https://example.com/a", { ...BASE, fetchImpl });

  assert.equal(result.status, 200);
  assert.equal(result.finalUrl, "https://example.com/c");
  assert.equal(result.ok, true);
  assert.equal(result.body, "<title>Final</title>");
  assert.deepEqual(result.redirects, [
    { from: "https://example.com/a", to: "https://example.com/b", status: 301 },
    { from: "https://example.com/b", to: "https://example.com/c", status: 302 },
  ]);
  assert.equal(calls.length, 3);
  assert.equal(calls[0].init.redirect, "manual");
  assert.equal(calls[0].init.headers["user-agent"], BASE.userAgent);
});

test("stops after maxRedirects with a redirect error", async () => {
  let hits = 0;
  const fetchImpl = async (url) => {
    hits += 1;
    return new Response(null, { status: 302, headers: { location: `/hop-${hits + 1}` } });
  };

  const result = await fetchResource("https://example.com/hop-1", {
    ...BASE,
    maxRedirects: 2,
    fetchImpl,
  });

  assert.equal(hits, 3);
  assert.equal(result.error.code, "redirects");
  assert.equal(result.status, 302);
  assert.equal(result.redirects.length, 2);
});

test("treats a redirect without location as final", async () => {
  const fetchImpl = async () => new Response(null, { status: 304 });
  const result = await fetchResource("https://example.com/a", { ...BASE, fetchImpl });
  assert.equal(result.status, 304);
  assert.equal(result.error, null);
  assert.deepEqual(result.redirects, []);
});

test("truncates bodies beyond maxBytes and releases the stream", async () => {
  let cancelled = false;
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(4).fill(65));
      controller.enqueue(new Uint8Array(4).fill(66));
      controller.enqueue(new Uint8Array(4).fill(67));
      controller.close();
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetchImpl = async () =>
    new Response(stream, { headers: { "content-type": "text/html" } });

  const result = await fetchResource("https://example.com/big", {
    ...BASE,
    maxBytes: 6,
    fetchImpl,
  });

  assert.equal(result.truncated, true);
  assert.equal(result.bytes, 6);
  assert.equal(result.body, "AAAABB");
  assert.equal(cancelled, true);
});

test("does not flag a body that fits exactly as truncated", async () => {
  const fetchImpl = async () => html("123456");
  const result = await fetchResource("https://example.com/small", {
    ...BASE,
    maxBytes: 6,
    fetchImpl,
  });
  assert.equal(result.truncated, false);
  assert.equal(result.body, "123456");
});

test("decodes the charset declared in content-type", async () => {
  const fetchImpl = async () =>
    new Response(Uint8Array.from([0x63, 0x61, 0x66, 0xe9]), {
      headers: { "content-type": "text/html; charset=iso-8859-1" },
    });
  const result = await fetchResource("https://example.com/latin", { ...BASE, fetchImpl });
  assert.equal(result.body, "café");
  assert.equal(result.charset, "iso-8859-1");
});

test("classifies timeouts and network failures without throwing", async () => {
  const timeoutImpl = async () => {
    throw Object.assign(new Error("The operation was aborted"), { name: "TimeoutError" });
  };
  const networkImpl = async () => {
    throw new TypeError("fetch failed");
  };

  const timedOut = await fetchResource("https://example.com/slow", {
    ...BASE,
    fetchImpl: timeoutImpl,
  });
  assert.equal(timedOut.error.code, "timeout");
  assert.equal(timedOut.status, null);

  const failed = await fetchResource("https://example.com/gone", {
    ...BASE,
    fetchImpl: networkImpl,
  });
  assert.equal(failed.error.code, "network");
  assert.equal(failed.status, null);
});

test("refuses redirects to non-http protocols", async () => {
  const fetchImpl = async () =>
    new Response(null, { status: 302, headers: { location: "file:///etc/passwd" } });
  const result = await fetchResource("https://example.com/a", { ...BASE, fetchImpl });
  assert.equal(result.error.code, "protocol");
});

test("captures status, headers and content type", async () => {
  const fetchImpl = async () =>
    new Response("nope", {
      status: 404,
      headers: { "content-type": "text/html", "x-robots-tag": "noindex" },
    });
  const result = await fetchResource("https://example.com/missing", { ...BASE, fetchImpl });
  assert.equal(result.status, 404);
  assert.equal(result.ok, false);
  assert.equal(result.contentType, "text/html");
  assert.equal(result.headers["x-robots-tag"], "noindex");
  assert.equal(result.body, "nope");
  assert.equal(result.error, null);
});
