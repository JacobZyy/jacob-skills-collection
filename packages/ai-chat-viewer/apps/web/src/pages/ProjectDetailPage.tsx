import { useParams } from "react-router-dom";
import { useSessions } from "../api/queries";
import { SessionList } from "../components/SessionList";

export function ProjectDetailPage() {
  const { cwdHash } = useParams<{ cwdHash: string }>();
  const { data, isLoading, isError, error } = useSessions(cwdHash ?? null);

  if (isLoading) {
    return <ProjectDetailSkeleton />;
  }

  if (isError) {
    return (
      <div role="alert" className="alert alert-error mx-auto max-w-2xl">
        <span>Failed to load sessions: {error.message}</span>
      </div>
    );
  }

  const items = data?.items ?? [];

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl py-16 text-center">
        <h2 className="text-lg font-semibold">No sessions yet</h2>
        <p className="mt-2 text-sm text-base-content/60">
          This project has been indexed but no sessions have been recorded.
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-bold">Sessions</h1>
        <p className="text-sm text-base-content/60">
          {items.length} {items.length === 1 ? "session" : "sessions"} total
        </p>
      </header>
      <SessionList sessions={items} />
    </main>
  );
}

function ProjectDetailSkeleton() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-8">
      <header className="mb-6">
        <div className="skeleton h-8 w-32" />
        <div className="skeleton mt-2 h-4 w-48" />
      </header>
      <ul className="space-y-3">
        {Array.from({ length: 5 }, (_, i) => (
          <li key={i}>
            <div className="card card-compact card-bordered bg-base-100">
              <div className="card-body gap-2">
                <div className="skeleton h-5 w-3/4" />
                <div className="skeleton h-4 w-20" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
