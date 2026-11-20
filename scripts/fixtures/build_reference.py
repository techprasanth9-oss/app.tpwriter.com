#!/usr/bin/env python3
"""
Summarise LibreOffice PDF renders into reference.json.

Page count: poppler's `pdfinfo` when available, else a tiny regex over the
PDF's page-tree /Count. Per-page text: poppler's `pdftotext -f N -l N` when
available (whitespace-collapsed), else omitted.

Usage: build_reference.py FIXTURE_DIR RENDER_DIR
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


def page_count(pdf: Path) -> tuple[int, str]:
    if shutil.which("pdfinfo"):
        out = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True, check=True).stdout
        m = re.search(r"^Pages:\s+(\d+)", out, re.M)
        if m:
            return int(m.group(1)), "pdfinfo"
    data = pdf.read_bytes()
    # The root /Pages node carries the largest /Count.
    counts = [int(n) for n in re.findall(rb"/Type\s*/Pages\b[^>]*?/Count\s+(\d+)", data)]
    counts += [int(n) for n in re.findall(rb"/Count\s+(\d+)[^>]*?/Type\s*/Pages\b", data)]
    return (max(counts) if counts else 0), "regex"


def page_texts(pdf: Path, pages: int) -> list[str] | None:
    if not shutil.which("pdftotext"):
        return None
    texts = []
    for n in range(1, pages + 1):
        out = subprocess.run(
            ["pdftotext", "-enc", "UTF-8", "-f", str(n), "-l", str(n), str(pdf), "-"],
            capture_output=True,
            text=True,
        ).stdout
        texts.append(re.sub(r"\s+", " ", out).strip())
    return texts


def main():
    fixture_dir, render_dir = Path(sys.argv[1]), Path(sys.argv[2])
    ref: dict = {
        "generator": "LibreOffice headless (soffice --convert-to pdf)",
        "soffice": soffice_version(),
        "fixtures": {},
    }
    for docx in sorted(fixture_dir.glob("*.docx")):
        pdf = render_dir / f"{docx.stem}.pdf"
        if not pdf.exists():
            ref["fixtures"][docx.stem] = {"error": "conversion failed"}
            continue
        pages, method = page_count(pdf)
        entry: dict = {"pages": pages, "pageCountMethod": method}
        texts = page_texts(pdf, pages)
        if texts is not None:
            entry["pageText"] = texts
        ref["fixtures"][docx.stem] = entry
        print(f"  {docx.stem:28s} {pages:3d} page(s)")
    out = fixture_dir / "reference.json"
    out.write_text(json.dumps(ref, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Wrote {out}")


def soffice_version() -> str | None:
    exe = shutil.which("soffice") or "/opt/homebrew/bin/soffice"
    try:
        out = subprocess.run([exe, "--version"], capture_output=True, text=True, timeout=60).stdout
        return out.strip() or None
    except Exception:
        return None


if __name__ == "__main__":
    main()
