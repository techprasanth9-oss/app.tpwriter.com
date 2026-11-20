/**
 * DOCX fidelity suite — run with `pnpm test:fidelity` (vitest.fidelity.config.ts).
 * Not part of `pnpm test`: the default config only picks up `*.test.ts`.
 *
 * For every fixture in fixtures/docx (built by scripts/fixtures/build_docx_fixtures.py):
 *  (a) import it and run its declarative expectations (fixtures/docx/expectations.ts);
 *  (b) round-trip: import → exportDocx → import, compare normalised summaries;
 *  (c) FIDELITY_SOFFICE=1: convert our re-export to PDF with LibreOffice and
 *      compare its page count with fixtures/docx/reference.json (±15%).
 * Writes fixtures/docx/fidelity-report.md and prints a console table.
 *
 * Env: FIDELITY_STRICT=1  soft checks + round-trip diffs fail too
 *      FIDELITY_SOFFICE=1 enable (c);  FIDELITY_ONLY=05,07  run a subset
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EXPECTATIONS } from "../../../../fixtures/docx/expectations";
import { exportDocx } from "./exporter";
import { runChecks } from "./fidelity/checks";
import { consoleRows, markdownReport, type FixtureReport } from "./fidelity/report";
import { findSoffice, SofficeRenderer } from "./fidelity/soffice";
import { diffSummaries, summarize } from "./fidelity/summary";
import type { ImportedDocument } from "./import/types";
import { resolveStyles } from "../styles/namedStyles";

const ROOT = path.resolve(__dirname, "../../../..");
const FIXTURE_DIR = path.join(ROOT, "fixtures/docx");
const REPORT_PATH = path.join(FIXTURE_DIR, "fidelity-report.md");
const STRICT = process.env.FIDELITY_STRICT === "1";
const SOFFICE = process.env.FIDELITY_SOFFICE === "1";
const ONLY = (process.env.FIDELITY_ONLY ?? "").split(",").map((s) => s.trim()).filter(Boolean);

type ImportFn = (input: File | ArrayBuffer) => Promise<ImportedDocument>;

const fixtures = readdirSync(FIXTURE_DIR)
  .filter((f) => f.endsWith(".docx"))
  .map((f) => f.replace(/\.docx$/, ""))
  .filter((n) => ONLY.length === 0 || ONLY.some((o) => n.startsWith(o)))
  .sort();

const reference = (() => {
  const p = path.join(FIXTURE_DIR, "reference.json");
  if (!existsSync(p)) return {} as Record<string, { pages?: number }>;
  return (JSON.parse(readFileSync(p, "utf8")) as { fixtures: Record<string, { pages?: number }> }).fixtures;
})();

function readFixture(name: string): ArrayBuffer {
  const buf = readFileSync(path.join(FIXTURE_DIR, `${name}.docx`));
  return new Uint8Array(buf).buffer;
}

async function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as ArrayBuffer);
    r.onerror = () => reject(r.error);
    r.readAsArrayBuffer(blob);
  });
}

const reports = new Map<string, FixtureReport>();
const imported = new Map<string, ImportedDocument>();
const roundTripBytes = new Map<string, ArrayBuffer>();
let importDocxFile: ImportFn | null = null;
let importerError = "";
let renderer: SofficeRenderer | null = null;

beforeAll(async () => {
  try {
    // Resolved at run time so the suite still loads (and reports) while the
    // importer is missing or broken.
    const entry = path.join(__dirname, "import/index.ts");
    const mod = (await import(/* @vite-ignore */ entry)) as { importDocxFile?: ImportFn };
    if (typeof mod.importDocxFile !== "function") throw new Error("import/index.ts does not export importDocxFile");
    importDocxFile = mod.importDocxFile;
  } catch (e) {
    importerError = `importer unavailable: ${(e as Error).message}`;
  }
  if (SOFFICE) {
    const exe = findSoffice();
    if (exe) renderer = new SofficeRenderer(exe);
  }
});

