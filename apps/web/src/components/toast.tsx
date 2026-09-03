"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

type ToastItem = {
  id: number;
  message: string;
  variant: "error" | "info";
  leaving?: boolean;
};

let pushToast: (message: string, variant?: ToastItem["variant"]) => void = () => {};
let nextId = 1;

export function toast(message: string, variant: ToastItem["variant"] = "error") {
  pushToast(message, variant);
}

const SHOW_MS = 4500;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<number[]>([]);

  const remove = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const dismiss = useCallback((id: number) => {
    setItems((current) => {
      if (current.some((item) => item.id === id && item.leaving)) return current;
      return current.map((item) => (item.id === id ? { ...item, leaving: true } : item));
    });
  }, []);

  const push = useCallback(
    (message: string, variant: ToastItem["variant"] = "error") => {
      const id = nextId;
      nextId += 1;
      setItems((current) => [...current.filter((item) => !item.leaving).slice(-3), { id, message, variant }]);
      const timer = window.setTimeout(() => dismiss(id), SHOW_MS);
      timers.current.push(timer);
    },
    [dismiss],
  );

  useEffect(() => {
    pushToast = push;
    return () => {
      pushToast = () => {};
      for (const timer of timers.current) window.clearTimeout(timer);
    };
  }, [push]);

  return (
    <>
      {children}
      {items.length > 0 ? (
        <div className="pointer-events-none fixed top-20 right-4 z-50 flex w-[min(100%-2rem,22rem)] flex-col gap-2">
          {items.map((item) => (
            <div
              key={item.id}
              className={cn(
                "pointer-events-auto flex origin-top-right items-start gap-3 rounded-lg border bg-card px-3 py-2.5 text-sm shadow-lg",
                item.variant === "error" ? "border-destructive/40 text-destructive" : "border-border text-foreground",
                item.leaving ? "flutter-toast-out" : "flutter-toast-in",
              )}
              role="status"
              onAnimationEnd={(event) => {
                if (event.target !== event.currentTarget) return;
                if (item.leaving) remove(item.id);
              }}
            >
              <p className="min-w-0 flex-1">{item.message}</p>
              <button
                type="button"
                className="no-press -mr-1 rounded-md p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Dismiss"
                onClick={() => dismiss(item.id)}
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </>
  );
}
