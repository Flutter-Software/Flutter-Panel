"use client";

import { useEffect, useState } from "react";
import { Play, RotateCcw, Skull, Square } from "lucide-react";
import { Button, Modal } from "@/components/ui";
import type { ServerStatus } from "@/lib/types";

export function PowerButtons({
  status,
  canStart,
  canRestart,
  canStop,
  onPower,
}: {
  status?: ServerStatus;
  canStart: boolean;
  canRestart: boolean;
  canStop: boolean;
  onPower: (action: "start" | "stop" | "restart" | "kill") => void;
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

  return (
    <>
      <div className="flex gap-2">
        {canStart ? (
          <Button
            size="sm"
            variant="secondary"
            disabled={installing || starting || running || stopping}
            onClick={() => onPower("start")}
          >
            <Play className="size-3.5" />
            {starting ? "Starting…" : "Start"}
          </Button>
        ) : null}
        {canRestart ? (
          <Button size="sm" variant="secondary" disabled={!known} onClick={() => onPower("restart")}>
            <RotateCcw className="size-3.5" />
            Restart
          </Button>
        ) : null}
        {canStop ? (
          <Button
            size="sm"
            variant="danger"
            disabled={installing || offline}
            onClick={() => (stopping ? setKillOpen(true) : onPower("stop"))}
          >
            {stopping ? <Skull className="size-3.5" /> : <Square className="size-3.5" />}
            {stopping ? "Kill" : "Stop"}
          </Button>
        ) : null}
      </div>
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
