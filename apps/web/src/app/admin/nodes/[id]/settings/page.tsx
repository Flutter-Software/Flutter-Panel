"use client";

import { useEffect, useState, type FormEvent } from "react";
import {
  Cpu,
  Folder,
  Globe,
  HardDrive,
  Lock,
  MemoryStick,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { AdminSection, Switch } from "@/components/admin-create";
import { useAdminNode } from "@/components/node-frame";
import { Button, Field, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";

type Location = { id: string; shortCode: string; description: string };

function mbToGiB(mb: number) {
  const gib = mb / 1024;
  return Number.isInteger(gib) ? String(gib) : String(Math.round(gib * 10) / 10);
}

export default function NodeSettingsPage() {
  const { node, reload } = useAdminNode();
  const { data } = useQuery<{ data: { locations: Location[] } }>("/api/v1/admin/locations");
  const locations = data?.data.locations ?? [];
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [fqdn, setFqdn] = useState("");
  const [scheme, setScheme] = useState<"https" | "http">("https");
  const [behindProxy, setBehindProxy] = useState(false);
  const [daemonBase, setDaemonBase] = useState("");
  const [memoryGiB, setMemoryGiB] = useState("");
  const [cpuCores, setCpuCores] = useState("");
  const [memoryOverallocate, setMemoryOverallocate] = useState("0");
  const [diskGiB, setDiskGiB] = useState("");
  const [diskOverallocate, setDiskOverallocate] = useState("0");
  const [daemonPort, setDaemonPort] = useState("8080");
  const [sftpPort, setSftpPort] = useState("2022");
  const [uploadLimitMb, setUploadLimitMb] = useState("250");
  const [maintenanceMode, setMaintenanceMode] = useState(false);

  useEffect(() => {
    if (!node) return;
    setName(node.name);
    setLocationId(node.locationId);
    setDescription(node.description);
    setIsPublic(node.public);
    setFqdn(node.fqdn);
    setScheme(node.scheme);
    setBehindProxy(node.behindProxy);
    setDaemonBase(node.daemonBase);
    setMemoryGiB(mbToGiB(node.memoryMb));
    setCpuCores(String(node.cpuCores || 1));
    setMemoryOverallocate(String(node.memoryOverallocate));
    setDiskGiB(mbToGiB(node.diskMb));
    setDiskOverallocate(String(node.diskOverallocate));
    setDaemonPort(String(node.daemonPort));
    setSftpPort(String(node.sftpPort));
    setUploadLimitMb(String(node.uploadLimitMb || 250));
    setMaintenanceMode(node.maintenanceMode);
  }, [node]);

  if (!node) return null;

  const nodeId = node.id;

  async function onSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      await api(`/api/v1/admin/nodes/${nodeId}`, {
        method: "PATCH",
        body: JSON.stringify({
          locationId,
          name: name.trim().toLowerCase(),
          description,
          public: isPublic,
          fqdn: fqdn.trim(),
          scheme,
          behindProxy,
          daemonBase,
          memoryMb: Math.round(Number(memoryGiB) * 1024),
          diskMb: Math.round(Number(diskGiB) * 1024),
          cpuCores: Number(cpuCores),
          memoryOverallocate: Number(memoryOverallocate),
          diskOverallocate: Number(diskOverallocate),
          daemonPort: Number(daemonPort),
          sftpPort: Number(sftpPort),
          uploadLimitMb: Number(uploadLimitMb),
          maintenanceMode,
        }),
      });
      await reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Save failed");
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={(event) => void onSave(event)} className="space-y-4">
      <AdminError message={error} />
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <AdminSection
          icon={<Globe className="size-4" />}
          title="Basic details"
          description="Identity and how the panel reaches the daemon."
        >
          <Field label="Name" required>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            />
          </Field>
          <Field label="Location" required>
            <Select value={locationId} onChange={(event) => setLocationId(event.target.value)} required>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.shortCode.toUpperCase()}
                  {location.description ? ` — ${location.description}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description">
            <Textarea value={description} onChange={(event) => setDescription(event.target.value)} />
          </Field>
          <Field label="Visibility">
            <div className="grid grid-cols-2 rounded-lg border border-input bg-input/40 p-0.5">
              <button
                type="button"
                onClick={() => setIsPublic(true)}
                className={cn(
                  "inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium",
                  isPublic ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <Globe className="size-3.5" />
                Public
              </button>
              <button
                type="button"
                onClick={() => setIsPublic(false)}
                className={cn(
                  "inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium",
                  !isPublic ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                )}
              >
                <Lock className="size-3.5" />
                Private
              </button>
            </div>
          </Field>
          <Field label="FQDN" required>
            <Input value={fqdn} onChange={(event) => setFqdn(event.target.value)} required />
          </Field>
          <Field label="Connection">
            <div className="grid grid-cols-2 rounded-lg border border-input bg-input/40 p-0.5">
              {(["https", "http"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setScheme(value)}
                  className={cn(
                    "inline-flex h-9 items-center justify-center rounded-md text-sm font-medium",
                    scheme === value ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {value === "https" ? "SSL" : "HTTP"}
                </button>
              ))}
            </div>
          </Field>
          <div className="flex items-start justify-between gap-4 pt-1">
            <div>
              <p className="text-sm">Behind proxy</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Enable when running behind Cloudflare or a reverse proxy.
              </p>
            </div>
            <Switch checked={behindProxy} onChange={setBehindProxy} />
          </div>
        </AdminSection>

        <AdminSection
          icon={<Folder className="size-4" />}
          title="Daemon configuration"
          description="Resource limits, ports, and how this node serves files."
        >
          <Field label="Server file directory">
            <Input value={daemonBase} onChange={(event) => setDaemonBase(event.target.value)} required />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Memory">
              <UnitInput unit="GiB" type="number" min={1} step="0.5" required value={memoryGiB} onChange={(event) => setMemoryGiB(event.target.value)} />
            </Field>
            <Field label="Memory over-allocation">
              <UnitInput unit="%" type="number" min={-1} required value={memoryOverallocate} onChange={(event) => setMemoryOverallocate(event.target.value)} />
            </Field>
            <Field label="CPU cores">
              <UnitInput unit="cores" type="number" min={1} max={256} required value={cpuCores} onChange={(event) => setCpuCores(event.target.value)} />
            </Field>
            <Field label="Disk">
              <UnitInput unit="GiB" type="number" min={1} step="0.5" required value={diskGiB} onChange={(event) => setDiskGiB(event.target.value)} />
            </Field>
            <Field label="Disk over-allocation">
              <UnitInput unit="%" type="number" min={-1} required value={diskOverallocate} onChange={(event) => setDiskOverallocate(event.target.value)} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Daemon port">
              <Input type="number" min={1} max={65535} required value={daemonPort} onChange={(event) => setDaemonPort(event.target.value)} />
            </Field>
            <Field label="SFTP port">
              <Input type="number" min={1} max={65535} required value={sftpPort} onChange={(event) => setSftpPort(event.target.value)} />
            </Field>
          </div>
          <Field
            label="Maximum web upload filesize"
            hint="Applies to the Files tab for every server on this node."
          >
            <div className="flex items-center gap-2">
              <Upload className="size-4 text-muted-foreground" />
              <UnitInput
                unit="MB"
                type="number"
                min={1}
                max={2048}
                required
                value={uploadLimitMb}
                onChange={(event) => setUploadLimitMb(event.target.value)}
              />
            </div>
          </Field>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <p className="inline-flex items-center gap-2 text-sm font-medium">
                <ShieldAlert className="size-4 text-status-warn" />
                Maintenance mode
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Users still see their servers, but opening one shows a maintenance screen. Admins can still manage them.
              </p>
            </div>
            <Switch checked={maintenanceMode} onChange={setMaintenanceMode} />
          </div>
        </AdminSection>
      </div>
      <div className="flex justify-end">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}

function UnitInput({
  unit,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { unit: string }) {
  return (
    <div className="relative w-full">
      <Input className={cn("pr-12", className)} {...props} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}
