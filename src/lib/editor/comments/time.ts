/** Short relative timestamps ("just now", "5 min ago", "Yesterday"…). */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return "";
  const sec = Math.round((now.getTime() - t.getTime()) / 1000);
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hours = Math.round(min / 60);
  if (hours < 24 && sameDay(t, now)) return `${hours} h ago`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const time = t.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (sameDay(t, yesterday)) return `Yesterday ${time}`;
  if (hours < 24) return `${hours} h ago`;
  const opts: Intl.DateTimeFormatOptions =
    t.getFullYear() === now.getFullYear() ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" };
  return t.toLocaleDateString(undefined, opts);
}

export function fullTime(iso: string): string {
  const t = new Date(iso);
  return Number.isNaN(t.getTime()) ? "" : t.toLocaleString();
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "Today", "Yesterday" or a date heading for grouping. */
export function dayLabel(iso: string, now: Date = new Date()): string {
  const t = new Date(iso);
  if (sameDay(t, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (sameDay(t, y)) return "Yesterday";
  return t.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(t.getFullYear() !== now.getFullYear() ? { year: "numeric" } : {}),
  });
}
