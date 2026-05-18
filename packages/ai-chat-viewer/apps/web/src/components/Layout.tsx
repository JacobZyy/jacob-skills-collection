import type { ReactNode } from "react";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen bg-base-100">
      <nav className="navbar bg-base-200 px-6">
        <a href="/" className="btn btn-ghost text-lg font-bold normal-case">
          AI Chat Viewer
        </a>
      </nav>
      <div className="py-4">{children}</div>
    </div>
  );
}
