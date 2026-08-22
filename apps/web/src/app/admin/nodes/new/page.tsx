"use client";

import { useMemo, useState, type FormEvent, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  Copy,
  Cpu,
  Folder,
  Globe,
  HardDrive,
  Lock,
  MemoryStick,
  Rocket,
  Server,
} from "lucide-react";
import { AdminError } from "@/components/admin-table";
import { AdminCreateFooter } from "@/components/admin-create";
import { Button, ButtonLink, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { cn } from "@/lib/cn";
import { api } from "@/lib/api";
import { useQuery } from "@/lib/query";

type Location = { id: string; shortCode: string; description: string };

export default function CreateNodePage() {
  const { data, error: loadError } = useQuery<{ data: { locations: Location[] } }>(
    "/api/v1/admin/locations",
  );
  const locations = data?.data.locations ?? [];
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [created, setCreated] = useState<{
    id: string;
    token: string;
    configure: string;
    start: string;
  } | null>(null);
  const [copied, setCopied] = useState<"token" | "configure" | "start" | null>(null);

  const [name, setName] = useState("");
  const [locationId, setLocationId] = useState("");
  const [description, setDescription] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [fqdn, setFqdn] = useState("");
  const [scheme, setScheme] = useState<"https" | "http">("https");
  const [behindProxy, setBehindProxy] = useState(false);
  const [daemonBase, setDaemonBase] = useState("/var/lib/flutter/volumes");
  const [memoryGiB, setMemoryGiB] = useState("64");
  const [cpuCores, setCpuCores] = useState("8");
  const [memoryOverallocate, setMemoryOverallocate] = useState("0");
  const [diskGiB, setDiskGiB] = useState("1024");
  const [diskOverallocate, setDiskOverallocate] = useState("0");
  const [daemonPort, setDaemonPort] = useState("8080");
  const [sftpPort, setSftpPort] = useState("2022");
  const [uploadLimitMb, setUploadLimitMb] = useState("250");
  const [maintenanceMode, setMaintenanceMode] = useState(false);
  const resolvedLocationId = locationId || locations[0]?.id || "";

  const selectedLocation = useMemo(
    () => locations.find((location) => location.id === resolvedLocationId),
    [locations, resolvedLocationId],
  );

  const dirty =
    name.trim() !== "" ||
    description.trim() !== "" ||
    fqdn.trim() !== "" ||
    !isPublic ||
    scheme !== "https" ||
    behindProxy ||
    daemonBase !== "/var/lib/flutter/volumes" ||
    memoryGiB !== "64" ||
    cpuCores !== "8" ||
    memoryOverallocate !== "0" ||
    diskGiB !== "1024" ||
    diskOverallocate !== "0" ||
    daemonPort !== "8080" ||
    sftpPort !== "2022" ||
    uploadLimitMb !== "250" ||
    maintenanceMode;

  async function copy(value: string, key: "token" | "configure" | "start") {
    await navigator.clipboard.writeText(value);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1500);
  }

  async function onCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    try {
      const result = await api<{
        data: { token: string; configure: string; start?: string; node: { id: string } };
      }>(
        "/api/v1/admin/nodes",
        {
          method: "POST",
          body: JSON.stringify({
            locationId: resolvedLocationId,
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
        },
      );
      setCreated({
        id: result.data.node.id,
        token: result.data.token,
        configure: result.data.configure,
        start: result.data.start || "npm run dev:daemon",
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Create failed");
    } finally {
      setPending(false);
    }
  }

  if (created) {
    return (
      <div className="mx-auto w-full max-w-6xl space-y-6">
        <PageIntro title="Node created" />
        <Card className="space-y-4 border-primary/30 bg-primary/5 p-5 sm:p-6">
          <p className="text-sm text-muted-foreground">
            Save the daemon token now. It will not be shown again. Configure writes the config file;
            the node stays offline until you start the daemon.
          </p>
          <CopyRow
            label="Token"
            value={created.token}
            copied={copied === "token"}
            onCopy={() => copy(created.token, "token")}
          />
          <CopyRow
            label="Configure"
            value={created.configure}
            copied={copied === "configure"}
            onCopy={() => copy(created.configure, "configure")}
          />
          <CopyRow
            label="Start daemon"
            value={created.start}
            copied={copied === "start"}
            onCopy={() => copy(created.start, "start")}
          />
          <div className="flex flex-wrap gap-2 pt-2">
            <ButtonLink href={`/admin/nodes/${created.id}`}>View node</ButtonLink>
            <ButtonLink href={`/admin/nodes/${created.id}/allocations/new`} variant="secondary">
              Add allocations
            </ButtonLink>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <form onSubmit={onCreate} className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-6">
      <PageIntro />
      <AdminError message={error ?? loadError} />

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Section
          icon={<Globe className="size-4" />}
          title="Basic details"
          description="Identity and how the panel reaches the daemon."
        >
          <Field label="Name" required hint="1–100 chars: a–z, 0–9, dashes.">
            <Input
              name="name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="lon-01"
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
            />
          </Field>
          <Field label="Location" required>
            <Select
              name="locationId"
              required
              value={resolvedLocationId}
              onChange={(event) => setLocationId(event.target.value)}
            >
              <option value="">Select location</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.shortCode.toUpperCase()}
                  {location.description ? ` — ${location.description}` : ""}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Description" hint="Optional. Shown to admins on the node list.">
            <Textarea
              name="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="London metal — Ryzen 9, NVMe."
            />
          </Field>
          <Field label="Visibility" hint="Private nodes are skipped by auto-deploy.">
            <Segmented
              value={isPublic ? "public" : "private"}
              onChange={(value) => setIsPublic(value === "public")}
              options={[
                { value: "public", label: "Public", icon: <Globe className="size-3.5" /> },
                { value: "private", label: "Private", icon: <Lock className="size-3.5" /> },
              ]}
            />
          </Field>
          <Field
            label="FQDN"
            required
            hint="Domain used to connect to the daemon. An IP may be used only if not using SSL."
          >
            <Input
              name="fqdn"
              value={fqdn}
              onChange={(event) => setFqdn(event.target.value)}
              placeholder="node-lon.flutter.local"
              required
            />
          </Field>
          <Field label="Connection" hint="The panel uses HTTPS, so the daemon must serve SSL.">
            <Segmented
              value={scheme}
              onChange={setScheme}
              options={[
                { value: "https", label: "SSL" },
                { value: "http", label: "HTTP" },
              ]}
            />
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
        </Section>

        <Section
          icon={<Folder className="size-4" />}
          title="Daemon configuration"
          description="Resource limits and ports the daemon will advertise."
        >
          <Field
            label="Server file directory"
            hint="Where server volumes are stored on the host filesystem."
          >
            <Input
              name="daemonBase"
              value={daemonBase}
              onChange={(event) => setDaemonBase(event.target.value)}
              required
            />
          </Field>

          <ResourceBlock icon={<MemoryStick className="size-4" />} title="Memory">
            <Field label="Total">
              <UnitInput
                unit="GiB"
                type="number"
                min={1}
                required
                value={memoryGiB}
                onChange={(event) => setMemoryGiB(event.target.value)}
              />
            </Field>
            <Field label="Over-allocation" hint="-1 disables the check.">
              <UnitInput
                unit="%"
                type="number"
                min={-1}
                required
                value={memoryOverallocate}
                onChange={(event) => setMemoryOverallocate(event.target.value)}
              />
            </Field>
          </ResourceBlock>

          <ResourceBlock icon={<Cpu className="size-4" />} title="CPU">
            <Field label="Cores">
              <UnitInput
                unit="cores"
                type="number"
                min={1}
                max={256}
                required
                value={cpuCores}
                onChange={(event) => setCpuCores(event.target.value)}
              />
            </Field>
          </ResourceBlock>

          <ResourceBlock icon={<HardDrive className="size-4" />} title="Disk">
            <Field label="Total">
              <UnitInput
                unit="GiB"
                type="number"
                min={1}
                required
                value={diskGiB}
                onChange={(event) => setDiskGiB(event.target.value)}
              />
            </Field>
            <Field label="Over-allocation" hint="-1 disables the check.">
              <UnitInput
                unit="%"
                type="number"
                min={-1}
                required
                value={diskOverallocate}
                onChange={(event) => setDiskOverallocate(event.target.value)}
              />
            </Field>
          </ResourceBlock>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Daemon port" hint="Default 8080.">
              <Input
                type="number"
                min={1}
                max={65535}
                required
                value={daemonPort}
                onChange={(event) => setDaemonPort(event.target.value)}
              />
            </Field>
            <Field label="SFTP port" hint="Default 2022.">
              <Input
                type="number"
                min={1}
                max={65535}
                required
                value={sftpPort}
                onChange={(event) => setSftpPort(event.target.value)}
              />
            </Field>
          </div>
          <Field
            label="Maximum web upload filesize"
            hint="Applies to the Files tab for every server on this node."
          >
            <UnitInput
              unit="MB"
              type="number"
              min={1}
              max={2048}
              required
              value={uploadLimitMb}
              onChange={(event) => setUploadLimitMb(event.target.value)}
            />
          </Field>
          <div className="flex items-start justify-between gap-4 rounded-lg border border-border p-4">
            <div>
              <p className="text-sm font-medium">Maintenance mode</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Users can see servers on this node but cannot open them.
              </p>
            </div>
            <Switch checked={maintenanceMode} onChange={setMaintenanceMode} />
          </div>
        </Section>
      </div>

      <AdminCreateFooter
        visible={dirty}
        cancelHref="/admin/nodes"
        submitLabel="Create node"
        pending={pending}
        pendingLabel="Creating…"
        disabled={locations.length === 0}
        summary={
          <span className="inline-flex items-center gap-2">
            <Rocket className="size-4 text-primary" />
            <span>
              Deploying <span className="font-medium text-foreground">{name || "node"}</span> in{" "}
              <span className="font-medium text-foreground">
                {selectedLocation?.shortCode.toUpperCase() || "—"}
              </span>{" "}
              over{" "}
              <span className="font-medium text-foreground">
                {scheme === "https" ? "SSL" : "HTTP"}
              </span>
              .
            </span>
          </span>
        }
      />
    </form>
  );
}

function PageIntro({ title = "New node" }: { title?: string }) {
  return (
    <div>
      <Link
        href="/admin/nodes"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to nodes
      </Link>
      <p className="mt-3 text-xs text-muted-foreground">
        <Link href="/admin" className="hover:text-foreground">
          Admin
        </Link>
        {" / "}
        <Link href="/admin/nodes" className="hover:text-foreground">
          Nodes
        </Link>
        {" / "}
        <span className="text-foreground">New</span>
      </p>
      <div className="mt-3 flex items-center gap-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Server className="size-4" />
        </span>
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        Register a daemon host. Allocations and servers are assigned once the node reports its first
        heartbeat.
      </p>
    </div>
  );
}

function Section({
  icon,
  title,
  description,
  children,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Card className="p-5 sm:p-6">
      <div className="mb-5 flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          {icon}
        </div>
        <div>
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>
        </div>
      </div>
      <div className="space-y-4">{children}</div>
    </Card>
  );
}

function ResourceBlock({
  icon,
  title,
  children,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 text-sm font-medium">
        <span className="text-muted-foreground">{icon}</span>
        {title}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function UnitInput({
  unit,
  className,
  ...props
}: React.ComponentProps<typeof Input> & { unit: string }) {
  return (
    <div className="relative">
      <Input className={cn("pr-12", className)} {...props} />
      <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
        {unit}
      </span>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (value: T) => void;
  options: { value: T; label: string; icon?: ReactNode }[];
}) {
  return (
    <div className="grid grid-cols-2 rounded-lg border border-input bg-input/40 p-0.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "inline-flex h-9 items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors",
            value === option.value
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Switch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors",
        checked ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        className={cn(
          "absolute top-0.5 left-0.5 block size-5 rounded-full bg-card transition-transform",
          checked && "translate-x-5",
        )}
      />
    </button>
  );
}

function CopyRow({
  label,
  value,
  copied,
  onCopy,
}: {
  label: string;
  value: string;
  copied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        <Button type="button" size="sm" variant="ghost" onClick={onCopy}>
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="overflow-x-auto rounded-lg border border-border bg-background px-3 py-2 font-mono text-xs leading-relaxed">
        {value}
      </pre>
    </div>
  );
}
