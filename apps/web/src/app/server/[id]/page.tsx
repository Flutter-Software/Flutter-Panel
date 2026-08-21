import { redirect } from "next/navigation";

export default async function ServerIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  redirect(`/server/${id}/console`);
}
