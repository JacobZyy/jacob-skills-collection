// Ingestion runner — catch-up + watcher (#16 T20).
//
// Two public entry points:
//
//   runIngestionCatchUp(prisma, adapter, log) : Promise<CatchUpResult>
//     Boot-time full scan. Streams every IngestionEvent the adapter yields,
//     groups by sessionId, flushes one prisma.$transaction([...]) per
//     session. fail-fast (MNC#3): any DB error rethrows so server boot can
//     process.exit(1). Returns event counters and wall-clock duration.
//
//   startIngestionWatcher(prisma, adapter, log) : { stop }
//     Post-catch-up tail loop. chokidar v4 watches detectRoot() for
//     add/change/unlink. Per change: stat() compare → truncate or normal
//     append → call adapter.tail() with the right offset, flush per-session
//     batch. log-and-continue (NEVER throws — tail-mode must not crash the
//     server).
//
// DI:
//   - `adapter` is the IngestionAdapter — runner mock-tests inject a fake
//     events generator here without touching disk.
//   - `log` is a single `(e: unknown) => void` callback wired by the caller
//     (index.ts) to fan out DropEvent payloads → logIngestionFailure() and
//     runner-internal errors → logger.error(). The runner does not know
//     about the two sinks; it just emits both kinds through the same hole.
//
// Why we reach for the lower-level scan/tailFile generators (subpath import
// from @ai-chat-viewer/ingestion/adapters/claude-code) instead of going
// through adapter.scan/adapter.tail directly: the IngestionAdapter contract
// does not thread ScanOptions/TailOptions through (scan(rootDir) signature),
// so we cannot pipe a DropLogger into parseLine via the adapter. The
// adapter object stays useful for detectRoot() and for tests that don't
// care about drop logging; production wiring uses the lower-level generators
// + the same DropEvent contract.
//
// Discipline (per team-lead's pinned constraints):
//   - per-session prisma.$transaction([...]) BATCH mode — NOT
//     prisma.$transaction(async tx => ...). Interactive mode opens a new
//     connection per call + N round-trips; AC-2 60s budget will blow.
//   - SessionMeta first-wins by earliest observedAt (per Session row)
//   - SessionMetaPatch last-wins per field (permissionMode / lastPrompt)
//   - Project upsert: catch-up collects all observed cwds, then a single
//     computeDisplayNames(cwds) batch produces the final displayName map,
//     then individual prisma.project.update() per row.
//   - Truncate detection (watcher): stat.size < lastByteOffset →
//     tail(file, 0) wholesale re-read; do NOT write a scanSingleFile helper.
//   - in-memory `Map<filePath, lastByteOffset>` — not persisted. On
//     restart the catch-up scan rebuilds it (AC-2 budget covers).
//   - Completion log marker MUST be exactly:
//       `[catch-up] complete: <N> events in <M>ms`
//     worker-1 #45 verify-ac2.ts greps this literal — any variant breaks it.
//   - SSE bus: every message/attachment/session/project mutation fires
//     through emitMessageAppended / emitAttachmentAppended /
//     emitSessionUpdated / emitProjectUpdated.
//
// Spec refs:
//   - .omc/plans/ai-chat-viewer-v1.md T20
//   - MNC#3 fail-fast for catch-up
//   - AC-2 catch-up p95 < 60s

import { readdirSync, statSync } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";

import chokidar, { type FSWatcher } from "chokidar";

import {
  claudeCodeAdapter,
  type DropEvent,
  scan as claudeCodeScan,
  tailFile as claudeCodeTailFile,
} from "@ai-chat-viewer/ingestion/adapters/claude-code";
import {
  computeCwdHash,
  computeDisplayNames,
  type IngestionAdapter,
  type IngestionEvent,
  type SessionMeta,
  type SessionMetaPatch,
} from "@ai-chat-viewer/ingestion";
import type { AttachmentRecord, MessageRecord } from "@ai-chat-viewer/schema";

import {
  emitAttachmentAppended,
  emitMessageAppended,
  emitProjectUpdated,
  emitSessionUpdated,
} from "../sse/bus";
import type { Prisma } from "../prisma";

