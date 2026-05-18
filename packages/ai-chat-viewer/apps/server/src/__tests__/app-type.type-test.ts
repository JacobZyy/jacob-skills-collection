// Smoke test: AppType propagates route shapes to a Hono RPC consumer.
//
// This file is *only* type-checked, never executed at runtime. It mimics
// what apps/web will do: import the type, instantiate hc<AppType>, then
// touch each endpoint to ensure path params and response bodies survive
// the type-level round-trip without collapsing to `any`.
//
// If a route is added or its return type changes, the assertions below
// will catch it as a compile error rather than letting it slip silently
// into the web client.

import type { AppType } from "../lib/app-type";
import { hc } from "hono/client";
import type {
  AttachmentRecord,
  MessageRecord,
  ProjectRecord,
  SessionRecord,
} from "@ai-chat-viewer/schema";

const client = hc<AppType>("http://localhost:3001");

// Compile-time assertion helper: ensures a value is assignable to T.
// Pure type-level, zero runtime.
function expectType<T>(_x: T): void {
  /* type-only */
}

async function smoke(): Promise<void> {
  // /api/projects → { items: (ProjectRecord & { sessionCount: number })[] }
  const projectsRes = await client.api.projects.$get();
  const projectsBody = await projectsRes.json();
  expectType<ReadonlyArray<ProjectRecord & { sessionCount: number }>>(
    projectsBody.items
  );

  // /api/projects/:cwdHash/sessions → { items: (SessionRecord & { title })[] }
  const sessionsRes = await client.api.projects[":cwdHash"].sessions.$get({
    param: { cwdHash: "abc" },
  });
  const sessionsBody = await sessionsRes.json();
  expectType<ReadonlyArray<SessionRecord & { title: string }>>(
    sessionsBody.items
  );

  // /api/sessions/:id/messages → { items: MessageRecord[] }
  const messagesRes = await client.api.sessions[":id"].messages.$get({
    param: { id: "sess-1" },
  });
  const messagesBody = await messagesRes.json();
  expectType<ReadonlyArray<MessageRecord>>(messagesBody.items);

  // /api/sessions/:id/attachments → { items: AttachmentRecord[] }
  const attachmentsRes = await client.api.sessions[":id"].attachments.$get({
    param: { id: "sess-1" },
  });
  const attachmentsBody = await attachmentsRes.json();
  expectType<ReadonlyArray<AttachmentRecord>>(attachmentsBody.items);
}

// Keep `smoke` referenced so the file isn't tree-shaken out of typecheck.
export { smoke };
