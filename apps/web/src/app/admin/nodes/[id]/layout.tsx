import type { ReactNode } from "react";
import { NodeFrame } from "@/components/node-frame";

export default async function NodeLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <NodeFrame nodeId={id}>{children}</NodeFrame>;
}
