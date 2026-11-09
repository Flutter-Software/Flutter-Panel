"use client";

import { useSyncExternalStore } from "react";
import { POWER_LAYOUT_ATTR, POWER_LAYOUT_STORAGE_KEY, type PowerLayout } from "@/lib/power-layout";

// The <html> attribute is the source of truth: the bootstrap script sets it
// from localStorage before React loads, and CSS reads it to avoid a flash.
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((listener) => listener());
}

function applyAttribute(layout: PowerLayout) {
  document.documentElement.setAttribute(POWER_LAYOUT_ATTR, layout);
}

/** Keeps other open tabs in step when the setting changes. */
function onStorage(event: StorageEvent) {
  if (event.key !== POWER_LAYOUT_STORAGE_KEY) return;
  applyAttribute(event.newValue === "header" ? "header" : "standard");
  notify();
}

function subscribe(listener: () => void) {
  if (listeners.size === 0) window.addEventListener("storage", onStorage);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener("storage", onStorage);
  };
}

function readLayout(): PowerLayout {
  return document.documentElement.getAttribute(POWER_LAYOUT_ATTR) === "header" ? "header" : "standard";
}

export function usePowerLayout() {
  return useSyncExternalStore(subscribe, readLayout, () => "standard" as PowerLayout);
}

export function setPowerLayout(layout: PowerLayout) {
  applyAttribute(layout);
  try {
    window.localStorage.setItem(POWER_LAYOUT_STORAGE_KEY, layout);
  } catch {
    /* Storage can be blocked; the choice still applies until the page reloads. */
  }
  notify();
}
