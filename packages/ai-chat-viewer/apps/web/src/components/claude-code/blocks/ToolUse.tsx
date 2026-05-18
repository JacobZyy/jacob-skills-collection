import { useState } from "react";
import type { ClaudeCodeToolUseBlock } from "@ai-chat-viewer/ingestion/adapters/claude-code/blocks";

interface ToolUseProps {
  block: ClaudeCodeToolUseBlock;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

export function ToolUse({ block }: ToolUseProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-base-300 bg-base-200/40">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-base-content/80 hover:bg-base-300/60"
        aria-expanded={open}
      >
        <span aria-hidden="true">🔧</span>
        <span className="font-mono">{block.name}</span>
        <span className="ml-auto text-xs text-base-content/40">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <div className="border-t border-base-300 px-3 py-2">
          <h4 className="mb-1 text-xs font-semibold text-base-content/60">input</h4>
          <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-base-300/60 p-2 font-mono text-xs">
            {formatJson(block.input)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}
