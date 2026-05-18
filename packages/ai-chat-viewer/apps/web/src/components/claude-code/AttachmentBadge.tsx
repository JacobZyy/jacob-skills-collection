import { useState } from "react";

/**
 * Minimal shape of an attachment record consumed by this badge.
 *
 * We intentionally do NOT import @ai-chat-viewer/schema's AttachmentRecord
 * yet because the package's public entry point is still being defined
 * (worker-1 #6 / T08). Once the domain API is exported, swap this for the
 * canonical type. `payload` stays `unknown` here — we narrow at runtime
 * via guards below, matching the schema's intent.
 */
export interface AttachmentBadgeInput {
  type: string;
  payload: unknown;
}

interface HookPayloadView {
  event: string | null;
  durationMs: number | null;
  stdout: string | null;
  stderr: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  return typeof value === "string" ? value : null;
}

function readNumber(source: Record<string, unknown>, key: string): number | null {
  const value = source[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function narrowHookPayload(payload: unknown): HookPayloadView {
  if (!isRecord(payload)) {
    return { event: null, durationMs: null, stdout: null, stderr: null };
  }
  return {
    event: readString(payload, "event") ?? readString(payload, "hook_event_name"),
    durationMs: readNumber(payload, "durationMs") ?? readNumber(payload, "duration_ms"),
    stdout: readString(payload, "stdout"),
    stderr: readString(payload, "stderr"),
  };
}

function formatLabel(type: string, view: HookPayloadView): string {
  const parts: string[] = [type];
  if (view.event) parts.push(view.event);
  const head = parts.join(": ");
  return view.durationMs !== null ? `${head} (${view.durationMs}ms)` : head;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface AttachmentBadgeProps {
  attachment: AttachmentBadgeInput;
}

export function AttachmentBadge({ attachment }: AttachmentBadgeProps) {
  const [open, setOpen] = useState(false);
  const view = narrowHookPayload(attachment.payload);
  const label = formatLabel(attachment.type, view);
  const hasStdout = view.stdout !== null && view.stdout.length > 0;
  const hasStderr = view.stderr !== null && view.stderr.length > 0;
  const hasStreams = hasStdout || hasStderr;

  return (
    <div className="my-1 rounded-md border border-base-300 bg-base-200/40">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs text-base-content/80 hover:bg-base-300/60"
        aria-expanded={open}
      >
        <span aria-hidden="true">📎</span>
        <span className="font-mono">{label}</span>
        <span className="ml-auto text-base-content/40">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="border-t border-base-300 px-3 py-2 text-xs">
          {hasStreams ? (
            <>
              {hasStdout ? (
                <section className="mb-2">
                  <h4 className="mb-1 font-semibold text-base-content/70">stdout</h4>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-base-300/60 p-2 font-mono text-xs">
                    {view.stdout}
                  </pre>
                </section>
              ) : null}
              {hasStderr ? (
                <section>
                  <h4 className="mb-1 font-semibold text-error/80">stderr</h4>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-base-300/60 p-2 font-mono text-xs">
                    {view.stderr}
                  </pre>
                </section>
              ) : null}
            </>
          ) : (
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded bg-base-300/60 p-2 font-mono text-xs">
              {formatJson(attachment.payload)}
            </pre>
          )}
        </div>
      ) : null}
    </div>
  );
}
