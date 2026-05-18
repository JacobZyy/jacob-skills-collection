/**
 * Claude Code Stop hook: 用本机用户级 oxlint 拦截类型偷懒断言。
 *
 * 仅 lint 本会话 Edit/Write/MultiEdit 触达的 .ts/.tsx/.mts/.cts 文件。
 * 规则文件: ~/.config/oxlint/oxlintrc.json （与项目级 eslint 完全解耦）
 * 设计文档: ~/.omc/specs/deep-interview-oxlint-stop-hook.md
 *
 * 输出协议（参考 zzfe post-stop-gen-tests.js）：
 *   stdout 写一行 JSON：{ systemMessage, decision?, reason? }
 *     - systemMessage   UI 渲染成 "L Stop says: ..."
 *     - decision=block  阻断 Stop
 *     - reason          阻断时塞回 Claude 上下文的指令
 *   进程 exit 0。
 */

/// <reference types="bun-types" />

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';

interface StopHookInput {
  transcript_path?: string;
  stop_hook_active?: boolean;
}

interface HookResponse {
  systemMessage: string;
  decision?: 'block';
  reason?: string;
}

interface TranscriptAssistantContent {
  type: string;
  name?: string;
  input?: { file_path?: string };
}

interface TranscriptLine {
  type?: string;
  message?: {
    content?: TranscriptAssistantContent[];
  };
}

interface OxlintConfig {
  ignorePatterns?: string[];
}

const TS_EXTENSIONS = /\.(ts|tsx|mts|cts)$/;
const OXLINT_CFG = join(homedir(), '.config', 'oxlint', 'oxlintrc.json');

// ── 输出辅助 ───────────────────────────────────────────────────────────────
function emit(resp: HookResponse): never {
  process.stdout.write(`${JSON.stringify(resp)}\n`);
  process.exit(0);
}

function silentExit(): never {
  process.exit(0);
}

