"use client";

import { useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import { Box, Center, Group, PasswordInput, Progress, Text } from "@mantine/core";
import { PASSWORD_MIN_LENGTH } from "@flutter-software/shared";
import { useAuth } from "@/components/auth-provider";
import { TwoFactorCard } from "@/components/two-factor-card";
import { Button, Card } from "@/components/ui";
import { api } from "@/lib/api";

function PasswordRequirement({ meets, label }: { meets: boolean; label: string }) {
  return (
    <Text component="div" c={meets ? "teal" : "red"} mt={5} size="sm">
      <Center inline>
        {meets ? <Check size={14} strokeWidth={1.5} /> : <X size={14} strokeWidth={1.5} />}
        <Box ml={7}>{label}</Box>
      </Center>
    </Text>
  );
}

const requirements = [
  { re: /[0-9]/, label: "Includes number" },
  { re: /[a-z]/, label: "Includes lowercase letter" },
  { re: /[A-Z]/, label: "Includes uppercase letter" },
  { re: /[$&+,:;=?@#|'<>.^*()%!-]/, label: "Includes special symbol" },
];

function getStrength(password: string) {
  let multiplier = password.length >= PASSWORD_MIN_LENGTH ? 0 : 1;
  for (const requirement of requirements) {
    if (!requirement.re.test(password)) multiplier += 1;
  }
  return Math.max(100 - (100 / (requirements.length + 1)) * multiplier, 0);
}

export default function AccountPage() {
  const { user, setUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const strength = getStrength(password);
  const strengthColor = strength > 80 ? "teal" : strength > 50 ? "yellow" : "red";

  async function onResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    setPending(true);
    try {
      await api("/api/v1/auth/password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, password, confirmPassword }),
      });
      setCurrentPassword("");
      setPassword("");
      setConfirmPassword("");
      setSuccess("Password updated. Other signed-in sessions have been signed out.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Profile for the signed-in panel user.
        </p>
      </div>
      <div className="grid items-start gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Profile</h2>
          <dl className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Username</dt>
              <dd>{user?.username ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Email</dt>
              <dd>{user?.email ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">Role</dt>
              <dd className="capitalize">{user?.role ?? "—"}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted-foreground">2FA</dt>
              <dd>{user?.totpEnabled ? "On" : "Off"}</dd>
            </div>
          </dl>
        </Card>
        <Card className="p-5">
          <h2 className="text-sm font-semibold">Reset password</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Choose a new password for this account. You will stay signed in here.
          </p>
          <form className="mt-4 space-y-4" onSubmit={(event) => void onResetPassword(event)}>
            <PasswordInput
              label="Current password"
              required
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.currentTarget.value)}
            />
            <div>
              <PasswordInput
                label="New password"
                required
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.currentTarget.value)}
                minLength={PASSWORD_MIN_LENGTH}
              />
              <Group gap={5} grow mt="xs" mb="md">
                {Array(4)
                  .fill(0)
                  .map((_, index) => (
                    <Progress
                      styles={{ section: { transitionDuration: "0ms" } }}
                      value={
                        password.length > 0 && index === 0
                          ? 100
                          : strength >= ((index + 1) / 4) * 100
                            ? 100
                            : 0
                      }
                      color={strengthColor}
                      key={index}
                      size={4}
                      aria-label={`Password strength segment ${index + 1}`}
                    />
                  ))}
              </Group>
              <PasswordRequirement
                label={`Has at least ${PASSWORD_MIN_LENGTH} characters`}
                meets={password.length >= PASSWORD_MIN_LENGTH}
              />
              {requirements.map((requirement) => (
                <PasswordRequirement
                  key={requirement.label}
                  label={requirement.label}
                  meets={requirement.re.test(password)}
                />
              ))}
            </div>
            <PasswordInput
              label="Confirm new password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.currentTarget.value)}
              minLength={PASSWORD_MIN_LENGTH}
            />
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {success ? <p className="text-sm text-status-running">{success}</p> : null}
            <Button type="submit" disabled={pending}>
              {pending ? "Updating…" : "Reset password"}
            </Button>
          </form>
        </Card>
        <TwoFactorCard enabled={Boolean(user?.totpEnabled)} onUser={setUser} />
      </div>
    </div>
  );
}