afterAll(() => {
  renderer?.dispose();
  const list = fixtures.map((n) => reports.get(n)).filter((r): r is FixtureReport => !!r);
  if (list.length === 0) return;
  console.table(consoleRows(list));
  writeFileSync(
    REPORT_PATH,
    markdownReport(list, { date: new Date().toISOString().slice(0, 10), soffice: SOFFICE, strict: STRICT }),
  );
  console.log(`Fidelity report: ${path.relative(ROOT, REPORT_PATH)}`);
});

describe("DOCX fidelity corpus", () => {
  it("has expectations for every fixture (and a fixture for every expectation)", () => {
    const all = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".docx")).map((f) => f.replace(/\.docx$/, ""));
    expect(all.filter((n) => !EXPECTATIONS[n])).toEqual([]);
    expect(Object.keys(EXPECTATIONS).filter((n) => !all.includes(n))).toEqual([]);
  });

  for (const name of fixtures) {
    describe(name, () => {
      const report = (): FixtureReport => {
        let r = reports.get(name);
        if (!r) {
          r = { name, covers: EXPECTATIONS[name]?.covers ?? "", checks: [] };
          reports.set(name, r);
        }
        return r;
      };

      it("imports and meets its expectations", async () => {
        const r = report();
        if (!importDocxFile) {
          r.importError = importerError;
          throw new Error(importerError);
        }
        const t0 = performance.now();
        let doc: ImportedDocument;
        try {
          doc = await importDocxFile(readFixture(name));
        } catch (e) {
          r.importError = (e as Error).stack ?? String(e);
          throw e;
        }
        r.importMs = Math.round(performance.now() - t0);
        r.blocks = doc.blocks.length;
        r.warnings = doc.warnings;
        imported.set(name, doc);

        r.checks = runChecks(doc, EXPECTATIONS[name]?.checks ?? []);
        const failing = r.checks.filter((c) => !c.ok && (STRICT || !c.soft));
        expect(failing.map((c) => `${c.soft ? "[soft] " : ""}${c.label} — ${c.detail}`)).toEqual([]);
      });

      it("round-trips through exportDocx", async () => {
        const r = report();
        const first = imported.get(name);
        if (!first) throw new Error("first import failed");
        let second: ImportedDocument;
        let bytes: ArrayBuffer;
        try {
          const blob = await exportDocx(
            { blocks: first.blocks },
            {
              title: first.title,
              defaultLayout: first.defaultLayout,
              pageSetup: first.pageSetup,
              // Named styles round-trip as Word styles.
              styles: resolveStyles(first.styles),
            },
          );
          bytes = await blobBytes(blob);
          second = await importDocxFile!(bytes.slice(0));
        } catch (e) {
          r.roundTripError = (e as Error).stack ?? String(e);
          throw e;
        }
        r.roundTripDiffs = diffSummaries(summarize(first), summarize(second));
        roundTripBytes.set(name, bytes);
        expect(second.blocks.length).toBeGreaterThan(0);
        if (STRICT) expect(r.roundTripDiffs).toEqual([]);
      });

      it.skipIf(!SOFFICE)("re-export opens in LibreOffice and paginates comparably (±15%)", () => {
        const r = report();
        const ref = reference[name]?.pages;
        if (!renderer) throw new Error("FIDELITY_SOFFICE=1 but LibreOffice (soffice) was not found; set SOFFICE=/path/to/soffice");
        const bytes = roundTripBytes.get(name);
        if (!bytes) throw new Error("no re-exported document (round trip failed)");
        try {
          const pages = renderer.pages(name, new Uint8Array(bytes));
          const ok = ref !== undefined && Math.abs(pages - ref) <= Math.max(1, Math.round(ref * 0.15));
          r.soffice = { referencePages: ref, exportPages: pages, ok };
          expect(ref, "reference.json has no page count — run pnpm fixtures:build").toBeDefined();
          expect(pages, `LibreOffice pages for the re-export vs reference ${ref}`).toBeGreaterThanOrEqual(ref! - Math.max(1, Math.round(ref! * 0.15)));
          expect(pages).toBeLessThanOrEqual(ref! + Math.max(1, Math.round(ref! * 0.15)));
        } catch (e) {
          r.soffice ??= { referencePages: ref, ok: false, error: (e as Error).message.split("\n")[0] };
          throw e;
        }
      });
    });
  }
});
