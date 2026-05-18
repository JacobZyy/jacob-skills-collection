import { useState } from "react";
import type { ClaudeCodeToolResultBlock } from "@ai-chat-viewer/ingestion/adapters/claude-code/blocks";

interface ToolResultProps {
  block: ClaudeCodeToolResultBlock;
}

function formatJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function renderContent(content: ClaudeCodeToolResultBlock["content"]): string {
  if (content === undefined) return "";
  if (typeof content === "string") return content;
  return formatJson(content);
}

export function ToolResult({ block }: ToolResultProps) {
  const [open, setOpen] = useState(false);
  const isError = block.is_error === true;
  const body = renderContent(block.content);

  return (
    <div className="rounded-md border border-base-300 bg-base-200/40">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-base-content/80 hover:bg-base-300/60"
        aria-expanded={open}
      >
        <span aria-hidden="true">⤴</span>
        <span className={`badge badge-sm ${isError ? "badge-error" : "badge-success"}`}>
          {isError ? "error" : "ok"}
        </span>
        <span className="font-mono text-xs text-base-content/60">tool_use_id: {block.tool_use_id}</span>
        <span className="ml-auto text-xs text-base-content/40">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <pre className="max-h-96 overflow-auto whitespace-pre-wrap border-t border-base-300 px-3 py-2 font-mono text-xs">
          {body}
        </pre>
      ) : null}
    </div>
  );
}
