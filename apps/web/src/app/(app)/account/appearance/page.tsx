"use client";

import type { ComponentType } from "react";
import { LayoutList, Moon, PanelTop, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { Switch } from "@/components/admin-create";
import { useMotion } from "@/components/motion-provider";
import { useSmoothTheme } from "@/components/theme-provider";
import { setPowerLayout, usePowerLayout } from "@/components/use-power-layout";
import { cn } from "@/lib/cn";
import { SettingsPanel, SettingsRow, SettingsSection } from "../settings-nav";

const THEMES = [
  { id: "dark", label: "Dark", icon: Moon, hint: "Graphite surfaces. The default." },
  { id: "light", label: "Light", icon: Sun, hint: "Pale surfaces, dark text." },
] as const;

// No "system" option — ThemeProvider has enableSystem={false}.

const POWER_LAYOUTS = [
  { id: "standard", label: "Above the console", icon: LayoutList, hint: "Labelled Start, Restart and Stop buttons." },
  { id: "header", label: "In the server header", icon: PanelTop, hint: "Icon buttons, on every server page." },
] as const;

/**
 * A pick-one group drawn as a row of options. Each option is a radio-style
 * button: a seam outline, and a cyan outline plus filled dot when chosen.
 */
function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string | undefined;
  options: readonly { id: T; label: string; hint: string; icon: ComponentType<{ className?: string }> }[];
  onChange: (id: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="grid gap-2 sm:grid-cols-2">
      {options.map((option) => {
        const Icon = option.icon;
        const active = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.id)}
            className={cn(
              "flex items-start gap-3 rounded-md border px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active ? "border-primary bg-primary/[0.06]" : "border-input hover:border-muted-foreground/50",
            )}
          >
            <Icon className={cn("mt-0.5 size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")} />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{option.label}</span>
              <span className="mt-0.5 block text-[13px] text-muted-foreground">{option.hint}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function AccountAppearancePage() {
  const { theme } = useTheme();
  const switchTheme = useSmoothTheme();
  const { enabled: motionEnabled, setEnabled: setMotionEnabled } = useMotion();
  const powerLayout = usePowerLayout();

  return (
    <SettingsSection
      title="Appearance"
      description="How the panel looks in this browser. These settings aren't synced to your other devices."
    >
      <SettingsPanel>
        <SettingsRow title="Theme" description="The sun and moon button in the top bar switches this too.">
          <ChoiceGroup label="Theme" value={theme} options={THEMES} onChange={(id) => switchTheme(id)} />
        </SettingsRow>
        <SettingsRow title="Power buttons" description="Where Start, Restart and Stop sit on a server page.">
          <ChoiceGroup
            label="Power buttons"
            value={powerLayout}
            options={POWER_LAYOUTS}
            onChange={(id) => setPowerLayout(id)}
          />
        </SettingsRow>
        <SettingsRow
          title="Smooth transitions"
          description="Fade colours and theme changes. Turn off for instant changes and no pulsing status lights."
        >
          {/* Switch has no label prop; a wrapping <label> names it for screen readers. */}
          <label className="flex md:justify-end">
            <span className="sr-only">Smooth transitions</span>
            <Switch checked={motionEnabled} onChange={setMotionEnabled} />
          </label>
        </SettingsRow>
      </SettingsPanel>
    </SettingsSection>
  );
}
