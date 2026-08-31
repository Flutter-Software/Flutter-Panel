"use client";

import { use, useEffect, useMemo, useRef, useState } from "react";
import { Check, Copy, Mail, Search, Trash2, UserPlus } from "lucide-react";
import { PERMISSION_GROUPS, type ServerPermission } from "@flutter-software/shared";
import { confirm } from "@/components/confirm-dialog";
import { Badge, Button, Card, EmptyState, Input, Modal } from "@/components/ui";
import { useServerRecord } from "@/components/server-frame";
import { api } from "@/lib/api";
import { can } from "@/lib/access";
import { cn } from "@/lib/cn";

type Subuser = {
  id: string;
  email: string;
  username: string | null;
  userId: string | null;
  permissions: ServerPermission[];
  pending: boolean;
  inviteExpired: boolean;
  createdAt: string;
};

type SearchHit = { id: string; username: string; email: string };

const DEFAULT_PERMS: ServerPermission[] = ["control.console", "file.read"];

function PermissionPicker({
  value,
  onChange,
  disabled,
}: {
  value: ServerPermission[];
  onChange: (next: ServerPermission[]) => void;
  disabled?: boolean;
}) {
  const selected = new Set(value);

  function toggle(key: ServerPermission) {
    const next = new Set(selected);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onChange(PERMISSION_GROUPS.flatMap((group) => group.permissions.map((p) => p.key)).filter((k) => next.has(k)));
  }

  function toggleGroup(keys: ServerPermission[]) {
    const allOn = keys.every((key) => selected.has(key));
    const next = new Set(selected);
    for (const key of keys) {
      if (allOn) next.delete(key);
      else next.add(key);
    }
    onChange(PERMISSION_GROUPS.flatMap((group) => group.permissions.map((p) => p.key)).filter((k) => next.has(k)));
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {PERMISSION_GROUPS.map((group) => {
        const keys = group.permissions.map((item) => item.key);
        const count = keys.filter((key) => selected.has(key)).length;
        const all = count === keys.length;
        const some = count > 0 && !all;
        return (
          <div key={group.key} className="rounded-lg border border-border p-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-primary"
                checked={all}
                ref={(el) => {
                  if (el) el.indeterminate = some;
                }}
                disabled={disabled}
                onChange={() => toggleGroup(keys)}
              />
              <span>
                <span className="text-sm font-medium">{group.label}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{group.description}</span>
              </span>
            </label>
            <div className="mt-2 space-y-1.5 border-t border-border pt-2">
              {group.permissions.map((item) => (
                <label key={item.key} className="flex items-start gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50">
                  <input
                    type="checkbox"
                    className="mt-1 size-4 accent-primary"
                    checked={selected.has(item.key)}
                    disabled={disabled}
                    onChange={() => toggle(item.key)}
                  />
                  <span>
                    <span className="text-sm">{item.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{item.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export default function UsersPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const server = useServerRecord();
  const [subusers, setSubusers] = useState<Subuser[]>([]);
  const [canCreate, setCanCreate] = useState(false);
  const [canUpdate, setCanUpdate] = useState(false);
  const [canDelete, setCanDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [identifier, setIdentifier] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [openHits, setOpenHits] = useState(false);
  const [permissions, setPermissions] = useState<ServerPermission[]>(DEFAULT_PERMS);
  const [editing, setEditing] = useState<string | null>(null);
  const [editPerms, setEditPerms] = useState<ServerPermission[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const allowRead = can(server, "user.read");
  const emailLike = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier.trim());
  const exactHit = hits.find(
    (hit) =>
      hit.email.toLowerCase() === identifier.trim().toLowerCase() ||
      hit.username.toLowerCase() === identifier.trim().toLowerCase(),
  );

  async function load() {
    const result = await api<{
      data: { subusers: Subuser[]; canCreate: boolean; canUpdate: boolean; canDelete: boolean };
    }>(`/api/v1/client/servers/${id}/users`);
    setSubusers(result.data.subusers);
    setCanCreate(result.data.canCreate);
    setCanUpdate(result.data.canUpdate);
    setCanDelete(result.data.canDelete);
  }

  useEffect(() => {
    if (!allowRead && server && !server.permissions?.includes("*") && !server.owner) return;
    load().catch((err) => setError(err instanceof Error ? err.message : "Failed to load users"));
  }, [id, allowRead, server?.id]);

  useEffect(() => {
    const q = identifier.trim();
    if (q.length < 2 || !canCreate) {
      setHits([]);
      return;
    }
    const timer = window.setTimeout(() => {
      api<{ data: { users: SearchHit[] } }>(
        `/api/v1/client/servers/${id}/users/search?q=${encodeURIComponent(q)}`,
      )
        .then((result) => setHits(result.data.users))
        .catch(() => setHits([]));
    }, 200);
    return () => window.clearTimeout(timer);
  }, [identifier, id, canCreate]);

  useEffect(() => {
    function onDoc(event: MouseEvent) {
      if (!boxRef.current?.contains(event.target as Node)) setOpenHits(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const taken = useMemo(
    () => new Set(subusers.map((row) => row.email.toLowerCase())),
    [subusers],
  );
  const editingSub = subusers.find((row) => row.id === editing) ?? null;

  async function addUser() {
    setError(null);
    setNotice(null);
    setInviteLink(null);
    setPending(true);
    try {
      const result = await api<{
        data: { subuser: Subuser; emailed?: boolean; inviteUrl?: string };
      }>(`/api/v1/client/servers/${id}/users`, {
        method: "POST",
        body: JSON.stringify({ identifier: identifier.trim(), permissions }),
      });
      setIdentifier("");
      setHits([]);
      setPermissions(DEFAULT_PERMS);
      setAddOpen(false);
      await load();
      if (result.data.inviteUrl) {
        setInviteLink(result.data.inviteUrl);
        setNotice(
          result.data.emailed
            ? `Invite emailed to ${result.data.subuser.email}. You can also copy the setup link.`
            : `No mail server is configured, so share this setup link with ${result.data.subuser.email}.`,
        );
      } else {
        setNotice(`Added ${result.data.subuser.username ?? result.data.subuser.email}.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add user");
    } finally {
      setPending(false);
    }
  }

  async function saveEdit(subId: string) {
    setError(null);
    setPending(true);
    try {
      await api(`/api/v1/client/servers/${id}/users/${subId}`, {
        method: "PATCH",
        body: JSON.stringify({ permissions: editPerms }),
      });
      setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update permissions");
    } finally {
      setPending(false);
    }
  }

  async function remove(sub: Subuser) {
    if (
      !(await confirm({
        title: "Remove user",
        description: `Remove ${sub.username ?? sub.email} from this server?`,
        confirmLabel: "Remove",
      }))
    ) {
      return;
    }
    setError(null);
    setPending(true);
    try {
      await api(`/api/v1/client/servers/${id}/users/${sub.id}`, { method: "DELETE" });
      if (editing === sub.id) setEditing(null);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove user");
    } finally {
      setPending(false);
    }
  }

  async function resend(sub: Subuser) {
    setError(null);
    setNotice(null);
    setPending(true);
    try {
      const result = await api<{ data: { emailed?: boolean; inviteUrl?: string } }>(
        `/api/v1/client/servers/${id}/users/${sub.id}/invite`,
        { method: "POST" },
      );
      if (result.data.inviteUrl) {
        setInviteLink(result.data.inviteUrl);
        setNotice(
          result.data.emailed
            ? `A new invite was emailed to ${sub.email}.`
            : `Share this setup link with ${sub.email}.`,
        );
      }
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resend invite");
    } finally {
      setPending(false);
    }
  }

  async function copyLink() {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  if (server && !allowRead) {
    return <p className="text-sm text-destructive">You do not have permission to view subusers.</p>;
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground">
            Search an existing account, or type an email to invite someone new. Invites expire in 7 days.
          </p>
        </div>
        {canCreate ? (
          <Button
            type="button"
            onClick={() => {
              setError(null);
              setAddOpen(true);
            }}
          >
            <UserPlus className="size-4" />
            Add subuser
          </Button>
        ) : null}
      </div>
      {error && !addOpen && !editing ? <p className="text-sm text-destructive">{error}</p> : null}
      {notice ? (
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <p>{notice}</p>
          {inviteLink ? (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input readOnly value={inviteLink} className="font-mono text-xs" />
              <Button type="button" size="sm" variant="secondary" onClick={() => void copyLink()}>
                {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}

      <Modal
        title="Add subuser"
        description="Search an existing account, or type an email to send an invite."
        open={addOpen}
        onClose={() => setAddOpen(false)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setAddOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending || identifier.trim().length < 2}
              onClick={() => void addUser()}
            >
              {emailLike && !exactHit ? "Invite subuser" : "Add subuser"}
            </Button>
          </>
        }
      >
        {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
        <div className="space-y-4">
          <div ref={boxRef} className="relative">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={identifier}
                onChange={(event) => {
                  setIdentifier(event.target.value);
                  setOpenHits(true);
                }}
                onFocus={() => setOpenHits(true)}
                placeholder="Search username or email"
                className="pl-9"
                autoComplete="off"
              />
            </div>
            {openHits && identifier.trim().length >= 2 ? (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-border bg-popover shadow-lg">
                {hits.map((hit) => {
                  const already = taken.has(hit.email.toLowerCase());
                  return (
                    <button
                      key={hit.id}
                      type="button"
                      disabled={already}
                      className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted disabled:opacity-50"
                      onClick={() => {
                        setIdentifier(hit.email);
                        setOpenHits(false);
                      }}
                    >
                      <span>
                        <span className="font-medium">{hit.username}</span>
                        <span className="ml-2 text-muted-foreground">{hit.email}</span>
                      </span>
                      {already ? <span className="text-xs text-muted-foreground">Added</span> : null}
                    </button>
                  );
                })}
                {emailLike && !exactHit ? (
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-sm hover:bg-muted"
                    onClick={() => {
                      setIdentifier(identifier.trim().toLowerCase());
                      setOpenHits(false);
                    }}
                  >
                    <Mail className="size-4 text-primary" />
                    Invite {identifier.trim().toLowerCase()}
                  </button>
                ) : null}
                {hits.length === 0 && !emailLike ? (
                  <p className="px-3 py-2 text-sm text-muted-foreground">
                    No accounts match. Enter a full email to send an invite.
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <PermissionPicker value={permissions} onChange={setPermissions} disabled={pending} />
        </div>
      </Modal>

      <Modal
        title="Permissions"
        description={
          editingSub
            ? `Access for ${editingSub.username ?? editingSub.email}`
            : "Choose what this user can do on this server."
        }
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              disabled={pending || !editing}
              onClick={() => editing && void saveEdit(editing)}
            >
              Save permissions
            </Button>
          </>
        }
      >
        {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}
        <PermissionPicker value={editPerms} onChange={setEditPerms} disabled={pending} />
      </Modal>

      {subusers.length === 0 && !server ? (
        <EmptyState
          title="No subusers yet"
          description="Only the owner and administrators can manage this server until you add someone."
        />
      ) : (
        <div className="space-y-3">
          {server ? (
            <Card className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{server.ownerName ?? "Owner"}</p>
                    <Badge>Owner</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">Full access to this server</p>
                </div>
              </div>
            </Card>
          ) : null}
          {subusers.length === 0 ? (
            <EmptyState
              title="No subusers yet"
              description="Search an account or invite someone by email to share this server."
            />
          ) : (
            subusers.map((sub) => (
            <Card key={sub.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{sub.username ?? sub.email}</p>
                    {sub.pending ? (
                      <Badge className={sub.inviteExpired ? "bg-status-error/15 text-status-error" : ""}>
                        {sub.inviteExpired ? "Invite expired" : "Pending invite"}
                      </Badge>
                    ) : null}
                  </div>
                  {sub.username ? (
                    <p className="text-sm text-muted-foreground">{sub.email}</p>
                  ) : (
                    <p className="text-sm text-muted-foreground">Waiting for them to create an account</p>
                  )}
                  <p className="mt-1 text-xs text-muted-foreground">
                    {sub.permissions.length} permission{sub.permissions.length === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {sub.pending && canCreate ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={pending}
                      onClick={() => void resend(sub)}
                    >
                      <Mail className="size-3.5" />
                      Resend invite
                    </Button>
                  ) : null}
                  {canUpdate ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setError(null);
                        setEditing(sub.id);
                        setEditPerms(sub.permissions);
                      }}
                    >
                      Permissions
                    </Button>
                  ) : null}
                  {canDelete ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="danger"
                      disabled={pending}
                      onClick={() => void remove(sub)}
                    >
                      <Trash2 className="size-3.5" />
                      Remove
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          ))
          )}
        </div>
      )}
    </div>
  );
}
