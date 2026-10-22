import http from "node:http";

export async function startFixtureServer(handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://fixture.local");
    requests.push(url.pathname + url.search);

    const result = handler(url);
    if (!result) {
      res.writeHead(404, { "content-type": "text/html; charset=utf-8" });
      res.end("<!doctype html><html><body><h1>Not found</h1></body></html>");
      return;
    }
    if (result.redirect) {
      res.writeHead(result.status ?? 301, { location: result.redirect });
      res.end();
      return;
    }
    const headers = { "content-type": "text/html; charset=utf-8", ...(result.headers ?? {}) };
    res.writeHead(result.status ?? 200, headers);
    res.end(result.body ?? "");
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;

  return {
    origin,
    requests,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(resolve);
      }),
  };
}
