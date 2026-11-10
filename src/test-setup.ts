// jsdom doesn't implement layout observers; tools only use them for UI
// positioning, so a no-op stand-in is enough for data tests.
class NoopObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoopObserver as unknown as typeof ResizeObserver;
