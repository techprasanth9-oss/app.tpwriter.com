/**
 * Optional LibreOffice cross-check (FIDELITY_SOFFICE=1): convert a .docx to
 * PDF headlessly and count its pages. Node-only (used from the fidelity
 * suite, never from app code).
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

export function findSoffice(): string | null {
  const candidates = [
    process.env.SOFFICE,
    "/opt/homebrew/bin/soffice",
    "/usr/local/bin/soffice",
    "/usr/bin/soffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
  ].filter((p): p is string => !!p);
  return candidates.find((p) => existsSync(p)) ?? null;
}

/** Page count of a PDF: `pdfinfo` when available, else the page tree's /Count. */
export function pdfPageCount(pdfPath: string): number {
  try {
    const out = execFileSync("pdfinfo", [pdfPath], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const m = /^Pages:\s+(\d+)/m.exec(out);
    if (m) return Number(m[1]);
  } catch {
    /* fall through to the regex */
  }
  const raw = readFileSync(pdfPath).toString("latin1");
  const counts = [...raw.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)].map((m) =>
    Number(m[1] ?? m[2]),
  );
  return counts.length ? Math.max(...counts) : 0;
}

export class SofficeRenderer {
  private readonly dir: string;
  private readonly profile: string;

  constructor(private readonly exe: string) {
    this.dir = mkdtempSync(path.join(tmpdir(), "tp-fidelity-"));
    this.profile = path.join(this.dir, "profile");
    mkdirSync(this.profile);
  }

  /** Convert DOCX bytes → PDF and return the page count (throws on failure). */
  pages(name: string, docx: Uint8Array): number {
    const input = path.join(this.dir, `${name}.docx`);
    writeFileSync(input, docx);
    execFileSync(
      this.exe,
      [`-env:UserInstallation=file://${this.profile}`, "--headless", "--convert-to", "pdf", "--outdir", this.dir, input],
      { stdio: "ignore", timeout: 120_000 },
    );
    const pdf = path.join(this.dir, `${name}.pdf`);
    if (!existsSync(pdf)) throw new Error("LibreOffice produced no PDF");
    return pdfPageCount(pdf);
  }

  dispose() {
    rmSync(this.dir, { recursive: true, force: true });
  }
}
