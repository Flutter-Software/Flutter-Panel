"use client";

import { useEffect, useState } from "react";
import { Tooltip } from "@mantine/core";
import { Play, RotateCcw, Skull, Square, type LucideIcon } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import { cn } from "@/lib/cn";
import type { ServerStatus } from "@/lib/types";

export type PowerAction = "start" | "stop" | "restart" | "kill";

type PowerControl = {
  key: string;
  show: boolean;
  label: string;
  icon: LucideIcon;
  variant: "secondary" | "danger";
  disabled: boolean;
  onClick: () => void;
};

// An explicit size, not aspect-ratio with stretch: a stretched square's width
// isn't counted when its row is measured, which pushes the buttons off-screen.
// 60px leaves 6px above and below inside the 72px header.
const HEADER_BUTTON =
  "no-press size-10 shrink-0 border px-0 disabled:opacity-60 disabled:grayscale sm:size-[60px]";

// Status colors with a tinted fill and border stand out on the dark header.
const HEADER_TONES: Record<string, string> = {
  start: "border-status-running/50 bg-status-running/15 text-status-running hover:bg-status-running/25",
  restart: "border-status-warn/50 bg-status-warn/15 text-status-warn hover:bg-status-warn/25",
  stop: "border-destructive/60 bg-destructive/20 text-destructive hover:bg-destructive/30",
};

export function PowerButtons({
  status,
  canStart,
  canRestart,
  canStop,
  onPower,
  variant = "standard",
}: {
  status?: ServerStatus;
  canStart: boolean;
  canRestart: boolean;
  canStop: boolean;
  onPower: (action: PowerAction) => void;
  variant?: "standard" | "header";
}) {
  const [killOpen, setKillOpen] = useState(false);
  const installing = status === "installing";
  const starting = status === "starting";
  const stopping = status === "stopping";
  const running = status === "running";
  const offline = status === "offline" || status === "install_failed" || !status;
  const known = Boolean(status) && !installing;

  useEffect(() => {
    if (offline) setKillOpen(false);
  }, [offline]);

  const controls: PowerControl[] = [
    {
      key: "start",
      show: canStart,
      label: starting ? "Starting…" : "Start",
      icon: Play,
      variant: "secondary",
      disabled: installing || starting || running || stopping,
      onClick: () => onPower("start"),
    },
    {
      key: "restart",
      show: canRestart,
      label: "Restart",
      icon: RotateCcw,
      variant: "secondary",
      disabled: !known,
      onClick: () => onPower("restart"),
    },
    {
      key: "stop",
      show: canStop,
      label: stopping ? "Kill" : "Stop",
      icon: stopping ? Skull : Square,
      variant: "danger",
      disabled: installing || offline,
      onClick: () => (stopping ? setKillOpen(true) : onPower("stop")),
    },
  ];
  const visible = controls.filter((control) => control.show);

  return (
    <>
      {variant === "header" ? (
        // The vertical margin leaves a small gap above and below. On the right,
        // the header's own padding lines the buttons up with the page content.
        <div className="flex shrink-0 gap-1.5 sm:-my-1">
          {visible.map(({ key, label, icon: Icon, disabled, onClick }) => (
            <Tooltip key={key} label={label} position="bottom" transitionProps={{ duration: 0 }}>
              <Button
                size="sm"
                variant="ghost"
                className={cn(HEADER_BUTTON, HEADER_TONES[key])}
                disabled={disabled}
                aria-label={label}
                onClick={onClick}
              >
                <Icon className="size-5 sm:size-6" strokeWidth={2.25} aria-hidden />
              </Button>
            </Tooltip>
          ))}
        </div>
      ) : (
        <div className="flex gap-2">
          {visible.map(({ key, label, icon: Icon, variant: tone, disabled, onClick }) => (
            <Button key={key} size="sm" variant={tone} disabled={disabled} onClick={onClick}>
              <Icon className="size-3.5" />
              {label}
            </Button>
          ))}
        </div>
      )}
      <Modal
        title="Forcibly Stop Process"
        open={killOpen}
        onClose={() => setKillOpen(false)}
        className="max-w-md"
        footer={
          <>
            <Button size="sm" variant="secondary" onClick={() => setKillOpen(false)}>
              Cancel
            </Button>
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setKillOpen(false);
                onPower("kill");
              }}
            >
              Continue
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          Forcibly stopping a server can lead to data corruption.
        </p>
      </Modal>
    </>
  );
}
