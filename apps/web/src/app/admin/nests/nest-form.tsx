"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, Pencil, Plus, Trash2 } from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { AdminCreateHeader, AdminSection, SaveIsland, isDirty } from "@/components/admin-create";
import { confirm } from "@/components/confirm-dialog";
import { Button, ButtonLink, Field, Input, Textarea } from "@/components/ui";
import { api } from "@/lib/api";
import type { EggRecord } from "./egg-form";

export type NestRecord = {
  id: string;
  name: string;
  description: string;
  eggCount: number;
  eggs: EggRecord[];
};

export function NestForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: NestRecord;
}) {
  const router = useRouter();
  const creating = mode === "create";
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [name, setName] = useState(initial?.name ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const dirty = isDirty(
    { name, description },
    { name: initial?.name ?? "", description: initial?.description ?? "" },
  );

  const serverCount = (initial?.eggs ?? []).reduce((sum, egg) => sum + (egg.serverCount ?? 0), 0);

  function onCancel() {
    setName(initial?.name ?? "");
    setDescription(initial?.description ?? "");
    setError(null);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const body = { name: name.trim(), description };
    try {
      if (creating) {
        await api("/api/v1/admin/nests", {
          method: "POST",
          body: JSON.stringify(body),
        });
      } else if (initial) {
        await api(`/api/v1/admin/nests/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      router.push("/admin/nests");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : creating ? "Create failed" : "Save failed");
      setPending(false);
    }
  }

  async function onDelete() {
    if (!initial) return;
    if (
      !(await confirm({
        title: "Delete nest",
        description: `Delete ${initial.name}? Unused eggs in this nest are deleted too.`,
        confirmLabel: "Delete",
      }))
    ) {
      return;
    }
    setError(null);
    setDeleting(true);
    try {
      await api(`/api/v1/admin/nests/${initial.id}`, { method: "DELETE" });
      router.push("/admin/nests");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
      setDeleting(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-6">
      <AdminCreateHeader
        backHref="/admin/nests"
        backLabel="Back to nests"
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/nests", label: "Nests" },
          { label: creating ? "New" : initial?.name ?? "Edit" },
        ]}
        icon={<Boxes className="size-4" />}
        title={creating ? "New nest" : `Edit ${initial?.name ?? "nest"}`}
        description="A nest groups related eggs, such as Minecraft or generic test images."
      />
      <AdminError message={error} />

      <AdminSection
        icon={<Boxes className="size-4" />}
        title="Nest details"
        description="Name is shown when creating servers and eggs."
      >
        <Field label="Name" required hint="1–64 characters.">
          <Input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Minecraft"
            required
            maxLength={64}
          />
        </Field>
        <Field label="Description" hint="Optional. What this nest is for.">
          <Textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder="Minecraft Java Edition."
            maxLength={240}
            className="min-h-[72px]"
          />
        </Field>
      </AdminSection>

      {creating ? null : (
        <AdminSection
          icon={<Plus className="size-4" />}
          title="Eggs"
          description="Eggs in this nest define Docker images and startup for servers."
        >
          <div className="flex flex-wrap gap-2">
            <ButtonLink href={`/admin/nests/eggs/new?nestId=${initial?.id ?? ""}`} size="sm">
              <Plus className="size-3.5" />
              New egg
            </ButtonLink>
            <ButtonLink
              href={`/admin/nests/eggs/import?nestId=${initial?.id ?? ""}`}
              variant="secondary"
              size="sm"
            >
              Import egg
            </ButtonLink>
          </div>
          {(initial?.eggs ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No eggs in this nest yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {(initial?.eggs ?? []).map((egg) => (
                <li key={egg.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <Link
                      href={`/admin/nests/eggs/${egg.id}`}
                      className="text-sm font-medium hover:text-primary"
                    >
                      {egg.name}
                    </Link>
                    <p className="truncate font-mono text-xs text-muted-foreground">{egg.dockerImage}</p>
                  </div>
                  <ButtonLink href={`/admin/nests/eggs/${egg.id}`} variant="secondary" size="sm">
                    <Pencil className="size-3.5" />
                    Edit
                  </ButtonLink>
                </li>
              ))}
            </ul>
          )}
        </AdminSection>
      )}

      {creating ? null : (
        <AdminSection
          icon={<Trash2 className="size-4" />}
          title="Danger zone"
          description="Nests that still have servers using their eggs cannot be deleted."
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {serverCount
                ? `${serverCount} server${serverCount === 1 ? "" : "s"} still use eggs in this nest.`
                : "No servers use eggs in this nest. Unused eggs will be deleted with it."}
            </p>
            <Button type="button" variant="danger" disabled={deleting || serverCount > 0} onClick={onDelete}>
              {deleting ? "Deleting…" : "Delete nest"}
            </Button>
          </div>
        </AdminSection>
      )}

      <SaveIsland
        visible={dirty || pending}
        onCancel={onCancel}
        submitLabel={creating ? "Create nest" : "Save changes"}
        pendingLabel={creating ? "Creating…" : "Saving…"}
        pending={pending}
        disabled={!name.trim()}
        summary={
          <span className="inline-flex items-center gap-2">
            <Boxes className="size-4 text-primary" />
            {creating ? "Creating" : "Saving"}{" "}
            <span className="font-medium text-foreground">{name.trim() || "nest"}</span>
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
