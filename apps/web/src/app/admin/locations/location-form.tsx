"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Trash2 } from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { AdminCreateHeader, AdminSection, SaveIsland, isDirty } from "@/components/admin-create";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { api } from "@/lib/api";

export type LocationRecord = {
  id: string;
  shortCode: string;
  description: string;
  nodeCount?: number;
};

export function LocationForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: LocationRecord;
}) {
  const router = useRouter();
  const creating = mode === "create";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [shortCode, setShortCode] = useState(initial?.shortCode ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const dirty = isDirty(
    { shortCode, description },
    { shortCode: initial?.shortCode ?? "", description: initial?.description ?? "" },
  );

  function onCancel() {
    setShortCode(initial?.shortCode ?? "");
    setDescription(initial?.description ?? "");
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const body = {
      shortCode: shortCode.trim().toLowerCase(),
      description,
    };
    try {
      if (creating) {
        await api("/api/v1/admin/locations", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else if (initial) {
        await api(`/api/v1/admin/locations/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      router.push("/admin/locations");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : creating ? "Create failed" : "Save failed");
      setPending(false);
    }
  }

  async function onDelete() {
    if (!initial) return;
    if (!window.confirm(`Delete location ${initial.shortCode}? This cannot be undone.`)) return;
    setError(null);
    setDeleting(true);
    try {
      await api(`/api/v1/admin/locations/${initial.id}`, { method: "DELETE" });
      router.push("/admin/locations");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-6">
      <AdminCreateHeader
        backHref="/admin/locations"
        backLabel="Back to locations"
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/locations", label: "Locations" },
          { label: creating ? "New" : initial?.shortCode ?? "Edit" },
        ]}
        icon={<MapPin className="size-4" />}
        title={creating ? "New location" : `Edit ${initial?.shortCode ?? "location"}`}
        description="Locations group nodes by region or datacenter."
      />
      <AdminError message={error} />

      <AdminSection
        icon={<MapPin className="size-4" />}
        title="Location details"
        description="A short code is shown on nodes and server cards."
      >
        <Field
          label="Short code"
          required
          hint="1–16 characters. Letters, numbers, and dashes. Saved lowercase."
        >
          <Input
            value={shortCode}
            onChange={(event) => setShortCode(event.target.value)}
            placeholder="us-east"
            required
            maxLength={16}
            className="font-mono"
          />
        </Field>
        <Field label="Description" hint="Optional. A friendly name like US East.">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="US East"
            maxLength={120}
            className="min-h-[72px]"
          />
        </Field>
      </AdminSection>

      {creating ? null : (
        <AdminSection
          icon={<Trash2 className="size-4" />}
          title="Danger zone"
          description="Locations that still have nodes cannot be deleted."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {initial?.nodeCount
                ? `${initial.nodeCount} node${initial.nodeCount === 1 ? "" : "s"} still use this location.`
                : "This location has no nodes."}
            </p>
            <Button
              type="button"
              variant="danger"
              disabled={deleting || Boolean(initial?.nodeCount)}
              onClick={onDelete}
            >
              {deleting ? "Deleting…" : "Delete location"}
            </Button>
          </div>
        </AdminSection>
      )}

      <SaveIsland
        visible={dirty || pending}
        onCancel={onCancel}
        submitLabel={creating ? "Create location" : "Save changes"}
        pendingLabel={creating ? "Creating…" : "Saving…"}
        pending={pending}
        disabled={!shortCode.trim()}
        summary={
          <span className="inline-flex items-center gap-2">
            <MapPin className="size-4 text-primary" />
            {creating ? "Creating" : "Saving"}{" "}
            <span className="font-mono font-medium text-foreground">
              {shortCode.trim().toLowerCase() || "location"}
            </span>
            {description.trim() ? (
              <>
                {" "}
                — <span className="text-foreground">{description.trim()}</span>
              </>
            ) : null}
          </span>
        }
      />
    </form>
  );
}