/* -------------------------------------------------------------------------- */
/*                              Public types                                  */
/* -------------------------------------------------------------------------- */

export interface CatchUpResult {
  durationMs: number;
  projectCount: number;
  sessionCount: number;
  messageCount: number;
  attachmentCount: number;
}

export interface IngestionWatcherHandle {
  stop: () => Promise<void>;
}

/**
 * Sink for both adapter DropEvents (parse failures) and runner-internal
 * errors during tail mode. Wired by the caller (index.ts) to fan out by
 * shape — see file-header docstring.
 */
export type IngestionLogSink = (event: unknown) => void;

/* -------------------------------------------------------------------------- */
/*                          Per-session event buffer                          */
/* -------------------------------------------------------------------------- */

// During catch-up we group all events for the same sessionId so a single
// transaction commits them as a unit. Adapter events are ALREADY grouped
// session-by-session by scan.ts (it visits files one at a time), so we just
// flush whenever sessionId changes.
//
// Why an in-memory buffer rather than streaming-flush: per-message $transaction
// would be 100+ tx for one session and AC-2 60s budget would burn on
// fsync/WAL-checkpoint overhead. Batching cuts that to ~one tx per session
// file (V1 measured ~325 sessions, easily under budget).

interface SessionBuffer {
  sessionId: string;
  messages: MessageRecord[];
  attachments: AttachmentRecord[];
  // first-wins: keep the SessionMeta with the earliest observedAt seen so far.
  meta: SessionMeta | null;
  // last-wins per field (no observedAt on SessionMetaPatch; physical order
  // is the order they were appended to the source file).
  permissionMode: string | null;
  lastPrompt: string | null;
}

function emptyBuffer(sessionId: string): SessionBuffer {
  return {
    sessionId,
    messages: [],
    attachments: [],
    meta: null,
    permissionMode: null,
    lastPrompt: null,
  };
}

