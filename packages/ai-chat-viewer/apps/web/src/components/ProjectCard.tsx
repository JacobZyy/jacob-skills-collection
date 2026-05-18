import { Link } from "react-router-dom";
import type { InferResponseType } from "hono/client";
import { rpc } from "../api/rpc-client";

// `ProjectListItem` is reconstructed from AppType so this component does not
// depend on `@ai-chat-viewer/schema` directly. Why: the server's Zod schema
// is what the client treats as authoritative; pulling AppType keeps
// component prop shapes in lock-step with whatever the server returns even
// if `ProjectListItemSchema` ever moves or its fields rename.
type ProjectsResp = InferResponseType<typeof rpc.api.projects.$get>;
export type ProjectCardItem = ProjectsResp["items"][number];

interface ProjectCardProps {
  project: ProjectCardItem;
}

export function ProjectCard({ project }: ProjectCardProps) {
  // daisyUI tooltip wraps the entire card so hovering anywhere reveals the
  // full cwd. We deliberately do NOT use the native `title` attribute alone
  // because it has unpredictable timing on macOS Safari — daisyUI renders
  // a deterministic CSS tooltip.
  return (
    <Link
      to={`/projects/${project.cwdHash}`}
      className="tooltip tooltip-bottom"
      data-tip={project.cwd}
      aria-label={`Open project ${project.displayName} (${project.cwd})`}
    >
      <div className="card card-compact card-bordered bg-base-100 transition-shadow hover:shadow-md">
        <div className="card-body">
          <h2 className="card-title text-base font-semibold">
            {project.displayName}
          </h2>
          <p className="line-clamp-1 text-xs text-base-content/60">
            {project.cwd}
          </p>
          <div className="card-actions mt-1 items-center justify-between">
            <span className="badge badge-ghost badge-sm">
              {project.sessionCount}{" "}
              {project.sessionCount === 1 ? "session" : "sessions"}
            </span>
            <time
              className="text-xs text-base-content/50"
              dateTime={project.lastSeenAt}
              title={`Last activity: ${project.lastSeenAt}`}
            >
              {formatRelative(project.lastSeenAt)}
            </time>
          </div>
        </div>
      </div>
    </Link>
  );
}

// Lightweight relative-time formatter: spec doesn't pin a copy library, and
// pulling date-fns in for one helper would dwarf the call site. We render
// "just now" / "5m" / "3h" / "2d" / "ISO date" — granularities chosen to
// match how the homepage's lastSeenAt actually drifts (most projects refresh
// inside a working day). When the gap exceeds a week we fall back to the
// raw ISO date so the UI never lies about staleness.
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
