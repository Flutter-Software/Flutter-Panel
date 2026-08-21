"use client";

import { useParams } from "next/navigation";
import { AdminError, AdminFormPage, ListSkeleton } from "@/components/admin-table";
import { useQuery } from "@/lib/query";
import { LocationForm, type LocationRecord } from "../location-form";

export default function EditLocationPage() {
  const params = useParams<{ id: string }>();
  const { data, error } = useQuery<{ data: { location: LocationRecord } }>(
    `/api/v1/admin/locations/${params.id}`,
  );
  const location = data?.data.location ?? null;

  if (error && !location) {
    return (
      <AdminFormPage
        title="Location"
        description="This location could not be loaded."
        backHref="/admin/locations"
        backLabel="Locations"
      >
        <AdminError message={error} />
      </AdminFormPage>
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
