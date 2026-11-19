import type { BlockTool, BlockToolConstructorOptions } from "@editorjs/editorjs";
import type { PageLayout } from "~/lib/api/documents";

const PAPER = new Set(["A4", "LETTER", "LEGAL", "A3", "A5"]);
const PAPER_LABEL: Record<string, string> = { A4: "A4", LETTER: "Letter", LEGAL: "Legal", A3: "A3", A5: "A5" };

/** Keep only valid layout fields (they end up in a data attribute and in
 *  the paginator's geometry). */
export function cleanSectionLayout(raw: unknown): Partial<PageLayout> {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Partial<PageLayout> = {};
  if (PAPER.has(o.paperSize as string)) out.paperSize = o.paperSize as PageLayout["paperSize"];
  if (o.orientation === "portrait" || o.orientation === "landscape") out.orientation = o.orientation;
  for (const k of ["marginTop", "marginRight", "marginBottom", "marginLeft"] as const) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 400) out[k] = v;
  }
  return out;
}

/**
 * Section break (next page). The section after it uses `data.layout`
 * (paper size, orientation, margins) — e.g. one landscape page for a wide
 * table in a portrait document. The paginator reads the layout from the
 * rendered element's `data-layout`.
 */
export class SectionBreakTool implements BlockTool {
  static get toolbox() {
    return {
      title: "Section break",
      icon: '<svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor"><path d="M2 1h13v4H2zM2 12h13v4H2zM1 8h15v1H1z"/></svg>',
    };
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  private layout: Partial<PageLayout>;

  constructor({ data }: BlockToolConstructorOptions) {
    this.layout = cleanSectionLayout((data as { layout?: unknown } | undefined)?.layout);
  }

  render(): HTMLElement {
    const el = document.createElement("div");
    el.className = "tp-section-break";
    el.contentEditable = "false";
    el.setAttribute("role", "separator");
    el.dataset.layout = JSON.stringify(this.layout);
    const label = document.createElement("span");
    label.className = "tp-section-break__label";
    const parts = [
      this.layout.paperSize ? PAPER_LABEL[this.layout.paperSize] : null,
      this.layout.orientation === "landscape" ? "Landscape" : this.layout.orientation === "portrait" ? "Portrait" : null,
    ].filter(Boolean);
    label.textContent = `Section break (next page)${parts.length ? " · " + parts.join(" ") : ""}`;
    el.setAttribute("aria-label", label.textContent);
    el.appendChild(label);
    return el;
  }

  save(): { layout: Partial<PageLayout> } {
    return { layout: this.layout };
  }
}