function applyEventToBuffer(buf: SessionBuffer, evt: IngestionEvent): void {
  switch (evt.kind) {
    case "message":
      buf.messages.push(evt.record);
      return;
    case "attachment":
      buf.attachments.push(evt.record);
      return;
    case "session-meta": {
      // First-wins: keep the one with the earliest observedAt. Ties resolve
      // by retaining the existing (already-seen-first) record.
      if (buf.meta === null || evt.record.observedAt < buf.meta.observedAt) {
        buf.meta = evt.record;
      }
      return;
    }
    case "session-meta-patch": {
      // Last-wins per field. Either field may be set independently.
      if (evt.patch.permissionMode !== undefined) {
        buf.permissionMode = evt.patch.permissionMode;
      }
      if (evt.patch.lastPrompt !== undefined) {
        buf.lastPrompt = evt.patch.lastPrompt;
      }
      return;
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                          Per-session flush                                 */
/* -------------------------------------------------------------------------- */

// Cwd index built incrementally during catch-up. We learn each session's cwd
// from its SessionMeta event, then at the end run computeDisplayNames over
// the deduped set in one batch. Project rows are upserted progressively
// (so partial progress is queryable mid-run); displayName gets a final pass.

interface ProjectIndex {
  // cwdHash → cwd, recorded as we see SessionMeta events.
  hashToCwd: Map<string, string>;
  // sessionId → cwdHash, so the watcher can hot-link new sessions to existing
  // Project rows without re-deriving the hash on every event.
  sessionToHash: Map<string, string>;
  // sessionId → lastActivityAt ISO, accumulated within this catch-up batch
  // and used to update Project.lastSeenAt without a follow-up read.
  hashToLastActivity: Map<string, string>;
}

function emptyProjectIndex(): ProjectIndex {
  return {
    hashToCwd: new Map(),
    sessionToHash: new Map(),
    hashToLastActivity: new Map(),
  };
}

/**
 * Flush one session's buffered events to the DB as a single prisma.$transaction
 * batch. After commit, fire the corresponding SSE emits.
 *
 * Returns the number of events committed (for the catch-up event counter).
 */
async function flushSession(
  prisma: Prisma,
  buf: SessionBuffer,
  projectIndex: ProjectIndex,
  mode: "catch-up" | "tail",
  log: IngestionLogSink,
): Promise<number> {
  // Compute session-level fields from the buffer. Some fields require the
  // session's first/last activity, which we derive from the message timeline.
  // Without messages we still want to write a Session row when a SessionMeta
  // is present (a session with only attachments), so we fall back to meta /
  // attachment timestamps.
  const firstActivityIso = pickFirstActivity(buf);
  const lastActivityIso = pickLastActivity(buf);
  const meta = buf.meta;

  if (firstActivityIso === null || lastActivityIso === null) {
    // No usable timestamp in the entire buffer — nothing to anchor the
    // Session row to. Skip (very rare; would only happen on a session whose
    // every line was a drop).
    return 0;
  }

  // Resolve cwd/cwdHash for the Session FK. SessionMeta is the canonical
  // carrier; if absent we cannot project this session. (claude-code stamps
  // cwd on every attachment line, so a sessionId with zero meta also has
  // zero attachments, which means an empty Session — skip.)
  if (meta === null) {
    // Defer this session: emit a warning through `log` and skip. Strictly
    // tail-mode-safe; in catch-up we still proceed for other sessions.
    log(
      new Error(
        `[runner] session ${buf.sessionId} has no SessionMeta — skipping (mode=${mode})`,
      ),
    );
    return 0;
  }

  const cwdHash = computeCwdHash(meta.cwd);
  projectIndex.hashToCwd.set(cwdHash, meta.cwd);
  projectIndex.sessionToHash.set(buf.sessionId, cwdHash);

  // Track lastSeenAt per project for the final Project pass. Take the
  // later of the existing and this session's lastActivityAt (string compare
  // works on ISO 8601).
  const prevLastSeen = projectIndex.hashToLastActivity.get(cwdHash);
  if (prevLastSeen === undefined || prevLastSeen < lastActivityIso) {
    projectIndex.hashToLastActivity.set(cwdHash, lastActivityIso);
  }

  // Build the Prisma batch.
  //
  // The Project row is upserted progressively (firstSeenAt = createMany-safe
  // value if new, otherwise unchanged; displayName seeded to a placeholder
  // and rewritten in the final pass). This way mid-run queries see a
  // populated Project.
  const projectUpsert = prisma.project.upsert({
    where: { cwdHash },
    create: {
      cwdHash,
      cwd: meta.cwd,
      // Seed displayName to basename — final disambiguation pass overwrites.
      displayName: meta.cwd.split("/").pop() ?? meta.cwd,
      firstSeenAt: new Date(firstActivityIso),
      lastSeenAt: new Date(lastActivityIso),
    },
    update: {
      // Never regress lastSeenAt; we know the buffered value is from this
      // session's tail edge but other sessions on the same project may have
      // newer activity. The final Project pass will take max() across all
      // sessions, so this update is intentionally optimistic — it's fine to
      // overwrite, the post-pass corrects.
      lastSeenAt: new Date(lastActivityIso),
    },
  });

  const sessionUpsert = prisma.session.upsert({
    where: { id: buf.sessionId },
    create: {
      id: buf.sessionId,
      projectCwdHash: cwdHash,
      tool: "claude-code",
      startedAt: new Date(firstActivityIso),
      lastActivityAt: new Date(lastActivityIso),
      gitBranch: meta.gitBranch,
      version: meta.version,
      entrypoint: meta.entrypoint,
      permissionMode: buf.permissionMode,
      lastPrompt: buf.lastPrompt,
      // summary is V1-future (no claude-code line carries it yet).
      summary: null,
    },
    update: {
      // first-wins for the metadata fields: only touch startedAt /
      // gitBranch / version / entrypoint if the row didn't have them.
      // Prisma update doesn't expose conditional COALESCE, so we read-
      // before-write would be a round-trip. Cheap pragmatic choice: trust
      // the in-memory first-wins reducer — by the time we reach `update`
      // we've already enforced earliest observedAt across this batch.
      lastActivityAt: new Date(lastActivityIso),
      gitBranch: meta.gitBranch,
      version: meta.version,
      entrypoint: meta.entrypoint,
      permissionMode: buf.permissionMode,
      lastPrompt: buf.lastPrompt,
    },
  });

  // Message upserts. Source rows are unique by uuid; if a previous run
  // already inserted this uuid we treat the existing row as authoritative
  // (an append-only JSONL never rewrites a uuid).
  const messageUpserts = buf.messages.map((m) =>
    prisma.chatMessage.upsert({
      where: { uuid: m.id },
      create: {
        uuid: m.id,
        sessionId: m.sessionId,
        tool: "claude-code",
        role: m.role,
        parentUuid: m.parentUuid,
        isSidechain: m.isSidechain,
        timestamp: new Date(m.timestamp),
        content: (m.content ?? {}) as Prisma extends never ? never : object,
        raw: (m.raw ?? m.content ?? {}) as Prisma extends never ? never : object,
      },
      update: {},
    }),
  );

  const attachmentUpserts = buf.attachments.map((a) =>
    prisma.attachment.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        sessionId: a.sessionId,
        tool: "claude-code",
        type: a.type,
        relatedMessageUuid: a.relatedMessageUuid,
        observedAt: new Date(a.timestamp),
        payload: (a.payload ?? {}) as Prisma extends never ? never : object,
      },
      update: {},
    }),
  );

  await prisma.$transaction([
    projectUpsert,
    sessionUpsert,
    ...messageUpserts,
    ...attachmentUpserts,
  ]);

  // Post-commit SSE fan-out. We emit per-row so the SSE client can paint
  // incremental UI; doing this AFTER $transaction guarantees subscribers
  // only see committed rows.
  for (const m of buf.messages) emitMessageAppended(m);
  for (const a of buf.attachments) emitAttachmentAppended(a);
  emitSessionUpdated(buf.sessionId, {
    sessionId: buf.sessionId,
    id: buf.sessionId,
    projectCwdHash: cwdHash,
    tool: "claude-code",
    startedAt: firstActivityIso,
    lastActivityAt: lastActivityIso,
    gitBranch: meta.gitBranch,
    version: meta.version,
    entrypoint: meta.entrypoint,
    permissionMode: buf.permissionMode ?? undefined,
    lastPrompt: buf.lastPrompt ?? undefined,
  });

  return buf.messages.length + buf.attachments.length + 1 /* meta */;
}

