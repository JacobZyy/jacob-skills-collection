import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

// Per spec (deep-interview Q2): the DB lives under the user-level Apple
// standard "Application Support" dir, not under the project's cwd, because
// ai-chat-viewer is a single global tool that aggregates every project's
// claude-code history into one DB. Tauri's `app_data_dir()` resolves to the
// same path on macOS, so a future desktop bundle reuses this location.
//
// macOS only in V1 (per spec "Platform: 主开发平台 macOS"). Other platforms
// fall back to homedir-relative; resolveDbPath does not assert macOS.
const APP_DIR_NAME = "ai-chat-viewer";
const DB_FILE_NAME = "db.sqlite";
const APPLE_APP_SUPPORT = ["Library", "Application Support"] as const;

export interface ResolveDbPathOptions {
  // Override homedir for tests. Real callers omit this.
  home?: string;
}

// Returns the absolute filesystem path to the SQLite DB file.
// Path may contain spaces (e.g. "/Users/foo/Library/Application Support/...")
// — callers MUST encode the path before embedding it in a URL.
export function resolveDbPath(options: ResolveDbPathOptions = {}): string {
  const home = options.home ?? homedir();
  return join(home, ...APPLE_APP_SUPPORT, APP_DIR_NAME, DB_FILE_NAME);
}

// Ensure the parent directory of the DB file exists. Idempotent.
// Throws if the path exists as a file, or if mkdir fails for any reason
// other than EEXIST. Server boot expects a thrown error to be fatal so the
// migrate-deploy step (T19) can surface a clear failure.
export function ensureDbDir(dbPath: string): void {
  const dir = dirname(dbPath);
  mkdirSync(dir, { recursive: true });
}

// Build the value Prisma's `url = env("DATABASE_URL")` will read.
// Critical: the DB path contains spaces; SQLite's file: URL is parsed as a
// URL by Prisma, and an unencoded space breaks parsing. encodeURI preserves
// '/' and ':' (path-significant) while percent-encoding spaces and other
// reserved characters that may appear in localized home dirs.
export function buildDatabaseUrl(dbPath: string): string {
  return `file:${encodeURI(dbPath)}`;
}

// Resolve, ensure, and inject DATABASE_URL into process.env. Returns the
// resolved absolute path so callers can log it. Idempotent — safe to call
// from server boot before any Prisma client is instantiated.
//
// Why mutate process.env: Prisma reads DATABASE_URL at construction time
// from the ambient env, and we don't want to require the user to export it
// before `bun dev`. This is the single sanctioned mutation point.
export function injectDatabaseUrl(options: ResolveDbPathOptions = {}): string {
  const dbPath = resolveDbPath(options);
  ensureDbDir(dbPath);
  process.env["DATABASE_URL"] = buildDatabaseUrl(dbPath);
  return dbPath;
}
