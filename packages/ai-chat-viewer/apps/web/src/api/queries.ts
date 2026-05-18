import { useQuery } from "@tanstack/react-query";
import { rpc } from "./rpc-client";

// TanStack Query hooks wrapping the Hono RPC client. Every response shape is
// inferred from AppType — there are no hand-typed DTOs. If the server's Zod
// schema changes, the hook's return type changes too, and downstream
// consumers get a compile-time signal instead of a runtime surprise.
//
// All non-200 responses throw, so consumers can rely on `data` being the
// success shape. We propagate `res.status` in the message so the
// ErrorBoundary path (T41) can surface something meaningful, but the body
// is not parsed for error details (V1 hard-pin: the server only emits
// either 200-with-Zod-body or 5xx-with-text).

export const queryKeys = {
  projects: () => ["projects"] as const,
  sessions: (cwdHash: string) => ["sessions", cwdHash] as const,
  sessionMessages: (id: string) => ["sessionMessages", id] as const,
  sessionAttachments: (id: string) => ["sessionAttachments", id] as const,
};

export function useProjects() {
  return useQuery({
    queryKey: queryKeys.projects(),
    queryFn: async () => {
      const res = await rpc.api.projects.$get();
      if (!res.ok) throw new Error(`[useProjects] HTTP ${res.status}`);
      return res.json();
    },
  });
}

export function useSessions(cwdHash: string | null) {
  return useQuery({
    // Stable disabled-key: when cwdHash is null the query is `enabled: false`
    // and the queryFn never runs, but TanStack still requires a queryKey;
    // using a sentinel keeps the cache slot distinct from any real hash.
    queryKey: cwdHash ? queryKeys.sessions(cwdHash) : (["sessions", "<none>"] as const),
    enabled: cwdHash !== null,
    queryFn: async () => {
      if (cwdHash === null) {
        throw new Error("[useSessions] queryFn invoked with null cwdHash");
      }
      const res = await rpc.api.projects[":cwdHash"].sessions.$get({
        param: { cwdHash },
      });
      if (!res.ok) throw new Error(`[useSessions] HTTP ${res.status}`);
      return res.json();
    },
  });
}

export function useSessionMessages(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.sessionMessages(id) : (["sessionMessages", "<none>"] as const),
    enabled: id !== null,
    queryFn: async () => {
      if (id === null) {
        throw new Error("[useSessionMessages] queryFn invoked with null id");
      }
      const res = await rpc.api.sessions[":id"].messages.$get({
        param: { id },
      });
      if (!res.ok) throw new Error(`[useSessionMessages] HTTP ${res.status}`);
      return res.json();
    },
  });
}

export function useSessionAttachments(id: string | null) {
  return useQuery({
    queryKey: id ? queryKeys.sessionAttachments(id) : (["sessionAttachments", "<none>"] as const),
    enabled: id !== null,
    queryFn: async () => {
      if (id === null) {
        throw new Error("[useSessionAttachments] queryFn invoked with null id");
      }
      const res = await rpc.api.sessions[":id"].attachments.$get({
        param: { id },
      });
      if (!res.ok) throw new Error(`[useSessionAttachments] HTTP ${res.status}`);
      return res.json();
    },
  });
}
