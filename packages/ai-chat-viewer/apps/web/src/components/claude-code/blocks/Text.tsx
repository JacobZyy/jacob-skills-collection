import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ClaudeCodeTextBlock } from "@ai-chat-viewer/ingestion/adapters/claude-code/blocks";

interface TextProps {
  block: ClaudeCodeTextBlock;
}

export function Text({ block }: TextProps) {
  return (
    <div className="prose prose-sm max-w-none break-words text-base-content">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{block.text}</ReactMarkdown>
    </div>
  );
}
