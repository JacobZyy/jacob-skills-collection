#!/usr/bin/env bun
// scripts/dev.ts — bun dev 双启 web + server。
//
// 问题：server catch-up 会产生数十万行 stderr（unsupported-line-type-v1 drop
// 事件），直接淹没终端且使 Vite HMR 信息不可读。
//
// 方案：server 的 stdout/stderr 写入 rolling log file；web(Vite) 输出保留在
// 终端。SIGINT 时优雅关闭两者。

import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const LOG_DIR = join(ROOT, ".log");

// Ensure log directory exists
mkdirSync(LOG_DIR, { recursive: true });

const serverLog = Bun.file(join(LOG_DIR, "server-dev.log"));
const serverLogWriter = serverLog.writer();

function log(label: string, msg: string): void {
  const ts = new Date().toISOString();
  const line = `[${ts}] [${label}] ${msg}\n`;
  // eslint-disable-next-line no-console
  console.log(line.trimEnd());
}

let serverProc: ChildProcess | null = null;
let webProc: ChildProcess | null = null;
let shuttingDown = false;

function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  log("dev", `received ${signal}, shutting down...`);

  const kills: Promise<void>[] = [];

  for (const [name, proc] of [
    ["server", serverProc],
    ["web", webProc],
  ] as const) {
    if (proc && !proc.killed) {
      proc.kill(signal);
      kills.push(
        new Promise((resolve) => {
          const timer = setTimeout(() => {
            if (!proc.killed) proc.kill("SIGKILL");
            resolve();
          }, 3000);
          proc.once("exit", () => {
            clearTimeout(timer);
            resolve();
          });
        })
      );
    }
  }

  Promise.all(kills).then(() => {
    serverLogWriter.end();
    process.exit(0);
  });
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

// ---------------------------------------------------------------------------
// Server — 日志写入文件，重要行（boot complete / listening / FATAL）同时打
// 到终端方便用户知道何时可以打开浏览器。
// ---------------------------------------------------------------------------
serverProc = spawn("bun", ["run", "--watch", "src/index.ts"], {
  cwd: join(ROOT, "apps", "server"),
  stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env },
});

const serverPipe = (buf: Buffer, source: "out" | "err"): void => {
  const text = buf.toString("utf8");
  serverLogWriter.write(text);

  // Tee 关键行到终端
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (
      trimmed.startsWith("[boot]") ||
      trimmed.startsWith("[catch-up]") ||
      trimmed.startsWith("[ingestion]") ||
      trimmed.toLowerCase().includes("fatal") ||
      trimmed.toLowerCase().includes("error")
    ) {
      log("server", trimmed);
    }
  }
};

serverProc.stdout?.on("data", (buf: Buffer) => serverPipe(buf, "out"));
serverProc.stderr?.on("data", (buf: Buffer) => serverPipe(buf, "err"));

serverProc.once("exit", (code) => {
  if (!shuttingDown) {
    log("server", `exited unexpectedly (code=${code ?? "null"})`);
    shutdown("SIGTERM");
  }
});

// ---------------------------------------------------------------------------
// Web (Vite) — 直接继承终端 stdio，用户可看到 HMR 和构建信息。
// ---------------------------------------------------------------------------
webProc = spawn("bun", ["run", "vite"], {
  cwd: join(ROOT, "apps", "web"),
  stdio: "inherit",
  env: { ...process.env },
});

webProc.once("exit", (code) => {
  if (!shuttingDown) {
    log("web", `exited unexpectedly (code=${code ?? "null"})`);
    shutdown("SIGTERM");
  }
});

log("dev", "starting server + web (logs → .log/server-dev.log)");
