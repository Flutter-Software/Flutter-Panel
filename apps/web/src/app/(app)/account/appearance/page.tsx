"use client";

import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Switch } from "@/components/admin-create";
import { useMotion } from "@/components/motion-provider";
import { Card } from "@/components/ui";
import { cn } from "@/lib/cn";
import { SettingsSection } from "../settings-nav";

const THEMES = [
  { id: "dark", label: "Dark", icon: Moon, hint: "Default for the panel." },
  { id: "light", label: "Light", icon: Sun, hint: "Brighter surfaces and text." },
] as const;

// No "system" option — ThemeProvider has enableSystem={false}.

export default function AccountAppearancePage() {
  const { theme, setTheme } = useTheme();
  const { enabled: motionEnabled, setEnabled: setMotionEnabled } = useMotion();

  return (
    <SettingsSection title="Appearance" description="Choose how Flutter looks on this device.">
      <Card className="p-5 sm:p-6">
        <h3 className="text-sm font-semibold">Theme</h3>
        <p className="mt-1 text-sm text-muted-foreground">Saved in this browser only.</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {THEMES.map((option) => {
            const Icon = option.icon;
            const active = theme === option.id;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => setTheme(option.id)}
                className={cn(
                  "flex items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors",
                  active
                    ? "border-primary bg-primary/10"
                    : "border-border hover:border-primary/40 hover:bg-muted/40",
                )}
              >
                <Icon className={cn("mt-0.5 size-4", active ? "text-primary" : "text-muted-foreground")} />
                <span>
                  <span className="block text-sm font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{option.hint}</span>
                </span>
              </button>
            );
          })}
        </div>
        <p className="mt-4 inline-flex items-center gap-2 text-xs text-muted-foreground">
          <Monitor className="size-3.5" />
          The top bar sun/moon control switches the same setting.
        </p>
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="text-sm font-semibold">Smooth transitions</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Animate colors, hovers, and theme changes. Turn off for a snappier UI.
            </p>
          </div>
          <Switch checked={motionEnabled} onChange={setMotionEnabled} />
        </div>
      </Card>
    </SettingsSection>
  );
}
