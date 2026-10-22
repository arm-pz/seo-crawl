import { decodeEntities } from "./parse.mjs";

function extractLoc(block) {
  const match = /<loc\b[^>]*>([\s\S]*?)<\/loc\s*>/i.exec(block);
  if (!match) return null;
  let value = match[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(value);
  if (cdata) value = cdata[1].trim();
  return decodeEntities(value) || null;
}

function extractBlocks(xml, tag) {
  const blocks = [];
  const pattern = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}\\s*>`, "gi");
  let match;
  while ((match = pattern.exec(xml)) !== null) blocks.push(match[1]);
  return blocks;
}

export function parseSitemap(xml) {
  const source = String(xml ?? "");
  if (/<urlset\b/i.test(source)) {
    const urls = extractBlocks(source, "url")
      .map(extractLoc)
      .filter((url) => url !== null);
    return { type: "urlset", urls, sitemaps: [], invalid: false };
  }
  if (/<sitemapindex\b/i.test(source)) {
    const sitemaps = extractBlocks(source, "sitemap")
      .map(extractLoc)
      .filter((url) => url !== null);
    return { type: "sitemapindex", urls: [], sitemaps, invalid: false };
  }
  return { type: null, urls: [], sitemaps: [], invalid: true };
}
