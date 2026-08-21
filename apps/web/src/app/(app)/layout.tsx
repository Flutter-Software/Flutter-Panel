import type { ReactNode } from "react";
import { Topbar } from "@/components/topbar";

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <Topbar />
      <main className="mx-auto min-h-0 w-full max-w-6xl flex-1 overflow-auto px-4 py-6 sm:px-6">
        {children}
      </main>
    </div>
  );
}
