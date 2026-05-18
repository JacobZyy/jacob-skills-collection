/**
 * PostToolUse hook: 每次工具调用结束后记录到 SQLite。
 *
 * 输入：stdin JSON { tool_name, tool_input, tool_result, ... }
 * 输出：静默 exit 0（不阻断 Claude Code）
 *
 * 设计文档: ~/.omc/specs/deep-interview-token-recorder.md
 */

import { readFileSync } from 'node:fs';

import { PrismaClient } from '../node_modules/.prisma/client';

const PREVIEW_LIMIT = 500;

interface PostToolUseInput {
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_result?: string | { content?: string | Array<{ type: string; text?: string }> };
  transcript_path?: string;
  session_id?: string;
}

function silentExit(): never {
  process.exit(0);
}

function extractResultText(result: PostToolUseInput['tool_result']): string {
  if (typeof result === 'string') return result;
  if (!result) return '';
  if (typeof result.content === 'string') return result.content;
  if (Array.isArray(result.content)) {
    return result.content
      .filter((c): c is { type: string; text: string } => typeof c === 'object' && c.type === 'text')
      .map((c) => c.text ?? '')
      .join('\n');
  }
  return JSON.stringify(result);
}

function truncate(s: string, limit: number): string {
  if (s.length <= limit) return s;
  return s.slice(0, limit) + `... [truncated, total ${s.length} chars]`;
}

function main(): void {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    silentExit();
  }
  if (!raw.trim()) silentExit();

  let input: PostToolUseInput;
  try {
    input = JSON.parse(raw) as PostToolUseInput;
  } catch {
    silentExit();
  }

  const toolName = input.tool_name;
  if (!toolName) silentExit();

  // 跳过内部/noise 工具
  const SKIP_TOOLS = new Set(['Read', 'TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList']);
  if (SKIP_TOOLS.has(toolName)) silentExit();

  const toolInputPreview = truncate(JSON.stringify(input.tool_input ?? {}), PREVIEW_LIMIT);
  const resultText = extractResultText(input.tool_result);
  const resultChars = resultText.length;
  const resultTokenEst = Math.round(resultChars / 4);

  const sessionId = input.session_id ?? 'unknown';

  // 从 transcript 计算 turn_idx（本轮 = transcript 里 user 消息数）
  let turnIdx = 0;
  const transcriptPath = input.transcript_path;
  if (transcriptPath) {
    try {
      const transcript = readFileSync(transcriptPath, 'utf8');
      for (const line of transcript.split('\n')) {
        if (!line.trim()) continue;
        try {
          const d = JSON.parse(line) as { type?: string };
          if (d.type === 'user') turnIdx++;
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
  }

  const prisma = new PrismaClient();
  prisma.toolCall
    .create({
      data: {
        sessionId,
        turnIdx,
        toolName,
        toolInputPreview,
        toolResultChars: resultChars,
        toolResultTokenEst: resultTokenEst,
        ts: new Date(),
      },
    })
    .then(() => prisma.$disconnect())
    .catch(() => prisma.$disconnect());
}

main();
