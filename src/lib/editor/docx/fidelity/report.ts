/** Per-fixture fidelity report: console table + Markdown file. */
import type { CheckResult } from "./types";

export interface FixtureReport {
  name: string;
  covers: string;
  importError?: string;
  importMs?: number;
  blocks?: number;
  warnings?: string[];
  checks: CheckResult[];
  roundTripError?: string;
  roundTripDiffs?: string[];
  soffice?: { referencePages?: number; exportPages?: number; ok: boolean; error?: string };
}

const pct = (n: number, d: number) => (d === 0 ? "–" : `${Math.round((n / d) * 100)}%`);

function counts(r: FixtureReport) {
  const hard = r.checks.filter((c) => !c.soft);
  const soft = r.checks.filter((c) => c.soft);
  return {
    hardPass: hard.filter((c) => c.ok).length,
    hardTotal: hard.length,
    softPass: soft.filter((c) => c.ok).length,
    softTotal: soft.length,
  };
}

function sofficeCell(r: FixtureReport): string {
  if (!r.soffice) return "–";
  if (r.soffice.error) return `error`;
  return `${r.soffice.exportPages ?? "?"}/${r.soffice.referencePages ?? "?"}${r.soffice.ok ? "" : " ✗"}`;
}

export function consoleRows(reports: FixtureReport[]) {
  return reports.map((r) => {
    const c = counts(r);
    return {
      fixture: r.name,
      import: r.importError ? "FAILED" : `${r.blocks} blocks`,
      checks: r.importError ? "–" : `${c.hardPass}/${c.hardTotal}`,
      soft: r.importError ? "–" : `${c.softPass}/${c.softTotal}`,
      warnings: r.warnings?.length ?? 0,
      roundTrip: r.roundTripError ? "FAILED" : r.roundTripDiffs ? (r.roundTripDiffs.length ? `${r.roundTripDiffs.length} diffs` : "identical") : "–",
      "LO pages (export/ref)": sofficeCell(r),
    };
  });
}

const esc = (s: string) => s.replace(/\|/g, "\\|").replace(/\n/g, " ");

export function markdownReport(reports: FixtureReport[], meta: { date: string; soffice: boolean; strict: boolean }): string {
  const lines: string[] = [];
  const all = reports.flatMap((r) => r.checks);
  const hard = all.filter((c) => !c.soft);
  lines.push("# DOCX fidelity report", "");
  lines.push(
    `Generated ${meta.date} by \`pnpm test:fidelity\`${meta.soffice ? " with the LibreOffice check" : ""}${meta.strict ? " (strict)" : ""}.`,
    "",
  );
  lines.push(
    `**Expectations:** ${hard.filter((c) => c.ok).length}/${hard.length} hard checks pass (${pct(hard.filter((c) => c.ok).length, hard.length)}), ` +
      `${all.filter((c) => c.soft && c.ok).length}/${all.filter((c) => c.soft).length} soft. ` +
      `**Round trip:** ${reports.filter((r) => r.roundTripDiffs && r.roundTripDiffs.length === 0).length}/${reports.length} fixtures identical after import → export → import.`,
    "",
  );
  lines.push("| Fixture | Import | Hard checks | Soft checks | Warnings | Round trip | LO pages (export/ref) |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const row of consoleRows(reports)) {
    lines.push(`| ${row.fixture} | ${row.import} | ${row.checks} | ${row.soft} | ${row.warnings} | ${row.roundTrip} | ${row["LO pages (export/ref)"]} |`);
  }
  lines.push("");
  for (const r of reports) {
    lines.push(`## ${r.name}`, "", `_${r.covers}_`, "");
    if (r.importError) {
      lines.push(`**Import failed:** \`${esc(r.importError)}\``, "");
      continue;
    }
    const failed = r.checks.filter((c) => !c.ok);
    if (failed.length === 0) lines.push("All checks pass.", "");
    else {
      lines.push("| | Check | Detail |", "|---|---|---|");
      for (const c of failed) lines.push(`| ${c.soft ? "soft" : "**FAIL**"} | ${esc(c.label)} | ${esc(c.detail ?? "")} |`);
      lines.push("");
    }
    if (r.warnings?.length) lines.push(`Warnings: ${r.warnings.map((w) => `“${esc(w)}”`).join("; ")}`, "");
    if (r.roundTripError) lines.push(`**Round trip failed:** \`${esc(r.roundTripError)}\``, "");
    else if (r.roundTripDiffs?.length) {
      lines.push(`Round-trip differences (${r.roundTripDiffs.length}):`, "");
      for (const d of r.roundTripDiffs.slice(0, 40)) lines.push(`- ${esc(d)}`);
      if (r.roundTripDiffs.length > 40) lines.push(`- … ${r.roundTripDiffs.length - 40} more`);
      lines.push("");
    }
    if (r.soffice?.error) lines.push(`LibreOffice check failed: \`${esc(r.soffice.error)}\``, "");
  }
  return lines.join("\n") + "\n";
}
