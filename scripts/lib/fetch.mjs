const ACCEPT = "text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.1";

function emptyResult(url) {
  return {
    url,
    finalUrl: url,
    status: null,
    ok: false,
    contentType: null,
    charset: null,
    headers: {},
    body: null,
    bytes: 0,
    truncated: false,
    redirects: [],
    error: null,
  };
}

function parseCharset(contentType) {
  if (!contentType) return null;
  const match = /charset\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
  return match ? match[1].toLowerCase() : null;
}

async function readBody(response, maxBytes) {
  if (!response.body) return { text: null, bytes: 0, truncated: false };
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  let truncated = false;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.byteLength > maxBytes) {
      const room = maxBytes - total;
      if (room > 0) chunks.push(value.subarray(0, room));
      total += room;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
    chunks.push(value);
    total += value.byteLength;
    if (total === maxBytes) {
      const next = await reader.read();
      if (next.done) break;
      truncated = true;
      await reader.cancel().catch(() => {});
      break;
    }
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { buffer, bytes: total, truncated };
}

function decode(buffer, contentType) {
  const charset = parseCharset(contentType);
  try {
    return new TextDecoder(charset || "utf-8").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}

export async function fetchResource(url, options = {}) {
  const {
    userAgent,
    timeoutMs = 10_000,
    maxBytes = 2_000_000,
    maxRedirects = 5,
    fetchImpl = globalThis.fetch,
  } = options;

  const result = emptyResult(url);
  let current = url;

  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    let response;
    try {
      response = await fetchImpl(current, {
        method: "GET",
        redirect: "manual",
        headers: { "user-agent": userAgent, accept: ACCEPT },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const aborted = error?.name === "TimeoutError" || error?.name === "AbortError";
      result.error = {
        code: aborted ? "timeout" : "network",
        message: aborted ? `request exceeded ${timeoutMs} ms` : String(error?.message ?? error),
      };
      result.finalUrl = current;
      return result;
    }

    const status = response.status;
    const location = response.headers.get("location");
    if (status >= 300 && status < 400 && location) {
      if (hop === maxRedirects) {
        result.status = status;
        result.finalUrl = current;
        result.headers = Object.fromEntries(response.headers);
        result.contentType = response.headers.get("content-type");
        result.error = { code: "redirects", message: `more than ${maxRedirects} redirects` };
        await response.body?.cancel().catch(() => {});
        return result;
      }
      let next;
      try {
        next = new URL(location, current);
      } catch {
        result.status = status;
        result.finalUrl = current;
        result.error = { code: "redirect", message: `invalid location: ${location}` };
        await response.body?.cancel().catch(() => {});
        return result;
      }
      if (next.protocol !== "http:" && next.protocol !== "https:") {
        result.status = status;
        result.finalUrl = current;
        result.error = { code: "protocol", message: `refusing to follow ${next.protocol} redirect` };
        await response.body?.cancel().catch(() => {});
        return result;
      }
      result.redirects.push({ from: current, to: next.href, status });
      current = next.href;
      await response.body?.cancel().catch(() => {});
      continue;
    }

    result.finalUrl = current;
    result.status = status;
    result.ok = status >= 200 && status < 300;
    result.contentType = response.headers.get("content-type");
    result.charset = parseCharset(result.contentType);
    result.headers = Object.fromEntries(response.headers);

    try {
      const { buffer, bytes, truncated } = await readBody(response, maxBytes);
      result.bytes = bytes;
      result.truncated = truncated;
      result.body = buffer ? decode(buffer, result.contentType) : null;
    } catch (error) {
      result.error = { code: "network", message: String(error?.message ?? error) };
    }
    return result;
  }

  return result;
}
