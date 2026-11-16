"use client";

import { useState, type FormEvent } from "react";
import { Check, X } from "lucide-react";
import { Box, Center, Group, PasswordInput, Progress, Text } from "@mantine/core";
import { PASSWORD_MIN_LENGTH } from "@flutter-software/shared";
import { useAuth } from "@/components/auth-provider";
import { TwoFactorCard } from "@/components/two-factor-card";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import { SettingsFooter, SettingsMessage, SettingsPanel, SettingsRow, SettingsSection } from "../settings-nav";

function PasswordRequirement({ meets, label }: { meets: boolean; label: string }) {
  return (
    <Text component="div" c={meets ? "var(--status-running)" : "var(--muted-foreground)"} mt={4} size="13px">
      <Center inline>
        {meets ? <Check size={14} strokeWidth={1.5} /> : <X size={14} strokeWidth={1.5} />}
        <Box ml={7}>{label}</Box>
      </Center>
    </Text>
  );
}

const requirements = [
  { re: /[0-9]/, label: "A number" },
  { re: /[a-z]/, label: "A lowercase letter" },
  { re: /[A-Z]/, label: "An uppercase letter" },
  { re: /[$&+,:;=?@#|'<>.^*()%!-]/, label: "A symbol, such as ! or #" },
];

function getStrength(password: string) {
  let multiplier = password.length >= PASSWORD_MIN_LENGTH ? 0 : 1;
  for (const requirement of requirements) {
    if (!requirement.re.test(password)) multiplier += 1;
  }
  return Math.max(100 - (100 / (requirements.length + 1)) * multiplier, 0);
}

export default function AccountSecurityPage() {
  const { user, setUser } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  const strength = getStrength(password);
  // Status colours, so the meter reads like the rest of the panel's meters.
  const strengthColor =
    strength > 80 ? "var(--status-running)" : strength > 50 ? "var(--status-warn)" : "var(--status-error)";
  const showRequirements = passwordFocused || password.length > 0;

  async function onResetPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    if (password !== confirmPassword) {
      setError("The two new passwords don't match. Type the same password in both boxes.");
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
      setSuccess("Password changed. Your other sessions were signed out.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset password");
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsSection title="Security" description="Your password and two-factor authentication.">
      {/* Marker read by globals.css to hide the scrollbar of the shared <main>. */}
      <span hidden data-hide-page-scrollbar />
      <form onSubmit={(event) => void onResetPassword(event)}>
        <SettingsPanel>
          <SettingsRow
            title="Change password"
            description="You stay signed in here. Every other session is signed out."
          >
            <div className="space-y-4">
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
                  onFocus={() => setPasswordFocused(true)}
                  onBlur={() => setPasswordFocused(false)}
                  minLength={PASSWORD_MIN_LENGTH}
                />
                {showRequirements ? (
                  <>
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
                    <p className="text-[13px] text-muted-foreground">A strong password has:</p>
                    <PasswordRequirement
                      label={`At least ${PASSWORD_MIN_LENGTH} characters`}
                      meets={password.length >= PASSWORD_MIN_LENGTH}
                    />
                    {requirements.map((requirement) => (
                      <PasswordRequirement
                        key={requirement.label}
                        label={requirement.label}
                        meets={requirement.re.test(password)}
                      />
                    ))}
                  </>
                ) : null}
              </div>
              <PasswordInput
                label="Confirm new password"
                required
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.currentTarget.value)}
                minLength={PASSWORD_MIN_LENGTH}
              />
            </div>
          </SettingsRow>
          <SettingsFooter message={<SettingsMessage error={error} success={success} />}>
            <Button type="submit" disabled={pending}>
              {pending ? "Changing password…" : "Change password"}
            </Button>
          </SettingsFooter>
        </SettingsPanel>
      </form>
      <TwoFactorCard enabled={Boolean(user?.totpEnabled)} onUser={setUser} />
    </SettingsSection>
  );
}
