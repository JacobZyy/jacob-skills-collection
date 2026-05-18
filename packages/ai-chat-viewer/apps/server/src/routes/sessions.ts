import { Hono } from "hono";
import {
  AttachmentRecordSchema,
  MessageRecordSchema,
  MessageRoleSchema,
  SessionRecordSchema,
} from "@ai-chat-viewer/schema";
import type {
  AttachmentRecord,
  MessageRecord,
  MessageRole,
  SessionRecord,
} from "@ai-chat-viewer/schema";
import { z } from "zod";
import { prisma } from "../prisma";

// Sessions endpoints. Three routes:
//   GET /api/projects/:cwdHash/sessions
//     Sessions for a project, ordered by lastActivityAt DESC. Each row gets
//     a derived `title` via the spec Q6 fallback chain:
//       summary || lastPrompt.slice(0, 80) || firstUserMessage.slice(0, 80)
//   GET /api/sessions/:id/messages
//     Full message tree for a session, timestamp ASC.
//   GET /api/sessions/:id/attachments
//     Full attachment list, observedAt ASC.
//
// V1 returns the entire result set per call. AC-4 only requires <1s render
// for a session view, and the largest single session in the corpus is well
// under what a one-shot SELECT can stream. Pagination is a V2 concern.
//
// Title fallback rationale: spec deep-interview Q6.

const TITLE_MAX = 80;

// Domain title is intentionally NOT part of SessionRecord (the schema is the
// raw projection of DB columns). It's a pure derivation we apply at the
// route boundary so renderers don't have to repeat the fallback logic.
const SessionListItemSchema = SessionRecordSchema.extend({
  title: z.string(),
});
type SessionListItem = z.infer<typeof SessionListItemSchema>;

const SessionListResponseSchema = z.object({
  items: z.array(SessionListItemSchema),
});
type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

const MessageListResponseSchema = z.object({
  items: z.array(MessageRecordSchema),
});
type MessageListResponse = z.infer<typeof MessageListResponseSchema>;

const AttachmentListResponseSchema = z.object({
  items: z.array(AttachmentRecordSchema),
});
type AttachmentListResponse = z.infer<typeof AttachmentListResponseSchema>;

// Re-exports so the projects/sessions endpoints' shapes are consumed by
// downstream tooling (worker-web's RPC client) via `z.infer<...>` if it
// wants to derive its own narrowed types.
export {
  SessionListItemSchema,
  SessionListResponseSchema,
  MessageListResponseSchema,
  AttachmentListResponseSchema,
};
export type {
  SessionListItem,
  SessionListResponse,
  MessageListResponse,
  AttachmentListResponse,
};

function toIso(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}

// V1 hard pin: every row we ingest is "claude-code". The DB column is a
// String for forward-compat (multi-tool V2), but at read time we narrow back
// to the literal that the domain schema expects. If a non-"claude-code"
// value ever lands in the DB before the schema bump, we want to crash
// loudly rather than emit invalid records.
function narrowTool(tool: string): "claude-code" {
  if (tool !== "claude-code") {
    throw new Error(`[sessions] unexpected tool=${tool} in DB; schema bump required`);
  }
  return "claude-code";
}

function narrowRole(role: string): MessageRole {
  const parsed = MessageRoleSchema.safeParse(role);
  if (!parsed.success) {
    throw new Error(`[sessions] unexpected role=${role} in DB`);
  }
  return parsed.data;
}

// Extract a plain-text excerpt from the first user message for the third-tier
// title fallback. ChatMessage.content is Json (Prisma) / unknown (domain),
// shape is tool-specific. For claude-code, content is typically:
//   - string (legacy)
//   - Array<{ type: "text"; text: string } | ...>
// We walk both shapes; on shape mismatch we fall through to "" so the
// fallback chain produces "Untitled session" rather than crashing.
function extractFirstText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block !== null &&
        typeof block === "object" &&
        "type" in block &&
        (block as { type: unknown }).type === "text" &&
        "text" in block &&
        typeof (block as { text: unknown }).text === "string"
      ) {
        return (block as { text: string }).text;
      }
    }
  }
  return "";
}

