import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { startFixtureServer } from "./helpers/server.mjs";

const exec = promisify(execFile);
const CLI = fileURLToPath(new URL("../scripts/seo-crawl.mjs", import.meta.url));

async function runCli(args) {
  try {
    const { stdout, stderr } = await exec(process.execPath, [CLI, ...args], {
      windowsHide: true,
    });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code ?? 1, stdout: error.stdout ?? "", stderr: error.stderr ?? "" };
  }
}

function page({ origin, path: pagePath, title = "A descriptive page title for the audit" }) {
  return `<!doctype html><html lang="en"><head>
    <title>${title}</title>
    <meta name="description" content="A useful description of this page for search results.">
    <link rel="canonical" href="${origin}${pagePath}">
  </head><body><h1>Heading</h1></body></html>`;
}

test("prints usage with --help", async () => {
  const result = await runCli(["--help"]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Usage: seo-crawl --url <start-url>/);
});

test("rejects a missing url and unknown options with exit code 2", async () => {
  const missing = await runCli(["--max-pages", "2"]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /--url is required/);

  const unknown = await runCli(["--url", "https://example.com", "--bogus"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /Unknown option: --bogus/);
});

test("rejects invalid start URLs", async () => {
  const result = await runCli(["--url", "not-a-url"]);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /Invalid URL/);
});

test("crawls a site and emits parseable JSON on stdout", async () => {
  let origin;
  const server = await startFixtureServer((url) => {
    if (url.pathname === "/") return { body: page({ origin, path: "/" }) };
    return undefined;
  });
  origin = server.origin;

  try {
    const result = await runCli(["--url", `${origin}/`, "--delay", "0", "--max-pages", "1"]);
    assert.equal(result.code, 0);

    const report = JSON.parse(result.stdout);
    assert.equal(report.schemaVersion, 1);
    assert.equal(report.startUrl, `${origin}/`);
    assert.equal(report.generator.name, "seo-crawl");
    assert.equal(report.summary.pagesFetched, 1);
    assert.ok(Array.isArray(report.findings));
    assert.ok(Array.isArray(report.checks));
  } finally {
    await server.close();
  }
});

test("writes --out and exits 1 when --fail-on error matches", async () => {
  let origin;
  const server = await startFixtureServer((url) => {
    if (url.pathname === "/") {
      return {
        body: `<html lang="en"><head><meta name="description" content="A useful description of this page for search results."></head><body><h1>No title</h1></body></html>`,
      };
    }
    return undefined;
  });
  origin = server.origin;
  const outPath = path.join(tmpdir(), `seo-crawl-cli-${process.pid}-${Date.now()}.json`);

  try {
    const result = await runCli([
      "--url",
      `${origin}/`,
      "--delay",
      "0",
      "--max-pages",
      "1",
      "--out",
      outPath,
      "--fail-on",
      "error",
    ]);

    assert.equal(result.code, 1);
    const report = JSON.parse(await readFile(outPath, "utf8"));
    assert.equal(report.findings[0].rule, "title-missing");
  } finally {
    await rm(outPath, { force: true });
    await server.close();
  }
});

test("renders markdown with --format markdown", async () => {
  let origin;
  const server = await startFixtureServer((url) => {
    if (url.pathname === "/") return { body: page({ origin, path: "/" }) };
    return undefined;
  });
  origin = server.origin;

  try {
    const result = await runCli([
      "--url",
      `${origin}/`,
      "--delay",
      "0",
      "--max-pages",
      "1",
      "--format",
      "markdown",
    ]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /^# seo-crawl report/);
    assert.match(result.stdout, /INCONCLUSIVE — sitemap/);
  } finally {
    await server.close();
  }
});
