import { Hono } from "hono";
import { ProjectRecordSchema } from "@ai-chat-viewer/schema";
import type { ProjectRecord } from "@ai-chat-viewer/schema";
import { z } from "zod";
import { prisma } from "../prisma";

// GET /api/projects — homepage list. Returns every Project we've observed,
// ordered by most-recent activity (AC-4 "most recently used" sort).
//
// Each element extends ProjectRecord with `sessionCount` so the homepage
// can render a "12 sessions" line without a second round-trip per row.
//
// Project.displayName is populated by the ingestion runner (T23 algorithm
// in packages/ingestion/util/display-name.ts). This route does NOT
// recompute it — the runner sees the global set when it writes, the
// server only reads. Doing it at write time means O(N) work once per
// project change instead of on every homepage hit.

export const ProjectListItemSchema = ProjectRecordSchema.extend({
  sessionCount: z.number().int().nonnegative(),
});
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;

export const ProjectListResponseSchema = z.object({
  items: z.array(ProjectListItemSchema),
});
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;

// Format a Date (Prisma) or string (already-serialized) as ISO-8601. Zod's
// ProjectRecord schema uses z.string() for timestamps — the API contract
// is stringly-timestamped, never raw Date.
function toIso(d: Date | string): string {
  return typeof d === "string" ? d : d.toISOString();
}

export const projectsRouter = new Hono().get("/", async (c) => {
  // Single roundtrip: Project rows + per-project session count via _count.
  const rows = await prisma.project.findMany({
    orderBy: { lastSeenAt: "desc" },
    include: { _count: { select: { sessions: true } } },
  });

  const items: ProjectListItem[] = rows.map((r): ProjectListItem => {
    const item: ProjectRecord & { sessionCount: number } = {
      cwdHash: r.cwdHash,
      cwd: r.cwd,
      displayName: r.displayName,
      lastSeenAt: toIso(r.lastSeenAt),
      firstSeenAt: toIso(r.firstSeenAt),
      sessionCount: r._count.sessions,
    };
    return item;
  });

  const body: ProjectListResponse = { items };
  return c.json(body);
});
