import type { ClaudeCodeBlock } from "@ai-chat-viewer/ingestion/adapters/claude-code/blocks";
import { Text } from "./blocks/Text";
import { Thinking } from "./blocks/Thinking";
import { ToolResult } from "./blocks/ToolResult";
import { ToolUse } from "./blocks/ToolUse";

interface MessageRendererProps {
  blocks: ClaudeCodeBlock[];
}

export function MessageRenderer({ blocks }: MessageRendererProps) {
  return (
    <div className="space-y-2">
      {blocks.map((block, index) => {
        switch (block.type) {
          case "text":
            return <Text key={index} block={block} />;
          case "thinking":
            return <Thinking key={index} block={block} />;
          case "tool_use":
            return <ToolUse key={index} block={block} />;
          case "tool_result":
            return <ToolResult key={index} block={block} />;
          default: {
            // Exhaustive check: if a new block type is added to the source
            // union, TS will fail here until we handle it.
            block satisfies never;
            return null;
          }
        }
      })}
    </div>
  );
}
