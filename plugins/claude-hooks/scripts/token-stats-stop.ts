/**
 * Stop hook: 每轮对话结束时从 transcript 读取 usage 写入 TurnUsage。
 *
 * 输入：stdin JSON { transcript_path, session_id, stop_hook_active }
 * 输出：静默 exit 0（不阻断）
 *
 * 设计文档: ~/.omc/specs/deep-interview-token-recorder.md
 */

import { readFileSync } from 'node:fs';
import { PrismaClient } from '../node_modules/.prisma/client';

interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

interface TranscriptLine {
  type?: string;
  timestamp?: string;
  message?: {
    model?: string;
    usage?: Usage;
    content?: unknown;
  };
}

interface StopHookInput {
  transcript_path?: string;
  session_id?: string;
}

const PREVIEW_LIMIT = 500;

function silentExit(): never {
  process.exit(0);
}

function truncate(s: string, limit: number): string {
  if (s.length <= limit) return s;
  return s.slice(0, limit) + '...';
}

// Anthropic 官方定价 (USD per 1M tokens, 2026-05)
function estimateCost(model: string, usage: Usage): number {
  const isOpus = model.includes('opus');
  const isSonnet = model.includes('sonnet');
  // default: haiku pricing
  const inputPrice = isOpus ? 15 : isSonnet ? 3 : 0.8;
  const outputPrice = isOpus ? 75 : isSonnet ? 15 : 4;
  const cacheReadPrice = isOpus ? 1.5 : isSonnet ? 0.3 : 0.08;
  const cacheWritePrice = isOpus ? 18.75 : isSonnet ? 3.75 : 1;

  const inTokens = (usage.input_tokens ?? 0) / 1_000_000;
  const outTokens = (usage.output_tokens ?? 0) / 1_000_000;
  const cacheReadTokens = (usage.cache_read_input_tokens ?? 0) / 1_000_000;
  const cacheWriteTokens = (usage.cache_creation_input_tokens ?? 0) / 1_000_000;

  return inTokens * inputPrice + outTokens * outputPrice + cacheReadTokens * cacheReadPrice + cacheWriteTokens * cacheWritePrice;
}

function extractUserMsg(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    for (const block of content) {
      if (typeof block === 'object' && block !== null && 'type' in block && block.type === 'text') {
        return (block as { text?: string }).text ?? '';
      }
    }
  }
  return '';
}

async function main(): Promise<void> {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    silentExit();
  }
  if (!raw.trim()) silentExit();

  let input: StopHookInput;
  try {
    input = JSON.parse(raw) as StopHookInput;
  } catch {
    silentExit();
  }

  const transcriptPath = input.transcript_path;
  if (!transcriptPath) silentExit();

  let transcript: string;
  try {
    transcript = readFileSync(transcriptPath, 'utf8');
  } catch {
    silentExit();
  }

  const lines: TranscriptLine[] = [];
  for (const line of transcript.split('\n')) {
    if (!line.trim()) continue;
    try {
      lines.push(JSON.parse(line) as TranscriptLine);
    } catch { /* skip */ }
  }

  // 找最末一条 assistant 消息的 usage
  let lastAssistantIdx = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].type === 'assistant') {
      lastAssistantIdx = i;
      break;
    }
  }
  if (lastAssistantIdx < 0) silentExit();

  const lastAssistant = lines[lastAssistantIdx];
  const usage = lastAssistant.message?.usage;
  if (!usage) silentExit();

  const model = lastAssistant.message?.model ?? 'unknown';
  const sessionId = input.session_id ?? 'unknown';

  // 找本轮范围：从最后一条 user 消息到最后一条 assistant
  let turnStartIdx = 0;
  for (let i = lastAssistantIdx - 1; i >= 0; i--) {
    if (lines[i].type === 'user') {
      turnStartIdx = i;
      break;
    }
  }

  // turn_idx = 这条 user 之前有多少条 user 消息
  let turnIdx = 0;
  for (let i = 0; i < turnStartIdx; i++) {
    if (lines[i].type === 'user') turnIdx++;
  }

  // tsStart / tsEnd
  const tsStart = lines[turnStartIdx]?.timestamp
    ? new Date(lines[turnStartIdx].timestamp as string)
    : new Date();
  const tsEnd = lastAssistant.timestamp
    ? new Date(lastAssistant.timestamp as string)
    : new Date();

  // user msg preview
  const userContent = lines[turnStartIdx]?.message?.content;
  const userMsgPreview = truncate(extractUserMsg(userContent), PREVIEW_LIMIT);

  // 本轮工具调用计数
  let toolCallCount = 0;
  for (let i = turnStartIdx; i <= lastAssistantIdx; i++) {
    const content = lines[i]?.message?.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (typeof block === 'object' && block !== null && 'type' in block && (block as { type: string }).type === 'tool_use') {
          toolCallCount++;
        }
      }
    }
  }

  const costEstUsd = estimateCost(model, usage);

  const prisma = new PrismaClient();
  try {
    await prisma.turnUsage.create({
      data: {
        sessionId,
        turnIdx,
        tsStart,
        tsEnd,
        model,
        inputTokens: usage.input_tokens ?? 0,
        outputTokens: usage.output_tokens ?? 0,
        cacheRead: usage.cache_read_input_tokens ?? 0,
        cacheWrite: usage.cache_creation_input_tokens ?? 0,
        costEstUsd,
        userMsgPreview,
        toolCallCount,
      },
    });
  } catch {
    // 写入失败静默
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => process.exit(0));
