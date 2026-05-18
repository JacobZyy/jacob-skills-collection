import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { ClaudeCodeBlockSchema } from "@ai-chat-viewer/ingestion/adapters/claude-code/blocks";
import type { ClaudeCodeBlock } from "@ai-chat-viewer/ingestion/adapters/claude-code/blocks";
import type { MessageRecord } from "@ai-chat-viewer/schema";
import { useSessionMessages } from "../api/queries";
import { MessageRenderer } from "../components/claude-code/MessageRenderer";

export function SessionPage() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const { data, isLoading, isError, error } = useSessionMessages(sessionId ?? null);

  if (isLoading) {
    return <SessionPageSkeleton />;
  }

  if (isError) {
    return (
      <div role="alert" className="alert alert-error mx-auto max-w-3xl">
        <span>Failed to load session: {error.message}</span>
      </div>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-3xl py-16 text-center">
        <h2 className="text-lg font-semibold">No messages yet</h2>
        <p className="mt-2 text-sm text-base-content/60">
          This session has been indexed but contains no messages.
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-xl font-bold">Session</h1>
        <p className="text-sm text-base-content/60">{items.length} messages</p>
      </header>
      <ul className="space-y-4">
        {items.map((message) => (
          <li key={message.id}>
            <MessageItem message={message} />
          </li>
        ))}
      </ul>
    </main>
  );
}

function MessageItem({ message }: { message: MessageRecord }) {
  const blocks = useMemo(() => parseContent(message.content), [message.content]);

  const roleClass =
    message.role === "user"
      ? "badge-primary"
      : message.role === "assistant"
        ? "badge-secondary"
        : "badge-ghost";

  return (
    <div className="card card-compact card-bordered bg-base-100">
      <div className="card-body">
        <div className="flex items-center gap-2">
          <span className={`badge badge-sm ${roleClass}`}>{message.role}</span>
          <time
            className="text-xs text-base-content/50"
            dateTime={message.timestamp}
          >
            {formatTime(message.timestamp)}
          </time>
        </div>
        <div className="mt-2">
          {blocks.length > 0 ? (
            <MessageRenderer blocks={blocks} />
          ) : (
            <pre className="overflow-x-auto rounded bg-base-200 p-2 text-xs">
              {JSON.stringify(message.content, null, 2)}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// Parse MessageRecord.content into ClaudeCodeBlock[] when possible.
// The domain layer stores content as unknown; for claude-code it is
// typically an array of content blocks. If the shape doesn't match,
// we return [] and fall back to raw JSON rendering.
function parseContent(content: unknown): ClaudeCodeBlock[] {
  if (!Array.isArray(content)) return [];
  const result: ClaudeCodeBlock[] = [];
  for (const item of content) {
    const parsed = ClaudeCodeBlockSchema.safeParse(item);
    if (parsed.success) {
      result.push(parsed.data);
    } else {
      // One malformed block in the array — we drop it and continue.
      // The raw JSON fallback still shows the full content.
      return [];
    }
  }
  return result;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

function SessionPageSkeleton() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <div className="skeleton h-7 w-32" />
        <div className="skeleton mt-2 h-4 w-24" />
      </header>
      <ul className="space-y-4">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i}>
            <div className="card card-compact card-bordered bg-base-100">
              <div className="card-body gap-2">
                <div className="flex gap-2">
                  <div className="skeleton h-5 w-16" />
                  <div className="skeleton h-5 w-24" />
                </div>
                <div className="skeleton h-16 w-full" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
