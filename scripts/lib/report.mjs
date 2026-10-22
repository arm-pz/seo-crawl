export function renderMarkdown(report) {
  const lines = [];
  const counts = report.summary.findings;

  lines.push("# seo-crawl report", "");
  lines.push(`- Start URL: ${report.startUrl}`);
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Crawled: ${report.summary.pagesFetched} page(s)`);
  lines.push(
    `- Findings: ${counts.error} error(s), ${counts.warning} warning(s), ${counts.info} info`,
  );
  lines.push("");

  lines.push("## Checks", "");
  for (const check of report.checks) {
    const label = check.status === "complete" ? "COMPLETE" : "INCONCLUSIVE";
    lines.push(`- ${label} — ${check.id}: ${check.detail}`);
  }
  lines.push("");

  if (report.findings.length === 0) {
    lines.push("No findings.", "");
  } else {
    lines.push("## Findings", "");
    for (const finding of report.findings) {
      lines.push(`### [${finding.severity.toUpperCase()}] ${finding.rule}`, "");
      lines.push(`- URL: ${finding.url}`);
      lines.push(`- ID: ${finding.id}`);
      lines.push(`- ${finding.message}`);
      if (Object.keys(finding.evidence ?? {}).length > 0) {
        lines.push(`- Evidence: \`${JSON.stringify(finding.evidence)}\``);
      }
      lines.push("");
    }
  }

  if (report.inconclusive) {
    lines.push("## Verdict", "");
    lines.push(
      "INCOMPLETE — one or more checks were INCONCLUSIVE; absence of a finding is not a pass.",
      "",
    );
  }

  return `${lines.join("\n").trimEnd()}\n`;
}
