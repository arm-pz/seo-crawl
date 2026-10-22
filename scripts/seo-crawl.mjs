#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import { crawlSite, VERSION } from "./lib/crawl.mjs";
import { renderMarkdown } from "./lib/report.mjs";

const USAGE = `seo-crawl ${VERSION} — deterministic, read-only technical SEO crawler

Usage: seo-crawl --url <start-url> [options]

Options:
  --url <url>              Start URL (required, http or https)
  --out <file>             Write the report to a file instead of stdout
  --format <json|markdown> Output format (default: json)
  --max-pages <n>          Page limit (default: 25)
  --max-depth <n>          Link depth from seeds (default: 3)
  --timeout <ms>           Per-request timeout (default: 10000)
  --delay <ms>             Delay between requests (default: 250)
  --fail-on <none|error|warning>
                           Exit 1 when findings at that severity exist (default: none)
  --help                   Show this help
  --version                Show the version
`;

function fail(message) {
  process.stderr.write(`seo-crawl: ${message}\n\n${USAGE}`);
  process.exit(2);
}

function integer(value, name, minimum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum) {
    fail(`${name} must be an integer >= ${minimum}`);
  }
  return number;
}

function parseArgs(argv) {
  const options = {
    format: "json",
    failOn: "none",
    maxPages: 25,
    maxDepth: 3,
    timeoutMs: 10_000,
    delayMs: 250,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (value === undefined) fail(`${flag} requires a value`);
      index += 1;
      return value;
    };

    switch (flag) {
      case "--url":
        options.url = take();
        break;
      case "--out":
        options.out = take();
        break;
      case "--format":
        options.format = take();
        break;
      case "--fail-on":
        options.failOn = take();
        break;
      case "--max-pages":
        options.maxPages = integer(take(), "--max-pages", 1);
        break;
      case "--max-depth":
        options.maxDepth = integer(take(), "--max-depth", 0);
        break;
      case "--timeout":
        options.timeoutMs = integer(take(), "--timeout", 1);
        break;
      case "--delay":
        options.delayMs = integer(take(), "--delay", 0);
        break;
      case "--help":
        process.stdout.write(USAGE);
        process.exit(0);
        break;
      case "--version":
        process.stdout.write(`seo-crawl ${VERSION}\n`);
        process.exit(0);
        break;
      default:
        fail(`Unknown option: ${flag}`);
    }
  }

  if (!options.url) fail("--url is required");
  if (!["json", "markdown"].includes(options.format)) {
    fail(`--format must be json or markdown`);
  }
  if (!["none", "error", "warning"].includes(options.failOn)) {
    fail(`--fail-on must be none, error or warning`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));

let report;
try {
  report = await crawlSite({
    url: options.url,
    maxPages: options.maxPages,
    maxDepth: options.maxDepth,
    timeoutMs: options.timeoutMs,
    delayMs: options.delayMs,
  });
} catch (error) {
  fail(error.message);
}

const output =
  options.format === "markdown"
    ? renderMarkdown(report)
    : `${JSON.stringify(report, null, 2)}\n`;

if (options.out) {
  try {
    await writeFile(options.out, output, "utf8");
    process.stderr.write(`Wrote ${options.out}\n`);
  } catch (error) {
    process.stderr.write(`seo-crawl: could not write ${options.out}: ${error.message}\n`);
    process.exit(1);
  }
} else {
  process.stdout.write(output);
}

const counts = report.summary.findings;
const failed =
  options.failOn === "error"
    ? counts.error > 0
    : options.failOn === "warning" && counts.error + counts.warning > 0;

process.exitCode = failed ? 1 : 0;
