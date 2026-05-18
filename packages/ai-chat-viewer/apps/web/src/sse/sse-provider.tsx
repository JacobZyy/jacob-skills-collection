import { useQueryClient } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import type { EmitterEvents } from "@ai-chat-viewer/server/sse-events";
import { queryKeys } from "../api/queries";
import { acquireSseConnection, releaseSseConnection } from "./event-source";

// SseProvider — single-mount React component that wires the shared
// EventSource (event-source.ts) into TanStack Query cache invalidation.
//
// Where this lives in the tree:
//   <QueryClientProvider>
//     <SseProvider>
//       <App />
//     </SseProvider>
//   </QueryClientProvider>
//
//   It must be INSIDE QueryClientProvider because `useQueryClient` will
//   throw otherwise. It does not need to render any UI; children pass
//   through.
//
// Why a Provider rather than a top-level effect in main.tsx:
//   - StrictMode double-mount semantics are scoped to React, so the effect
//     lifecycle is the natural place to manage the acquire/release pair.
//   - When ErrorBoundary (#43 T41) wraps the route tree, it can choose to
//     unmount SseProvider during fatal-error recovery; a top-level subscriber
//     can't be torn down without restarting React.
//
// What we deliberately do NOT do:
//   - No reconnection logic. EventSource ships with browser-native
//     exponential backoff (configurable only via the server's `retry:`
//     field). AC-3 measurement assumes this fast path; wrapping it would
//     add jitter we can't predict.
//   - No heartbeat handler. The server emits `: comment\n\n` lines per the
//     SSE spec, which EventSource silently discards. Also no listener on
//     the `hello` event — it exists only to flush the connect handshake to
//     the wire for curl/devtools, and TanStack cache doesn't need to know.
//   - No `onerror` console noise. The browser's network panel surfaces
//     reconnection attempts; a console.error here would pollute test
//     output and trip the ErrorBoundary's logger (#43) into reporting
//     transient network blips as bugs.

// Payload types are imported by name to make the listener call sites
// strongly typed; the runtime data crosses the wire as JSON.parse(string)
// so we ALSO guard with a try/catch on parse before invalidating.
type MessageAppendedPayload = EmitterEvents["message-appended"][0];
type AttachmentAppendedPayload = EmitterEvents["attachment-appended"][0];
type SessionUpdatedPayload = EmitterEvents["session-updated"][0];
type ProjectUpdatedPayload = EmitterEvents["project-updated"][0];

// Discriminated handler map: each key matches an SSE `event:` name on the
// wire (see server/src/sse/bus.ts EVENT_NAMES). The factory function
// returned by `buildHandlers` gets a queryClient instance so the closure
// captures it correctly across StrictMode re-runs.
type HandlerMap = {
  "message-appended": (e: MessageEvent<string>) => void;
  "attachment-appended": (e: MessageEvent<string>) => void;
  "session-updated": (e: MessageEvent<string>) => void;
  "project-updated": (e: MessageEvent<string>) => void;
};

function buildHandlers(
  invalidate: (keyParts: readonly unknown[]) => void,
): HandlerMap {
  // tryParse returns null on any malformed payload. The server never emits
  // malformed JSON, so the only realistic null path is a future schema
  // change shipped to web before server — fail-soft (skip the
  // invalidation) is preferable to throwing in a global event handler
  // (which would tear down EventSource).
  const tryParse = <T,>(raw: string): T | null => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  return {
    // project-updated → list pages (only ProjectsPage today). A new project
    // observation OR an existing project's lastSeenAt/sessionCount changed.
    "project-updated": (e) => {
      const payload = tryParse<ProjectUpdatedPayload>(e.data);
      if (payload === null) return;
      invalidate(queryKeys.projects());
    },

    // session-updated → the project's session list AND the project card
    // (sessionCount / lastSeenAt may shift). The patch's sessionId lets us
    // hit the precise sessions sub-list, BUT the queryKey is keyed by
    // cwdHash, which the patch may not carry — so we fall back to
    // invalidating the broader 'sessions' prefix when cwdHash is absent.
    "session-updated": (e) => {
      const payload = tryParse<SessionUpdatedPayload>(e.data);
      if (payload === null) return;
      // Project cards always need a refresh (sessionCount is on the card).
      invalidate(queryKeys.projects());
      // Sessions list — `cwdHash` is the queryKey, but session-updated's
      // patch is keyed by sessionId. We invalidate by prefix so every
      // open sessions list refreshes; this is precise to the 'sessions'
      // domain and does NOT touch 'projects' or 'sessionMessages' caches.
      invalidate(["sessions"] as const);
      // Session-level message/attachment lists may also be affected
      // (title fallback chain etc.). Touch them by prefix.
      invalidate(["sessionMessages", payload.sessionId] as const);
      invalidate(["sessionAttachments", payload.sessionId] as const);
    },

    // message-appended → the open session's message list. Invalidate the
    // exact session id; other sessions' caches are untouched.
    "message-appended": (e) => {
      const payload = tryParse<MessageAppendedPayload>(e.data);
      if (payload === null) return;
      invalidate(queryKeys.sessionMessages(payload.sessionId));
    },

    // attachment-appended → the open session's attachment list.
    "attachment-appended": (e) => {
      const payload = tryParse<AttachmentAppendedPayload>(e.data);
      if (payload === null) return;
      invalidate(queryKeys.sessionAttachments(payload.sessionId));
    },
  };
}

export interface SseProviderProps {
  children: ReactNode;
}

export function SseProvider({ children }: SseProviderProps) {
  const queryClient = useQueryClient();

  useEffect(() => {
    const invalidate = (keyParts: readonly unknown[]): void => {
      // `keyParts` is the prefix to match; TanStack does partial-key match
      // unless `exact: true`. We deliberately leave that off so a partial
      // prefix like `['sessions']` invalidates every per-cwdHash cache.
      void queryClient.invalidateQueries({ queryKey: [...keyParts] });
    };

    const handlers = buildHandlers(invalidate);
    const source = acquireSseConnection();

    // EventSource.addEventListener is typed as (type: string, listener:
    // (this: EventSource, ev: Event) => unknown). The `MessageEvent<string>`
    // narrowing on the handler signature requires a cast at the boundary —
    // we narrow via a typed wrapper rather than `as any`.
    const attach = <K extends keyof HandlerMap>(
      name: K,
      fn: HandlerMap[K],
    ): (() => void) => {
      const wrapped: EventListener = (ev) => {
        // SSE 'event:' frames always arrive as MessageEvent on the DOM
        // side; the only risk is a non-MessageEvent slipping through
        // (impossible for typed channels but cheap to guard).
        if (ev instanceof MessageEvent) {
          fn(ev as MessageEvent<string>);
        }
      };
      source.addEventListener(name, wrapped);
      return () => source.removeEventListener(name, wrapped);
    };

    const detachers = [
      attach("message-appended", handlers["message-appended"]),
      attach("attachment-appended", handlers["attachment-appended"]),
      attach("session-updated", handlers["session-updated"]),
      attach("project-updated", handlers["project-updated"]),
    ];

    if (import.meta.env.DEV) {
      // DEV-only diagnostic: log when the connection opens or hits the
      // native auto-reconnect path. We use console.debug (not log) so a
      // configured devtools filter can hide it.
      console.debug("[sse] subscribed to /api/stream");
    }

    return () => {
      for (const detach of detachers) detach();
      releaseSseConnection();
    };
  }, [queryClient]);

  return <>{children}</>;
}
