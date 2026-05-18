import { useState } from "react";
import type { ClaudeCodeThinkingBlock } from "@ai-chat-viewer/ingestion/adapters/claude-code/blocks";

interface ThinkingProps {
  block: ClaudeCodeThinkingBlock;
}

export function Thinking({ block }: ThinkingProps) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-base-300 bg-base-200/40">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-base-content/70 hover:bg-base-300/60"
        aria-expanded={open}
      >
        <span aria-hidden="true">💭</span>
        <span>思考中…</span>
        <span className="ml-auto text-xs text-base-content/40">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-base-300 px-3 py-2 font-mono text-xs text-base-content/80">
          {block.thinking}
        </pre>
      ) : null}
    </div>
  );
}