function pickFirstActivity(buf: SessionBuffer): string | null {
  let earliest: string | null = null;
  for (const m of buf.messages) {
    if (earliest === null || m.timestamp < earliest) earliest = m.timestamp;
  }
  for (const a of buf.attachments) {
    if (earliest === null || a.timestamp < earliest) earliest = a.timestamp;
  }
  if (buf.meta !== null) {
    if (earliest === null || buf.meta.observedAt < earliest) {
      earliest = buf.meta.observedAt;
    }
  }
  return earliest;
}

function pickLastActivity(buf: SessionBuffer): string | null {
  let latest: string | null = null;
  for (const m of buf.messages) {
    if (latest === null || m.timestamp > latest) latest = m.timestamp;
  }
  for (const a of buf.attachments) {
    if (latest === null || a.timestamp > latest) latest = a.timestamp;
  }
  if (buf.meta !== null) {
    if (latest === null || buf.meta.observedAt > latest) {
      latest = buf.meta.observedAt;
    }
  }
  return latest;
}

/* -------------------------------------------------------------------------- */
/*                          Final Project pass                                */
/* -------------------------------------------------------------------------- */

// After catch-up's per-session flushes have populated rough Project rows,
// run computeDisplayNames over the full cwd set so colliding basenames get
// disambiguated. Single batch — N projects → 1 helper call → N row updates.

