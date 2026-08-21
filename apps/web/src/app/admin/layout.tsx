import type { ReactNode } from "react";
import { Topbar } from "@/components/topbar";
import { AdminSidebar } from "@/components/sidebar";

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <Topbar />
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <AdminSidebar />
        <div className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">{children}</div>
      </div>
    </div>
  );
}
