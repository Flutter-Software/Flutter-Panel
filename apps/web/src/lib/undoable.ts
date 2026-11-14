"use client";

/**
 * Undo toasts for destructive actions: after the "Are you sure?" dialog, do it
 * optimistically, show "Deleted X · Undo", and only send the request once the
 * toast runs out.
 *
 *   undoable({
 *     message: `Deleted ${name}`,
 *     apply:  () => hide(name),                       // optimistic UI change
 *     revert: () => unhide(name),                     // Undo, or the request failed
 *     commit: (init) => api(url, { method: "DELETE", ...init }),
 *     onCommitted: () => reload(),
 *   });
 *
 * Guarantees:
 * - `commit` runs at most once, and never after Undo.
 * - The toast's countdown pauses while hovered, and so does the commit (the
 *   commit is driven by the toast's `onSettle`, not a separate timer).
 * - Closing or swiping the toast away means "accept": it commits right away.
 * - Leaving the page (closing the tab, reloading, navigating off-site) commits
 *   every pending action immediately with `keepalive: true`, so the request
 *   survives the unload. In-app navigation keeps the timers running.
 * - If the request fails, `revert` restores the UI and an error toast explains.
 */

import { dismissToast, toast } from "@/components/toast";

/** Extra fetch options handed to `commit`; spread them into your request. */
export type CommitInit = { keepalive?: boolean };

export type UndoableOptions = {
  message: string;
  /** Applied immediately: hide the row, flip the switch, etc. */
  apply: () => void;
  /** Puts the UI back. Called on Undo and when `commit` fails. */
  revert: () => void;
  /** Sends the real request. Spread `init` into the fetch options. */
  commit: (init: CommitInit) => Promise<unknown>;
  /** Runs after a successful commit (e.g. reload the list). */
  onCommitted?: () => void;
  /** Error toast text if the commit fails. Defaults to the error's message. */
  errorMessage?: string;
  /** How long the Undo window stays open, in ms. */
  duration?: number;
};

const UNDO_WINDOW_MS = 6000;

type Pending = { toastId: number; run: (init: CommitInit) => void };
const pending = new Set<Pending>();
let unloadHooked = false;

function hookUnload() {
  if (unloadHooked || typeof window === "undefined") return;
  unloadHooked = true;
  // `pagehide` fires for tab close, reload and cross-document navigation, and
  // (unlike `beforeunload`) is reliable on mobile Safari.
  window.addEventListener("pagehide", () => {
    for (const item of [...pending]) {
      item.run({ keepalive: true });
      // If the page is restored from the back/forward cache, the Undo button
      // would be stale, so close the toast too (its onSettle is a no-op now).
      dismissToast(item.toastId);
    }
  });
}

export function undoable(options: UndoableOptions) {
  hookUnload();
  let settled = false;

  const entry: Pending = {
    toastId: 0,
    run(init) {
      if (settled) return;
      settled = true;
      pending.delete(entry);
      options
        .commit(init)
        .then(() => options.onCommitted?.())
        .catch((err: unknown) => {
          options.revert();
          toast(options.errorMessage ?? (err instanceof Error ? err.message : "Something went wrong"));
        });
    },
  };

  options.apply();
  pending.add(entry);

  entry.toastId = toast(options.message, "info", {
    duration: options.duration ?? UNDO_WINDOW_MS,
    action: {
      label: "Undo",
      undo: true,
      onClick() {
        if (settled) return;
        settled = true;
        pending.delete(entry);
        options.revert();
      },
    },
    onSettle: () => entry.run({}),
  });

  return {
    /** Commit now instead of waiting for the toast (e.g. before a dependent action). */
    flush() {
      dismissToast(entry.toastId);
    },
  };
}
