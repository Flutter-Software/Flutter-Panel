"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Modal } from "@/components/ui";

export type ConfirmOptions = {
  title?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type Pending = ConfirmOptions & { resolve: (value: boolean) => void };

let ask: (options: ConfirmOptions) => Promise<boolean> = async (options) =>
  typeof window !== "undefined" ? window.confirm(options.description) : false;

export function confirm(options: ConfirmOptions | string): Promise<boolean> {
  const resolved: ConfirmOptions = typeof options === "string" ? { description: options } : options;
  return ask(resolved);
}

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  pendingRef.current = pending;

  const request = useCallback((options: ConfirmOptions) => {
    pendingRef.current?.resolve(false);
    return new Promise<boolean>((resolve) => {
      const next = { ...options, resolve };
      pendingRef.current = next;
      setPending(next);
    });
  }, []);

  useEffect(() => {
    ask = request;
    return () => {
      ask = async (options) =>
        typeof window !== "undefined" ? window.confirm(options.description) : false;
    };
  }, [request]);

  function close(value: boolean) {
    pendingRef.current?.resolve(value);
    pendingRef.current = null;
    setPending(null);
  }

  const danger = pending?.danger ?? true;

  useEffect(() => {
    if (!pending) return;
    const frame = requestAnimationFrame(() => actionRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [pending]);

  return (
    <>
      {children}
      <Modal
        title={pending?.title ?? "Are you sure?"}
        open={Boolean(pending)}
        onClose={() => close(false)}
        className="max-w-md transition duration-200 starting:scale-95 starting:opacity-0"
        footer={
          pending ? (
            <>
              <Button size="sm" variant="secondary" onClick={() => close(false)}>
                {pending.cancelLabel ?? "Cancel"}
              </Button>
              <Button
                ref={actionRef}
                size="sm"
                variant={danger ? "danger" : "primary"}
                onClick={() => close(true)}
              >
                {pending.confirmLabel ?? "Continue"}
              </Button>
            </>
          ) : null
        }
      >
        <p className="text-sm text-muted-foreground">{pending?.description}</p>
      </Modal>
    </>
  );
}
