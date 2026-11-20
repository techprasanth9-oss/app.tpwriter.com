/**
 * Google-Docs-style card placement: each card wants to sit level with its
 * anchor; the active card gets its spot and the others are pushed up
 * (above it) or down (below it) just enough not to overlap.
 */
export interface CardSlot {
  id: string;
  /** Desired top (the anchor's top), px in track coordinates. */
  top: number;
  height: number;
}

export function layoutCards(slots: CardSlot[], activeId: string | null, gap = 8): Map<string, number> {
  const out = new Map<string, number>();
  if (!slots.length) return out;
  const sorted = [...slots].sort((a, b) => a.top - b.top);
  let pivot = activeId ? sorted.findIndex((s) => s.id === activeId) : -1;
  if (pivot < 0) pivot = 0;

  const tops = sorted.map((s) => s.top);
  tops[pivot] = Math.max(0, sorted[pivot].top);
  // Downwards from the pivot.
  for (let i = pivot + 1; i < sorted.length; i++) {
    tops[i] = Math.max(sorted[i].top, tops[i - 1] + sorted[i - 1].height + gap);
  }
  // Upwards from the pivot.
  for (let i = pivot - 1; i >= 0; i--) {
    tops[i] = Math.min(sorted[i].top, tops[i + 1] - sorted[i].height - gap);
  }
  // Cards pushed above the track's top: shift everything down to fit.
  const overflow = -Math.min(0, tops[0]);
  if (overflow > 0) {
    tops[0] += overflow;
    for (let i = 1; i < sorted.length; i++) {
      tops[i] = Math.max(tops[i], tops[i - 1] + sorted[i - 1].height + gap);
    }
  }
  sorted.forEach((s, i) => out.set(s.id, Math.round(tops[i])));
  return out;
}