// ── 主流程 ─────────────────────────────────────────────────────────────────
function main(): void {
  // 1. 读取 stdin
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    silentExit();
  }
  if (!raw.trim()) silentExit();

  let input: StopHookInput = {};
  try {
    input = JSON.parse(raw) as StopHookInput;
  } catch {
    silentExit();
  }

  const transcriptPath = input.transcript_path;
  if (!transcriptPath || !existsSync(transcriptPath)) silentExit();

  const stopHookActive = input.stop_hook_active === true;

  // 2. 规则文件存在性
  if (!existsSync(OXLINT_CFG)) silentExit();

  // 3. 从 transcript 提取本会话 Edit/Write/MultiEdit 触达的 TS 文件
  const allFiles = extractEditedFiles(transcriptPath);
  if (allFiles.length === 0) silentExit();

  // 3.5 按 oxlintrc.ignorePatterns 在 hook 层过滤
  // 原因：oxlint 在"显式传文件清单"模式下不会应用 ignorePatterns，
  // 必须我们自己滤一遍才能让 *.test.* / *.config.* 这类配置生效
  const ignorePatterns = loadIgnorePatterns(OXLINT_CFG);
  const files = filterByIgnorePatterns(allFiles, ignorePatterns);
  const skippedCount = allFiles.length - files.length;
  if (files.length === 0) {
    emit({
      systemMessage: `✅ [oxlint] 无需检查（${allFiles.length} 个 TS 文件全部命中忽略规则）`,
    });
  }

  // 4. 跑 oxlint
  const oxlint = spawnSync('oxlint', ['-c', OXLINT_CFG, ...files], {
    encoding: 'utf8',
    // 合并 stderr 到 stdout，便于把完整报告塞回 Claude
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // spawnSync 出错（ENOENT 等）→ 视为基础设施问题，静默
  if (oxlint.error) {
    emit({
      systemMessage: `⚠️ [oxlint] 工具故障（${oxlint.error.message}），跳过本次检查`,
    });
  }

  const exitCode = oxlint.status ?? -1;
  const oxlintOut = `${oxlint.stdout ?? ''}${oxlint.stderr ?? ''}`.trim();
  const fileCount = files.length;
  const skipNote = skippedCount > 0 ? `，跳过 ${skippedCount} 个忽略文件` : '';

  switch (exitCode) {
    case 0:
      emit({
        systemMessage: `✅ [oxlint] 类型偷懒断言检查通过（${fileCount} 个 TS 文件${skipNote}，0 违规）`,
      });
      break;

    case 1: {
      // 真实 lint 违规
      const errorLine = oxlintOut
        .split('\n')
        .reverse()
        .find((l) => /Found .* errors?\./.test(l));
      const summary = errorLine
        ? `❌ [oxlint] 检测到类型偷懒断言 — ${errorLine} 共扫描 ${fileCount} 个 TS 文件${skipNote}`
        : `❌ [oxlint] 检测到类型偷懒断言（${fileCount} 个 TS 文件${skipNote}）`;

      if (stopHookActive) {
        emit({
          systemMessage: `${summary}（已提示过本轮不再阻断，请尽快修复）\n\n${oxlintOut}`,
        });
      }

      const reason = [
        'oxlint 检测到违规：',
        '',
        oxlintOut,
        '',
        '按 ts-type-discipline 协议处理：',
        '  1) 优先用泛型 / 条件类型 / 类型守卫消除断言，禁止 as any / as unknown as X',
        '  2) 类型体操无效 → 追溯并修复底层类型声明（接口/DTO/类型定义）',
        '  3) 若是后端接口少返回字段 → 用 AskUserQuestion 与用户确认方案',
      ].join('\n');

      emit({
        systemMessage: summary,
        decision: 'block',
        reason,
      });
      break;
    }

    default:
      // 126 不可执行 / 127 找不到二进制 / 内部错误等
      emit({
        systemMessage: `⚠️ [oxlint] 工具故障 (exit=${exitCode})，跳过本次检查`,
      });
  }
}

// ── 解析 transcript ────────────────────────────────────────────────────────
function extractEditedFiles(transcriptPath: string): string[] {
  let raw = '';
  try {
    raw = readFileSync(transcriptPath, 'utf8');
  } catch {
    return [];
  }

  const fileSet = new Set<string>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed: TranscriptLine;
    try {
      parsed = JSON.parse(line) as TranscriptLine;
    } catch {
      continue;
    }
    if (parsed.type !== 'assistant') continue;
    const content = parsed.message?.content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (block.type !== 'tool_use') continue;
      if (!isWriteTool(block.name)) continue;
      const fp = block.input?.file_path;
      if (typeof fp !== 'string') continue;
      if (!TS_EXTENSIONS.test(fp)) continue;
      if (!isExistingFile(fp)) continue;
      fileSet.add(fp);
    }
  }
  return [...fileSet].sort();
}

function isWriteTool(name?: string): boolean {
  return name === 'Edit' || name === 'Write' || name === 'MultiEdit';
}

function isExistingFile(p: string): boolean {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}

// ── ignorePatterns 处理 ────────────────────────────────────────────────────
function loadIgnorePatterns(cfgPath: string): string[] {
  try {
    const raw = readFileSync(cfgPath, 'utf8');
    const cfg = JSON.parse(raw) as OxlintConfig;
    if (!Array.isArray(cfg.ignorePatterns)) return [];
    return cfg.ignorePatterns.filter((p): p is string => typeof p === 'string');
  } catch {
    return [];
  }
}

function filterByIgnorePatterns(files: string[], patterns: string[]): string[] {
  if (patterns.length === 0) return files;
  // bun 内置 Bun.Glob（1.1+）原生支持标准 glob，零依赖
  const matchers = patterns.map((p) => new Bun.Glob(p));
  return files.filter((absPath) => {
    // 提供绝对路径 + cwd 相对路径两种形式，让 ** / *.config.* 这类 glob 都能匹配
    const rel = relative(process.cwd(), absPath);
    const candidates = [absPath, rel, `./${rel}`];
    for (const matcher of matchers) {
      for (const c of candidates) {
        if (matcher.match(c)) return false;
      }
    }
    return true;
  });
}

main();