async function finalizeProjectDisplayNames(
  prisma: Prisma,
  index: ProjectIndex,
  log: IngestionLogSink,
): Promise<void> {
  const cwds = Array.from(index.hashToCwd.values());
  if (cwds.length === 0) return;

  const names = computeDisplayNames(cwds);

  for (const [hash, cwd] of index.hashToCwd) {
    const displayName = names.get(cwd) ?? cwd;
    const lastSeenIso = index.hashToLastActivity.get(hash);
    try {
      const updated = await prisma.project.update({
        where: { cwdHash: hash },
        data: {
          displayName,
          // Take max(existing, this-batch) by skipping the update when no
          // newer activity arrived. We don't have the existing value here
          // without another read; instead unconditionally set to the
          // batch's tracked value — accurate because catch-up scans the
          // whole tree in one shot.
          ...(lastSeenIso === undefined
            ? {}
            : { lastSeenAt: new Date(lastSeenIso) }),
        },
      });
      emitProjectUpdated({
        cwdHash: updated.cwdHash,
        cwd: updated.cwd,
        displayName: updated.displayName,
        lastSeenAt: updated.lastSeenAt.toISOString(),
        firstSeenAt: updated.firstSeenAt.toISOString(),
      });
    } catch (err) {
      // Display-name pass is non-critical: the per-session flush already
      // wrote a workable Project row. Log and continue.
      log(err);
    }
  }
}

/* -------------------------------------------------------------------------- */
/*                          Public: runIngestionCatchUp                       */
/* -------------------------------------------------------------------------- */

export async function runIngestionCatchUp(
  prisma: Prisma,
  adapter: IngestionAdapter,
  log: IngestionLogSink,
): Promise<CatchUpResult> {
  const t0 = performance.now();

  const rootDir = adapter.detectRoot();
  const projectIndex = emptyProjectIndex();

  let currentSession: SessionBuffer | null = null;
  let projectCount = 0;
  let sessionCount = 0;
  let messageCount = 0;
  let attachmentCount = 0;
  let eventCount = 0;

  const seenSessions = new Set<string>();

  // Pull the lower-level generator when the injected adapter happens to be
  // the claudeCodeAdapter — that's the only way to thread `log` into
  // parseLine drops. For any other (mock) adapter we go through the
  // interface; mock adapters typically don't emit drops anyway.
  const eventSource: AsyncIterable<IngestionEvent> =
    adapter === claudeCodeAdapter
      ? claudeCodeScan(rootDir, { log: toDropLogger(log) })
      : adapter.scan(rootDir);

  for await (const evt of eventSource) {
    eventCount += 1;
    const sid = sessionIdFromEvent(evt);
    if (sid === null) continue;

    if (currentSession === null || currentSession.sessionId !== sid) {
      if (currentSession !== null) {
        const flushed = await flushSession(
          prisma,
          currentSession,
          projectIndex,
          "catch-up",
          log,
        );
        if (flushed > 0) {
          sessionCount += 1;
          messageCount += currentSession.messages.length;
          attachmentCount += currentSession.attachments.length;
        }
      }
      currentSession = emptyBuffer(sid);
      seenSessions.add(sid);
    }

    applyEventToBuffer(currentSession, evt);
  }

  if (currentSession !== null) {
    const flushed = await flushSession(
      prisma,
      currentSession,
      projectIndex,
      "catch-up",
      log,
    );
    if (flushed > 0) {
      sessionCount += 1;
      messageCount += currentSession.messages.length;
      attachmentCount += currentSession.attachments.length;
    }
  }

  // Final Project disambiguation pass.
  await finalizeProjectDisplayNames(prisma, projectIndex, log);
  projectCount = projectIndex.hashToCwd.size;

  // Mark IngestionSource heartbeat — non-critical, soft-fail on error.
  try {
    await prisma.ingestionSource.upsert({
      where: { tool: "claude-code" },
      create: {
        tool: "claude-code",
        rootPath: rootDir,
        lastScannedAt: new Date(),
      },
      update: {
        rootPath: rootDir,
        lastScannedAt: new Date(),
      },
    });
  } catch (err) {
    log(err);
  }

  const durationMs = Math.round(performance.now() - t0);

  // STRICT marker — worker-1 #45 verify-ac2.ts greps this exact pattern.
  // Do NOT change "complete: <N> events in <M>ms".
  console.log(`[catch-up] complete: ${eventCount} events in ${durationMs}ms`);

  return {
    durationMs,
    projectCount,
    sessionCount,
    messageCount,
    attachmentCount,
  };
}

