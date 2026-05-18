// Singleton EventSource factory for the web app's SSE connection.
//
// Why a singleton:
//   - SSE multiplexes every event channel over ONE long-lived HTTP/1.1
//     connection (server/src/sse/stream.ts). If we opened a new EventSource
//     per hook/component, we would fan out N idle connections per browser tab
//     and trip Hono's per-route listener cap on the server.
//   - The handful of consumers we expect (Provider + future devtools panel)
//     all subscribe to the SAME event names via .addEventListener — that is
//     EventSource's own multi-listener API, not a wrapper concern.
//
// React StrictMode dev pitfall:
//   - StrictMode mounts effects twice. If the Provider eagerly constructed a
//     new EventSource in its effect, dev would briefly hold two open
//     connections and fire each handler twice for the first second. We
//     guard against that here by exposing a `getOrCreate` accessor — the
//     Provider's first mount creates, the second mount reuses, and Provider
//     unmount closes only when the ref-count returns to zero.
//
// Connection target:
//   - The path `/api/stream` resolves via the Vite dev proxy
//     (apps/web/vite.config.ts: `/api` → http://127.0.0.1:3001). Production
//     ships same-origin under Tauri, so a relative URL is correct in both.
//   - `withCredentials: false` (the default) — the server allows
//     credential-less requests from the Vite dev origin; matching the
//     existing fetch wrapper in rpc-client.ts (`credentials: "omit"`).

const SSE_PATH = "/api/stream";

// We keep the singleton + a reference count at module scope. The closure
// survives HMR for the Provider component because Vite's React Fast Refresh
// only reloads component modules, not their dependencies — exactly what we
// want, otherwise reconnection storms would happen on every save.
let connection: EventSource | null = null;
let refCount = 0;

/**
 * Acquire the shared EventSource. Increments the internal ref count.
 *
 * The caller MUST balance every `acquire()` with one `release()` in cleanup.
 * The Provider does this from its `useEffect` return.
 */
export function acquireSseConnection(): EventSource {
  if (connection === null) {
    connection = new EventSource(SSE_PATH);
  }
  refCount += 1;
  return connection;
}

/**
 * Release a reference. When the count hits zero, the underlying EventSource
 * is closed. The connection is not closed earlier, even on errors — the
 * browser's native `readyState` transitions handle transient failures and
 * we want to ride the built-in auto-reconnect (AC-3 wire path).
 */
export function releaseSseConnection(): void {
  refCount = Math.max(0, refCount - 1);
  if (refCount === 0 && connection !== null) {
    connection.close();
    connection = null;
  }
}

/**
 * Test/devtools accessor — never use this in production component code.
 * Exposed so a hypothetical devtools panel can read `.readyState` without
 * bumping the ref count.
 */
export function peekSseConnection(): EventSource | null {
  return connection;
}
