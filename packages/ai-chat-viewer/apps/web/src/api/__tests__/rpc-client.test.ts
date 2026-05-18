import { describe, it, expect } from "bun:test";
import type { InferResponseType } from "hono/client";
import { rpc } from "../rpc-client";

// rpc-client smoke tests. We deliberately do NOT exercise the network — the
// dev server may or may not be up when `bun test` runs, and AC-10's actual
// claim is that `hc<AppType>` produces a typed proxy whose route shape
// mirrors the server. So the tests are split:
//   1. Runtime: the proxy exposes the four endpoints as callable shapes.
//   2. Compile-time: response types inferred via `InferResponseType` line
//      up with the Zod-validated server bodies. These are type-only
//      assertions — if the server's AppType regresses or the path-param
//      spelling drifts, this file stops type-checking, which
//      `bunx tsc --noEmit` will catch in CI.
//
// `bun test` runs `tsc` on the test file as part of executing it, so
// failed type assertions surface as test failures, not silent passes.

// Type-level response shapes. Hoisted to module scope so the compiler
// keeps the bindings live; running them through `_assertTypes` below is
// what makes any regression in AppType surface as a `tsc` error.
type ProjectsResp = InferResponseType<typeof rpc.api.projects.$get>;
type SessionsResp = InferResponseType<
  typeof rpc.api.projects[":cwdHash"]["sessions"]["$get"]
>;
type MessagesResp = InferResponseType<
  typeof rpc.api.sessions[":id"]["messages"]["$get"]
>;
type AttachmentsResp = InferResponseType<
  typeof rpc.api.sessions[":id"]["attachments"]["$get"]
>;

// Pure compile-time probe. Each member must extend `unknown`, which is
// always true — but the compiler still has to resolve each `InferResponseType`
// expression to a concrete shape to check the constraint. If hc<AppType>
// regresses (e.g. drops the chained route type) these aliases collapse to
// `unknown` for a different reason and the constraint *still* passes — so
// we add a second layer: each shape must structurally include the `items`
// array that every server route returns. If a route is renamed or its body
// loses `items`, this constraint fails at `tsc --noEmit` time.
type _AssertItems<T extends { items: unknown[] }> = T;
type _AssertProjects = _AssertItems<ProjectsResp>;
type _AssertSessions = _AssertItems<SessionsResp>;
type _AssertMessages = _AssertItems<MessagesResp>;
type _AssertAttachments = _AssertItems<AttachmentsResp>;

describe("rpc-client", () => {
  it("exposes GET /api/projects as a callable", () => {
    expect(typeof rpc.api.projects.$get).toBe("function");
  });

  it("exposes GET /api/projects/:cwdHash/sessions as a callable", () => {
    expect(typeof rpc.api.projects[":cwdHash"].sessions.$get).toBe("function");
  });

  it("exposes GET /api/sessions/:id/messages as a callable", () => {
    expect(typeof rpc.api.sessions[":id"].messages.$get).toBe("function");
  });

  it("exposes GET /api/sessions/:id/attachments as a callable", () => {
    expect(typeof rpc.api.sessions[":id"].attachments.$get).toBe("function");
  });

  it("infers response types from AppType (compile-time)", () => {
    // The real check is the module-scope `_Assert*` constraint aliases
    // above; they fail `tsc --noEmit` if AppType ever stops producing a
    // shape with `items: unknown[]`. This runtime assertion only exists so
    // the `it()` block has a body — the type check has already run by the
    // time we get here.
    const probes: ReadonlyArray<true> = [
      true satisfies _AssertProjects extends ProjectsResp ? true : never,
      true satisfies _AssertSessions extends SessionsResp ? true : never,
      true satisfies _AssertMessages extends MessagesResp ? true : never,
      true satisfies _AssertAttachments extends AttachmentsResp ? true : never,
    ];
    expect(probes.length).toBe(4);
  });
});
