// AppType is the type-level surface that worker-web's Hono RPC client
// (`hc<AppType>(...)`) consumes to derive endpoint signatures, path params,
// and response shapes — all with zero runtime cost.
//
// Why this re-export file exists separately from app.ts:
//   - apps/web depends only on the *type* of the server, never its runtime.
//     Importing from "@ai-chat-viewer/server" pulls in Hono, Prisma, the
//     boot sequence, etc., which is wrong for a frontend bundle.
//   - This file imports only the type, so a `import type { AppType }` from
//     the web side erases entirely at compile time. No runtime coupling.
//   - The spec (T27) names this exact path; keep it as the contract.
//
// AC-9 (cross-package type reuse): Because routes return Zod-validated
// shapes via `c.json(body)` where `body` is typed via `z.infer<...>`, those
// shapes flow through AppType into the web client without redeclaration.
// If a server schema changes, the web client gets a compile error.

export type { AppType } from "../app";
