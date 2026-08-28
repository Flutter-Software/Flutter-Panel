"use client";

import { use } from "react";
import { AdminFormPage, ListSkeleton } from "@/components/admin-table";
import { QueryErrorPage } from "@/components/error-page";
import { useQuery } from "@/lib/query";
import { LocationForm, type LocationRecord } from "../location-form";

export default function EditLocationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error, errorStatus, reload } = useQuery<{ data: { location: LocationRecord } }>(
    `/api/v1/admin/locations/${id}`,
  );
  const location = data?.data.location ?? null;

  if (error && !location) {
    return (
      <QueryErrorPage
        error={error}
        status={errorStatus}
        onRetry={() => void reload()}
        homeHref="/admin/locations"
        homeLabel="Back to locations"
      />
    );
  }

  if (!location) {
    return (
      <AdminFormPage
        title="Location"
        description="Edit this location."
        backHref="/admin/locations"
        backLabel="Locations"
      >
        <ListSkeleton rows={2} />
      </AdminFormPage>
    );
  }

  return <LocationForm mode="edit" initial={location} />;
}
