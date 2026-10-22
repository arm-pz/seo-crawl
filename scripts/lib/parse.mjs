const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: "\u00a0",
  copy: "\u00a9",
  reg: "\u00ae",
  trade: "\u2122",
  hellip: "\u2026",
  ndash: "\u2013",
  mdash: "\u2014",
  lsquo: "\u2018",
  rsquo: "\u2019",
  ldquo: "\u201c",
  rdquo: "\u201d",
};

export function decodeEntities(input) {
  if (input == null) return input;
  return String(input).replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (match, body) => {
    if (body[0] === "#") {
      const hex = body[1] === "x" || body[1] === "X";
      const code = Number.parseInt(body.slice(hex ? 2 : 1), hex ? 16 : 10);
      if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return match;
      return String.fromCodePoint(code);
    }
    return Object.hasOwn(NAMED_ENTITIES, body) ? NAMED_ENTITIES[body] : match;
  });
}

function stripTags(html) {
  return html.replace(/<[^>]*>/g, "");
}

function cleanText(html) {
  return decodeEntities(stripTags(html)).replace(/\s+/g, " ").trim();
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source)) !== null) {
    const name = match[1].toLowerCase();
    if (Object.hasOwn(attributes, name)) continue;
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    attributes[name] = decodeEntities(value);
  }
  return attributes;
}

function stripNonContent(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, "");
}

function resolve(href, base) {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

function findBase(html, pageUrl) {
  const match = html.match(/<base\b([^>]*)>/i);
  if (!match) return pageUrl;
  const href = parseAttributes(match[1]).href;
  return (href && resolve(href, pageUrl)) || pageUrl;
}

function collectJsonLd(html) {
  const result = { count: 0, types: [], invalid: false };
  const types = new Set();
  const pattern = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const attributes = parseAttributes(match[1]);
    if ((attributes.type || "").toLowerCase() !== "application/ld+json") continue;
    result.count += 1;
    try {
      addTypes(JSON.parse(match[2]), types);
    } catch {
      result.invalid = true;
    }
  }
  result.types = [...types].sort();
  return result;
}

function addTypes(node, types) {
  if (Array.isArray(node)) {
    for (const item of node) addTypes(item, types);
    return;
  }
  if (!node || typeof node !== "object") return;
  const declared = node["@type"];
  if (typeof declared === "string") types.add(declared);
  else if (Array.isArray(declared)) {
    for (const type of declared) if (typeof type === "string") types.add(type);
  }
  if (Array.isArray(node["@graph"])) addTypes(node["@graph"], types);
}

export function extractDocument(html, pageUrl) {
  const source = String(html ?? "");
  const cleaned = stripNonContent(source);
  const resolveBase = findBase(cleaned, pageUrl);

  const titles = [...cleaned.matchAll(/<title\b[^>]*>([\s\S]*?)<\/title\s*>/gi)];
  const title = titles.length ? cleanText(titles.at(-1)[1]) : null;

  let metaDescription = null;
  let metaRobots = null;
  for (const match of cleaned.matchAll(/<meta\b([^>]*)\/?>/gi)) {
    const attributes = parseAttributes(match[1]);
    const name = (attributes.name || "").toLowerCase();
    if (name === "description" && metaDescription === null) {
      metaDescription = decodeEntities(attributes.content ?? "").trim();
    } else if (name === "robots" && metaRobots === null) {
      metaRobots = decodeEntities(attributes.content ?? "").trim();
    }
  }

  const canonicals = [];
  for (const match of cleaned.matchAll(/<link\b([^>]*)\/?>/gi)) {
    const attributes = parseAttributes(match[1]);
    const rel = (attributes.rel || "").toLowerCase().split(/\s+/);
    if (!rel.includes("canonical") || !attributes.href) continue;
    const href = resolve(attributes.href, resolveBase);
    if (href) canonicals.push(href);
  }

  const h1 = [...cleaned.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1\s*>/gi)].map((match) =>
    cleanText(match[1]),
  );

  const htmlTag = cleaned.match(/<html\b([^>]*)>/i);
  const lang = htmlTag ? parseAttributes(htmlTag[1]).lang || null : null;

  const anchors = [];
  const seen = new Set();
  const page = resolve(pageUrl, pageUrl);
  for (const match of cleaned.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attributes = parseAttributes(match[1]);
    const rawHref = (attributes.href || "").trim();
    if (!rawHref || rawHref.startsWith("#")) continue;
    const href = resolve(rawHref, resolveBase);
    if (!href || seen.has(href)) continue;
    let protocol;
    try {
      protocol = new URL(href).protocol;
    } catch {
      continue;
    }
    if (protocol !== "http:" && protocol !== "https:") continue;
    seen.add(href);
    anchors.push({ href, text: cleanText(match[2]) });
  }

  return {
    url: page,
    title,
    titleCount: titles.length,
    metaDescription,
    metaRobots,
    canonical: canonicals[0] ?? null,
    canonicalCount: canonicals.length,
    h1,
    lang,
    anchors,
    jsonLd: collectJsonLd(source),
  };
}
