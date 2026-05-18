import { useProjects } from "../api/queries";
import { ProjectCard } from "../components/ProjectCard";

// ProjectsPage — the homepage. Renders every project the runner has seen,
// already sorted by `lastSeenAt DESC` server-side (apps/server/src/routes/
// projects.ts). The page itself does no extra sorting; the server contract
// is "newest first" and we trust it.
//
// AC-4 requires <1s render after first hit. TanStack Query's staleTime
// (T30, 30s) keeps the second visit instant — back-nav from a project
// detail page reuses the cached array without a network round-trip.
//
// We intentionally do NOT add an in-page search/filter input here. V1
// scope is "list and click"; filtering can ride on top once #38 starts
// streaming Project upserts via SSE.
export function ProjectsPage() {
  const { data, isLoading, isError, error } = useProjects();

  if (isLoading) {
    return <ProjectsSkeleton />;
  }

  if (isError) {
    // Error path is intentionally minimal — #43 (T41 ErrorBoundary) will
    // wrap the route tree and provide a richer surface. Until then, an
    // inline alert is enough to differentiate "request failed" from
    // "no projects yet".
    return (
      <div role="alert" className="alert alert-error mx-auto max-w-2xl">
        <span>Failed to load projects: {error.message}</span>
      </div>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <h2 className="text-lg font-semibold">No projects indexed yet</h2>
        <p className="mt-2 text-sm text-base-content/60">
          The ingestion runner watches <code>~/.claude/projects/</code>. Once
          a Claude Code session writes a transcript there, it will show up
          on this page automatically.
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Projects</h1>
        <p className="text-sm text-base-content/60">
          {items.length} {items.length === 1 ? "project" : "projects"} indexed
        </p>
      </header>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {items.map((project) => (
          <li key={project.cwdHash}>
            <ProjectCard project={project} />
          </li>
        ))}
      </ul>
    </main>
  );
}

// Skeleton mirrors the real grid (3 columns at lg) so the layout doesn't
// shift on data arrival — daisyUI `skeleton` provides the shimmer. We
// render six placeholders: enough to fill the viewport on a 1440-wide
// screen without overpromising what the data set looks like.
function ProjectsSkeleton() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-8">
      <header className="mb-6">
        <div className="skeleton h-8 w-32" />
        <div className="skeleton mt-2 h-4 w-48" />
      </header>
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <li key={i}>
            <div className="card card-compact card-bordered bg-base-100">
              <div className="card-body gap-2">
                <div className="skeleton h-5 w-3/4" />
                <div className="skeleton h-3 w-full" />
                <div className="skeleton h-4 w-20" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
