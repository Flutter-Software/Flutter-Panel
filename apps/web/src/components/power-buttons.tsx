"use client";

import { useEffect, useState } from "react";
import { Tooltip } from "@mantine/core";
import { Play, RotateCcw, Skull, Square, type LucideIcon } from "lucide-react";
import { Button, Modal } from "@/components/ui";
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

// Header controls are plain Rack buttons (3px corners, no tint, no shadow):
// status colour belongs to the LED, not the controls (DESIGN.md → Colour).
// Below `sm` they collapse to square icon buttons so the header fits a phone.
const HEADER_BUTTON = "shrink-0 max-sm:size-9 max-sm:px-0";

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
        // On the right, the header's own padding lines the buttons up with the page content.
        <div className="flex shrink-0 items-center gap-1.5">
          {visible.map(({ key, label, icon: Icon, disabled, onClick }) => (
            <Tooltip key={key} label={label} position="bottom" transitionProps={{ duration: 0 }}>
              <Button
                variant={key === "stop" ? "danger" : "secondary"}
                className={HEADER_BUTTON}
                disabled={disabled}
                aria-label={label}
                onClick={onClick}
              >
                <Icon className="size-4" aria-hidden />
                <span className="max-sm:sr-only">{label}</span>
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
        title="Kill the server process?"
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
              Kill process
            </Button>
          </>
        }
      >
        <p className="text-sm text-muted-foreground">
          The server is still stopping. Killing the process ends it immediately and can corrupt world or save
          data that hasn&apos;t been written yet.
        </p>
      </Modal>
    </>
  );
}
