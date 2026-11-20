import { useEffect, useRef, useState } from "react";
import { heartbeat, type Presence } from "~/lib/api/collab";

interface Options {
  documentId: string;
  /** Whether this person can edit (reported as "editing" vs "viewing"). */
  canEdit: boolean;
  /** The document root, to find the block the caret is in. */
  getRoot: () => HTMLElement | null;
  intervalMs?: number;
}

/**
 * Heartbeat this person's presence and return everyone else on the
 * document. Blocks others are editing get a coloured bar in the margin
 * (a generated stylesheet — block DOM is never touched).
 */
export function usePresence({ documentId, canEdit, getRoot, intervalMs = 5000 }: Options): Presence[] {
  const [present, setPresent] = useState<Presence[]>([]);
  const getRootRef = useRef(getRoot);
  getRootRef.current = getRoot;

  useEffect(() => {
    let cancelled = false;
    const caretBlock = (): string | null => {
      const root = getRootRef.current();
      const node = document.getSelection()?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const block = el?.closest<HTMLElement>(".ce-block[data-id]");
      return block && root?.contains(block) ? block.dataset.id ?? null : null;
    };
    let lastBlock: string | null = null;
    const beat = async () => {
      if (document.hidden) return;
      lastBlock = canEdit ? caretBlock() : null;
      try {
        const res = await heartbeat(documentId, { state: canEdit ? "editing" : "viewing", blockId: lastBlock });
        if (!cancelled) setPresent((prev) => (JSON.stringify(prev) === JSON.stringify(res.present) ? prev : res.present));
      } catch {
        /* offline — keep the last list until the next beat */
      }
    };
    void beat();
    const timer = window.setInterval(() => void beat(), intervalMs);
    // Moving to another block is worth telling others promptly.
    let pending: number | null = null;
    const onSelection = () => {
      if (!canEdit || caretBlock() === lastBlock || pending !== null) return;
      pending = window.setTimeout(() => {
        pending = null;
        void beat();
      }, 800);
    };
    document.addEventListener("selectionchange", onSelection);
    const onVisible = () => {
      if (!document.hidden) void beat();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      if (pending !== null) window.clearTimeout(pending);
      document.removeEventListener("selectionchange", onSelection);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [documentId, canEdit, intervalMs]);

  // Margin bars for blocks others are editing.
  useEffect(() => {
    const style = document.createElement("style");
    style.dataset.tpPresence = "";
    style.textContent = present
      .filter((p) => p.state === "editing" && p.blockId && /^[#0-9a-fA-F]{4,9}$/.test(p.color))
      .map((p) => `.tp-document .ce-block[data-id="${CSS.escape(p.blockId!)}"]{box-shadow:-6px 0 0 -2px ${p.color}}`)
      .join("\n");
    document.head.appendChild(style);
    return () => style.remove();
  }, [present]);

  return present;
}
