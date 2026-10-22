function normalizePath(value) {
  if (!value) return "";
  return value.startsWith("/") || value.startsWith("*") ? value : `/${value}`;
}

export function parseRobots(text) {
  const groups = [];
  const sitemaps = [];
  let current = null;

  for (const rawLine of String(text ?? "").replace(/^\uFEFF/, "").split(/\r?\n/)) {
    const line = rawLine.split("#")[0].trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim().toLowerCase();
    const value = line.slice(colon + 1).trim();

    if (key === "user-agent") {
      if (!current || current.rules.length > 0 || current.crawlDelay !== null) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      if (value) current.agents.push(value.toLowerCase());
      continue;
    }

    if (key === "sitemap") {
      if (value) sitemaps.push(value);
      continue;
    }

    if (!current) {
      current = { agents: ["*"], rules: [], crawlDelay: null };
      groups.push(current);
    }

    if (key === "allow" || key === "disallow") {
      const path = normalizePath(value);
      if (path) current.rules.push({ type: key, path });
    } else if (key === "crawl-delay") {
      const delay = Number.parseFloat(value);
      if (Number.isFinite(delay) && delay >= 0) current.crawlDelay = delay;
    }
  }

  const crawlDelay = groups.find((group) => group.crawlDelay !== null)?.crawlDelay ?? null;
  return { groups, sitemaps, crawlDelay };
}

function matchingGroups(robots, userAgent) {
  const ua = String(userAgent ?? "").toLowerCase();
  let best = -1;
  let matched = [];
  for (const group of robots.groups) {
    let score = -1;
    for (const agent of group.agents) {
      if (agent === "*") score = Math.max(score, 0);
      else if (ua.includes(agent)) score = Math.max(score, agent.length);
    }
    if (score < 0) continue;
    if (score > best) {
      best = score;
      matched = [group];
    } else if (score === best) {
      matched.push(group);
    }
  }
  return matched;
}

export function selectRules(robots, userAgent) {
  if (!robots) return [];
  return matchingGroups(robots, userAgent).flatMap((group) => group.rules);
}

function ruleLength(rule) {
  return rule.path.replace(/\$$/, "").length;
}

function ruleMatches(rule, path) {
  const anchored = rule.path.endsWith("$");
  const body = anchored ? rule.path.slice(0, -1) : rule.path;
  const source = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${source}${anchored ? "$" : ""}`).test(path);
}

function toPath(target) {
  const value = String(target ?? "");
  if (/^https?:\/\//i.test(value)) {
    try {
      const url = new URL(value);
      return `${url.pathname}${url.search}`;
    } catch {
      return "/";
    }
  }
  return value.startsWith("/") ? value : `/${value}`;
}

export function isAllowed(robots, target, userAgent) {
  if (!robots) return true;
  const path = toPath(target);
  let best = -1;
  let allowed = true;
  for (const rule of selectRules(robots, userAgent)) {
    if (!ruleMatches(rule, path)) continue;
    const length = ruleLength(rule);
    if (length > best) {
      best = length;
      allowed = rule.type === "allow";
    } else if (length === best && rule.type === "allow") {
      allowed = true;
    }
  }
  return allowed;
}
