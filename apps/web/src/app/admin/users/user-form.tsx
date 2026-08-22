"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff, Shield, UserRound } from "lucide-react";
import { AdminError } from "@/components/admin-table";
import {
  AdminCreateFooter,
  AdminCreateHeader,
  AdminSection,
  Segmented,
} from "@/components/admin-create";
import { Button, Field, Input } from "@/components/ui";
import { api } from "@/lib/api";
import { PASSWORD_MIN_LENGTH, type PublicUser } from "@flutter-software/shared";

export function UserForm({
  mode,
  initial,
}: {
  mode: "create" | "edit";
  initial?: PublicUser;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [username, setUsername] = useState(initial?.username ?? "");
  const [email, setEmail] = useState(initial?.email ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [role, setRole] = useState<"user" | "admin">(initial?.role ?? "user");
  const [showPassword, setShowPassword] = useState(false);

  const creating = mode === "create";
  const dirty =
    username !== (initial?.username ?? "") ||
    email !== (initial?.email ?? "") ||
    password !== "" ||
    confirm !== "" ||
    role !== (initial?.role ?? "user");

  function generatePassword() {
    const chars = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%";
    const bytes = new Uint8Array(18);
    crypto.getRandomValues(bytes);
    const next = Array.from(bytes, (value) => chars[value % chars.length]).join("");
    setPassword(next);
    setConfirm(next);
    setShowPassword(true);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password || confirm) {
      if (password !== confirm) {
        setError("Passwords do not match");
        return;
      }
    } else if (creating) {
      setError("Password is required");
      return;
    }
    setPending(true);
    try {
      const body = {
        username: username.trim(),
        email: email.trim(),
        role: role,
        ...(password ? { password } : {}),
      };
      if (creating) {
        await api("/api/v1/admin/users", {
          method: "POST",
          body: JSON.stringify({ ...body, password }),
        });
      } else if (initial) {
        await api(`/api/v1/admin/users/${initial.id}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      }
      router.push("/admin/users");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : creating ? "Create failed" : "Save failed");
      setPending(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mx-auto flex w-full max-w-6xl flex-col gap-6 pb-6">
      <AdminCreateHeader
        backHref="/admin/users"
        backLabel="Back to users"
        crumbs={[
          { href: "/admin", label: "Admin" },
          { href: "/admin/users", label: "Users" },
          { label: creating ? "New" : initial?.username ?? "Edit" },
        ]}
        icon={<UserRound className="size-4" />}
        title={creating ? "New user" : `Edit ${initial?.username ?? "user"}`}
        description={
          creating
            ? "Create a panel account. Admins can manage nodes, eggs, and every server."
            : "Update this account. Leave the password blank to keep the current one."
        }
      />
      <AdminError message={error} />

      <div className="grid items-start gap-4 xl:grid-cols-2">
        <AdminSection
          icon={<UserRound className="size-4" />}
          title="Account details"
          description="Identity used to sign in to the panel."
        >
          <Field label="Username" required hint="3–32 chars: letters, numbers, and underscores.">
            <Input
              name="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              placeholder="phoenix"
              required
              minLength={3}
              maxLength={32}
              pattern="[a-zA-Z0-9_]+"
              autoComplete="username"
            />
          </Field>
          <Field label="Email" required hint="Used for login and account recovery.">
            <Input
              name="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="phoenix@example.com"
              required
              autoComplete="email"
            />
          </Field>
          <Field
            label="Password"
            required={creating}
            hint={
              creating
                ? `At least ${PASSWORD_MIN_LENGTH} characters.`
                : `Leave blank to keep the current password. At least ${PASSWORD_MIN_LENGTH} characters if changing.`
            }
            extra={
              <Button type="button" size="sm" variant="ghost" onClick={generatePassword}>
                Generate
              </Button>
            }
          >
            <div className="relative">
              <Input
                name="password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required={creating}
                minLength={creating ? PASSWORD_MIN_LENGTH : undefined}
                autoComplete="new-password"
                className="pr-10"
              />
              <button
                type="button"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:text-foreground"
                onClick={() => setShowPassword((value) => !value)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
              </button>
            </div>
          </Field>
          <Field label="Confirm password" required={creating}>
            <Input
              name="confirm"
              type={showPassword ? "text" : "password"}
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              required={creating}
              minLength={creating ? PASSWORD_MIN_LENGTH : undefined}
              autoComplete="new-password"
            />
          </Field>
        </AdminSection>

        <AdminSection
          icon={<Shield className="size-4" />}
          title="Permissions"
          description="What this account can access in the panel."
        >
          <Segmented
            value={role}
            onChange={setRole}
            options={[
              { value: "user", label: "User", icon: <UserRound className="size-3.5" /> },
              { value: "admin", label: "Admin", icon: <Shield className="size-3.5" /> },
            ]}
          />
          <p className="text-sm text-muted-foreground">
            {role === "admin"
              ? "Admins can create locations, nodes, eggs, servers, and other users. Full access to the panel."
              : "Users can sign in and manage only the servers assigned to this account."}
          </p>
        </AdminSection>
      </div>

      <AdminCreateFooter
        visible={creating || dirty || pending}
        cancelHref="/admin/users"
        submitLabel={creating ? "Create user" : "Save changes"}
        pendingLabel={creating ? "Creating…" : "Saving…"}
        pending={pending}
        summary={
          <span className="inline-flex items-center gap-2">
            <UserRound className="size-4 text-primary" />
            <span>
              {creating ? "Creating" : "Saving"}{" "}
              <span className="font-medium text-foreground">{username || "user"}</span> as{" "}
              <span className="font-medium text-foreground">{role}</span>.
            </span>
          </span>
        }
      />
    </form>
  );
}