function deriveTitle(
  summary: string | null,
  lastPrompt: string | null,
  firstUserText: string
): string {
  if (summary && summary.trim() !== "") return summary;
  if (lastPrompt && lastPrompt.trim() !== "") {
    return lastPrompt.slice(0, TITLE_MAX);
  }
  if (firstUserText.trim() !== "") return firstUserText.slice(0, TITLE_MAX);
  return "Untitled session";
}

// Per-row session shape returned from Prisma findMany. Listed explicitly so
// type changes to the Prisma model surface here as compile errors instead
// of silent property loss.
interface SessionRow {
  id: string;
  projectCwdHash: string;
  tool: string;
  startedAt: Date;
  lastActivityAt: Date;
  gitBranch: string | null;
  version: string | null;
  entrypoint: string | null;
  permissionMode: string | null;
  lastPrompt: string | null;
  summary: string | null;
}

function projectSessionRecord(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    projectCwdHash: row.projectCwdHash,
    tool: narrowTool(row.tool),
    startedAt: toIso(row.startedAt),
    lastActivityAt: toIso(row.lastActivityAt),
    gitBranch: row.gitBranch,
    version: row.version,
    entrypoint: row.entrypoint,
    permissionMode: row.permissionMode,
    lastPrompt: row.lastPrompt,
    summary: row.summary,
  };
}

export const sessionsByProjectRouter = new Hono().get(
  "/:cwdHash/sessions",
  async (c) => {
    const cwdHash = c.req.param("cwdHash");

    const rows = await prisma.session.findMany({
      where: { projectCwdHash: cwdHash },
      orderBy: { lastActivityAt: "desc" },
    });

    // Title third-tier fallback needs the first user message. We fetch
    // exactly one user message per session in a single follow-up query
    // (only for sessions where summary AND lastPrompt are both empty —
    // common case is they aren't, so usually this is a small set).
    const needsFirstUser = rows.filter(
      (r) =>
        (r.summary === null || r.summary.trim() === "") &&
        (r.lastPrompt === null || r.lastPrompt.trim() === "")
    );

    const firstUserBySessionId = new Map<string, string>();
    if (needsFirstUser.length > 0) {
      const firstUsers = await prisma.chatMessage.findMany({
        where: {
          sessionId: { in: needsFirstUser.map((r) => r.id) },
          role: "user",
        },
        orderBy: { timestamp: "asc" },
        select: { sessionId: true, content: true },
      });
      // Map first occurrence per session.
      for (const m of firstUsers) {
        if (!firstUserBySessionId.has(m.sessionId)) {
          firstUserBySessionId.set(m.sessionId, extractFirstText(m.content));
        }
      }
    }

    const items: SessionListItem[] = rows.map((row): SessionListItem => {
      const record = projectSessionRecord(row);
      const firstUserText = firstUserBySessionId.get(row.id) ?? "";
      return {
        ...record,
        title: deriveTitle(row.summary, row.lastPrompt, firstUserText),
      };
    });

    const body: SessionListResponse = { items };
    return c.json(body);
  }
);

export const sessionsRouter = new Hono()
  .get("/:id/messages", async (c) => {
    const id = c.req.param("id");
    const rows = await prisma.chatMessage.findMany({
      where: { sessionId: id },
      orderBy: { timestamp: "asc" },
    });
    const items: MessageRecord[] = rows.map((row): MessageRecord => ({
      id: row.uuid,
      sessionId: row.sessionId,
      parentUuid: row.parentUuid,
      tool: narrowTool(row.tool),
      role: narrowRole(row.role),
      content: row.content,
      isSidechain: row.isSidechain,
      timestamp: toIso(row.timestamp),
      raw: row.raw,
    }));
    const body: MessageListResponse = { items };
    return c.json(body);
  })
  .get("/:id/attachments", async (c) => {
    const id = c.req.param("id");
    const rows = await prisma.attachment.findMany({
      where: { sessionId: id },
      orderBy: { observedAt: "asc" },
    });
    const items: AttachmentRecord[] = rows.map((row): AttachmentRecord => ({
      id: row.id,
      sessionId: row.sessionId,
      tool: narrowTool(row.tool),
      type: row.type,
      payload: row.payload,
      relatedMessageUuid: row.relatedMessageUuid,
      timestamp: toIso(row.observedAt),
    }));
    const body: AttachmentListResponse = { items };
    return c.json(body);
  });
