import { useState } from "react";
import { Link } from "react-router-dom";
import type { SessionRecord } from "@ai-chat-viewer/schema";

// SessionListItem is a SessionRecord plus the server-derived `title`.
// We define it locally because the server does not export a sub-path for
// its route-level types (web depends on @ai-chat-viewer/server but only
// through the workspace link; route files are not in the package exports).
type SessionListItem = SessionRecord & { title: string };

interface SessionListProps {
  sessions: SessionListItem[];
  initialLimit?: number;
}

export function SessionList({ sessions, initialLimit = 5 }: SessionListProps) {
  const [expanded, setExpanded] = useState(false);

  const visible = expanded ? sessions : sessions.slice(0, initialLimit);
  const hasMore = sessions.length > initialLimit;

  return (
    <div className="space-y-3">
      <ul className="space-y-3">
        {visible.map((session) => (
          <li key={session.id}>
            <SessionCard session={session} />
          </li>
        ))}
      </ul>
      {hasMore && !expanded && (
        <button
          type="button"
          className="btn btn-ghost btn-sm w-full"
          onClick={() => setExpanded(true)}
        >
          View {sessions.length - initialLimit} more sessions
        </button>
      )}
    </div>
  );
}

interface SessionCardProps {
  session: SessionListItem;
}

function SessionCard({ session }: SessionCardProps) {
  return (
    <Link
      to={`/sessions/${session.id}`}
      className="card card-compact card-bordered bg-base-100 transition-shadow hover:shadow-md"
      aria-label={`Open session ${session.title}`}
    >
      <div className="card-body">
        <h3 className="card-title text-sm font-medium">{session.title}</h3>
        <div className="card-actions mt-1 items-center justify-end">
          <time
            className="text-xs text-base-content/50"
            dateTime={session.lastActivityAt}
            title={`Last activity: ${session.lastActivityAt}`}
          >
            {formatRelative(session.lastActivityAt)}
          </time>
        </div>
      </div>
    </Link>
  );
}

function formatRelative(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return iso;
  const deltaMs = Date.now() - then;
  if (deltaMs < 0) return iso;
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return iso.slice(0, 10);
}
