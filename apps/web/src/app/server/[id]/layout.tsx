import type { ReactNode } from "react";
import { Topbar } from "@/components/topbar";
import { ServerFrame } from "@/components/server-frame";

export default async function ServerLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <Topbar />
      <ServerFrame serverId={id}>{children}</ServerFrame>
    </div>
  );
}
