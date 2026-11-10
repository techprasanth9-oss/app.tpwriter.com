import type { BlockTool } from "@editorjs/editorjs";

/**
 * Manual page break. Renders as a thin labelled rule; the paginator starts
 * the following block on a new page. Carries no data.
 */
export class PageBreakTool implements BlockTool {
  static get toolbox() {
    return {
      title: "Page break",
      icon: '<svg width="17" height="17" viewBox="0 0 17 17" fill="currentColor"><path d="M3 1h11v4H3zM3 12h11v4H3zM1 8h3v1H1zm5 0h5v1H6zm7 0h3v1h-3z"/></svg>',
    };
  }

  static get isReadOnlySupported(): boolean {
    return true;
  }

  render(): HTMLElement {
    const el = document.createElement("div");
    el.className = "tp-page-break";
    el.contentEditable = "false";
    el.setAttribute("role", "separator");
    el.setAttribute("aria-label", "Page break");
    el.innerHTML = '<span class="tp-page-break__label">Page break</span>';
    return el;
  }

  save(): Record<string, never> {
    return {};
  }
}
