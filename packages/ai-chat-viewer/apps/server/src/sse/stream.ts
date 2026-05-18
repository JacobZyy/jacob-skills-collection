import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { SSEStreamingApi } from "hono/streaming";
import {
  EVENT_NAMES,
  ingestionBus,
  type EmitterEvents,
  type EventName,
} from "./bus";

// GET /api/stream — Server-Sent Events endpoint that pushes ingestion
// updates to the web client in real time.
//
// Wire protocol (per HTML5 SSE spec):
//   event: <event-name>     ← matches EmitterEvents key
//   data: <json-payload>    ← JSON-stringified arg tuple's first element
//   id: <monotonic-counter> ← so Last-Event-ID reconnect is meaningful
//   <blank line>            ← terminator
//
// Heartbeat:
//   Every HEARTBEAT_MS we write a `:` comment line. Browsers, reverse
//   proxies (nginx, Cloudflare), and intermediate corp networks all drop
//   idle long-poll connections after ~30-60s. A 15s heartbeat is well
//   inside any reasonable idle timeout while staying cheap.
//
// Cleanup:
//   When the client disconnects, the streamSSE callback's stream.aborted
//   transitions and we drop our listeners off the bus. Without this we'd
//   leak one listener-per-event-per-disconnected-client and eventually
//   trip the bus's setMaxListeners(100) warning.
//
// Why one route, not one route per event:
//   - SSE multiplexes naturally over a single connection.
//   - The web client's EventSource subscribes to specific `event:` names
//     via `es.addEventListener("message-appended", ...)`.
//   - Fewer connections = fewer reconnects on transient network blips.
//
// AC-3: catch-up p95 < 2s. The runner emits synchronously after each
// Prisma commit; this route writes synchronously to the SSE stream. The
// only buffering is the kernel send-buffer, measured in microseconds.

const HEARTBEAT_MS = 15_000;

// Helper: the first (and only) payload of an event tuple. EmitterEvents
// uses tuple shapes for forward-compat with multi-arg events, but every
// event today carries a single record/patch object.
type Payload<K extends EventName> = EmitterEvents[K][0];

export const streamRouter = new Hono().get("/stream", (c) => {
  return streamSSE(c, async (stream: SSEStreamingApi) => {
    // Monotonic event id, used as SSE `id:`. The reconnecting client
    // sends Last-Event-ID back; we don't replay yet (V2), but exposing
    // ids now means we don't have to add them later without breaking
    // the wire format.
    let nextId = 0;

    // One listener per event name. We keep refs so we can remove them
    // precisely on disconnect — passing a fresh closure to .off would
    // leak.
    const listeners = new Map<EventName, (...args: unknown[]) => void>();

    // Wire up subscriptions BEFORE the heartbeat loop starts. If we
    // missed an emit between connect-accept and listener-install, that
    // event is dropped — acceptable for V1 (the web client refetches
    // on mount anyway). Catch-up replay is V2.
    for (const event of EVENT_NAMES) {
      const listener = (payload: Payload<typeof event>): void => {
        // SSE writes are async (await flushes the writable stream).
        // Fire-and-forget here: if the client has gone away mid-write,
        // streamSSE catches the error and triggers cleanup below.
        void stream.writeSSE({
          event,
          id: String(nextId++),
          data: JSON.stringify(payload),
        });
      };
      // `(...args: unknown[]) => void` is the runtime shape the bus's
      // generic .on accepts after type erasure. The bus's emit-side is
      // strictly typed via EmitterEvents, so the listener still sees
      // the right payload shape at runtime.
      const erased = listener as (...args: unknown[]) => void;
      ingestionBus.on(event, listener);
      listeners.set(event, erased);
    }

    // Heartbeat keeps idle connections alive through intermediate proxies.
    // We use a `:` comment line per the SSE spec — clients ignore comment
    // frames, but proxies see TCP activity and don't time out.
    const heartbeat = setInterval(() => {
      void stream.writeSSE({ data: "", event: "heartbeat" });
    }, HEARTBEAT_MS);

    // Send one event immediately so curl/browser sees the connection
    // is alive without waiting up to HEARTBEAT_MS. Also a useful sanity
    // check during development.
    await stream.writeSSE({
      event: "hello",
      id: String(nextId++),
      data: JSON.stringify({ ts: new Date().toISOString() }),
    });

    // Block here until the client disconnects. streamSSE resolves the
    // promise when the underlying writable stream closes/errors. The
    // exact mechanism: Hono awaits this callback, and the runtime
    // throws WriterClosedError into the awaiter when the consumer goes.
    await new Promise<void>((resolve) => {
      // stream.onAbort fires when the client closes the connection or
      // the response is otherwise terminated. This is the documented
      // hook in Hono's streaming helper.
      stream.onAbort(() => {
        resolve();
      });
    });

    // Cleanup. Order matters: stop the heartbeat first so a late tick
    // doesn't try to write into a closed stream, then unsubscribe so
    // the bus's listener count drops.
    clearInterval(heartbeat);
    for (const [event, listener] of listeners) {
      // Cast back to the same runtime shape for `.off` — see comment
      // on the listener install above.
      ingestionBus.off(
        event,
        listener as (...args: EmitterEvents[typeof event]) => void
      );
    }
  });
});