/* -------------------------------------------------------------------------- */
/*                          Public: startIngestionWatcher                     */
/* -------------------------------------------------------------------------- */

export async function startIngestionWatcher(
  prisma: Prisma,
  adapter: IngestionAdapter,
  log: IngestionLogSink,
): Promise<IngestionWatcherHandle> {
  const rootDir = adapter.detectRoot();
  // in-memory cursor — never persisted. On restart catch-up rebuilds it.
  const cursors = new Map<string, number>();
  // serialize per-file work so chokidar burst events don't double-tail
  // (chokidar does coalesce but a single file_added followed by file_changed
  // can still race the in-memory cursor).
  const inflight = new Map<string, Promise<void>>();

  // chokidar v4 dropped glob support. We MUST NOT use the `ignored`
  // predicate when `usePolling` is false on macOS — fsevents silently drops
  // change events for files that match the filter (observed 2026-05-11 on
  // chokidar 4.0.3 / macOS 15 / Bun 1.3.11). Instead we watch the root
  // unfiltered and gate in the event callbacks.
  const watcher: FSWatcher = chokidar.watch(rootDir, {
    persistent: true,
    ignoreInitial: true,
    awaitWriteFinish: false,
  });

  const handleChange = (filePath: string): void => {
    console.log(`[watcher] raw event: ${filePath}`);
    // Gate: only *.jsonl session files.
    if (!filePath.endsWith(".jsonl")) {
      console.log(`[watcher] filtered (not .jsonl): ${filePath}`);
      return;
    }
    // chain onto any inflight work for this path. Per-file serialization
    // is enough — different files run in parallel.
    const prev = inflight.get(filePath) ?? Promise.resolve();
    const next = prev.then(() => processFile(filePath).catch((err) => log(err)));
    inflight.set(filePath, next);
  };

  const processFile = async (filePath: string): Promise<void> => {
    let fileSize: number;
    try {
      const s = await stat(filePath);
      fileSize = s.size;
    } catch (err) {
      // file vanished mid-handling — drop silently. unlink path will reset
      // the cursor.
      log(err);
      return;
    }

    const prevCursor = cursors.get(filePath) ?? 0;
    console.log(`[tail] ${filePath} prevCursor=${prevCursor} fileSize=${fileSize}`);
    let fromOffset = prevCursor;
    // truncate detection: file shrank below the cursor → re-read whole file
    if (fileSize < prevCursor) fromOffset = 0;
    if (fileSize === fromOffset) return; // no new bytes

    // Use the lower-level tailFile when we're driving the claude-code
    // adapter so DropEvents flow through `log`. For mock adapters fall
    // back to adapter.tail (no log threading available, but mocks
    // typically don't emit drops).
    const events =
      adapter === claudeCodeAdapter
        ? claudeCodeTailFile(filePath, fromOffset, { log: toDropLogger(log) })
        : adapter.tail(filePath, fromOffset);

    const buffersBySession = new Map<string, SessionBuffer>();
    let lastOffsetSeen = fromOffset;
    const projectIndex = emptyProjectIndex();
    let eventCount = 0;

    try {
      for await (const evt of events) {
        eventCount++;
        const sid = sessionIdFromEvent(evt);
        if (sid === null) continue;
        let buf = buffersBySession.get(sid);
        if (buf === undefined) {
          buf = emptyBuffer(sid);
          buffersBySession.set(sid, buf);
        }
        applyEventToBuffer(buf, evt);
        lastOffsetSeen = evt.sourceOffset;
      }
    } catch (err) {
      // Tail-mode per-event errors must not crash the watcher.
      log(err);
    }

    // Flush each session buffer independently. Per-session try/catch so
    // one bad session does not block the others.
    for (const buf of buffersBySession.values()) {
      try {
        await flushSession(prisma, buf, projectIndex, "tail", log);
      } catch (err) {
        log(err);
      }
    }

    // Re-run displayName pass when new projects came in — cheap (<1ms per
    // call for V1 project counts).
    if (projectIndex.hashToCwd.size > 0) {
      await finalizeProjectDisplayNames(prisma, projectIndex, log).catch((err) =>
        log(err),
      );
    }

    // Advance cursor. Use the largest sourceOffset we observed; fall back
    // to fileSize when the tail yielded nothing (e.g. all lines were drops).
    const newCursor = Math.max(lastOffsetSeen, fromOffset);
    const cursorToSet =
      newCursor > fromOffset
        ? newCursor
        : fileSize > fromOffset
          ? fileSize
          : fromOffset;
    cursors.set(filePath, cursorToSet);
    console.log(`[tail] ${filePath} cursor advanced: ${prevCursor} → ${cursorToSet}`);
  };

  watcher.on("add", handleChange);
  watcher.on("change", handleChange);
  watcher.on("unlink", (filePath: string) => {
    cursors.delete(filePath);
  });
  watcher.on("error", (err: unknown) => log(err));

  // Seed cursors so tail starts at the current file size, not 0. Without this
  // every change event would re-read the entire file from the beginning,
  // re-emitting thousands of old messages and burning the AC-3 budget.
  // We walk the filesystem once (catch-up already did the heavy parse work;
  // this is just stat() calls).
  try {
    const projects = readdirSync(rootDir);
    for (const project of projects) {
      const projectDir = join(rootDir, project);
      let entries: string[];
      try {
        entries = readdirSync(projectDir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        if (!entry.endsWith(".jsonl")) continue;
        const filePath = join(projectDir, entry);
        try {
          const s = statSync(filePath);
          if (s.isFile()) {
            cursors.set(filePath, s.size);
          }
        } catch {
          // vanished between readdir and stat — ignore
        }
      }
    }
  } catch {
    // rootDir missing — ignore, watcher will report its own error
  }

  // Wait for chokidar's initial scan to complete before returning.
  // On macOS with many files the 'ready' event can fire *after* the first
  // 'change' would have been dropped, so we gate the caller here.
  await new Promise<void>((resolve) => watcher.once("ready", resolve));

  return {
    async stop(): Promise<void> {
      // Wait for in-flight work to drain before closing — prevents test
      // teardown from observing partial writes.
      await Promise.allSettled(Array.from(inflight.values()));
      await watcher.close();
    },
  };
}

/* -------------------------------------------------------------------------- */
/*                              Helpers                                        */
/* -------------------------------------------------------------------------- */

function sessionIdFromEvent(evt: IngestionEvent): string | null {
  switch (evt.kind) {
    case "message":
      return evt.record.sessionId;
    case "attachment":
      return evt.record.sessionId;
    case "session-meta":
      return evt.record.sessionId;
    case "session-meta-patch":
      return evt.patch.sessionId;
  }
}

// Bridge: the runner accepts a single (e: unknown) => void sink, but
// parseLine wants a DropLogger ((event: DropEvent) => void). DropEvent is a
// structurally-shaped object — feeding it through the unknown sink is
// shape-preserving, so the caller can fan out by shape on the receiving end
// (index.ts's logFanOut).
function toDropLogger(sink: IngestionLogSink): (event: DropEvent) => void {
  return (event: DropEvent) => sink(event);
}

/* -------------------------------------------------------------------------- */
/*                          Test-only internals                               */
/* -------------------------------------------------------------------------- */

// Whitebox handles for unit tests. NOT part of the public surface — runner
// consumers (index.ts, future tools) must NOT import this. Naming reflects
// that: leading underscore, suffix "ForTest". The team-lead-pinned public
// contract is the two functions above; everything else is internal.
export const _internalsForTest = {
  emptyBuffer,
  applyEventToBuffer,
  pickFirstActivity,
  pickLastActivity,
  sessionIdFromEvent,
  toDropLogger,
};
export type { SessionBuffer };
