"use client";

import { use } from "react";
import { AdminEditFormSkeleton } from "@/components/skeletons";
import { QueryErrorPage } from "@/components/error-page";
import { useQuery } from "@/lib/query";
import { EggForm, type EggRecord } from "../../egg-form";

export default function EditEggPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, errorStatus, reload } = useQuery<{ data: { egg: EggRecord } }>(
    `/api/v1/admin/eggs/${id}`,
  );
  const egg = data?.data.egg ?? null;

  if (error && !egg) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
        homeHref="/admin/nests"
        homeLabel="Back to nests"
      />
    );
  }

  if (!egg) {
    return (
      <AdminEditFormSkeleton
        title="Egg"
        description="Edit this egg."
        backHref="/admin/nests"
        backLabel="Nests"
      />
    );
  }

  return <EggForm mode="edit" initial={egg} />;
}
