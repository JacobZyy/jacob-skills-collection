import { QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
import { queryClient } from "./lib/query-client";
import { SseProvider } from "./sse/sse-provider";

const rootElement = document.getElementById("root");
if (!rootElement) {
  throw new Error("[@ai-chat-viewer/web] missing #root element in index.html");
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SseProvider>
        <App />
      </SseProvider>
    </QueryClientProvider>
  </StrictMode>,
);
