"use client";

/**
 * Settings → Branding.
 *
 * Three cards, each with a live preview so admins see the result before
 * saving: the panel name (as it appears in the sidebar), the logo
 * (drag-and-drop or click to upload), and the console tag (rendered as a
 * sample console line).
 */

import { useRef, useState, type FormEvent } from "react";
import { ImageUp, RotateCcw } from "lucide-react";
import { Button, TextInput } from "@mantine/core";
import { CONSOLE_TAG_MAX_LENGTH, DEFAULT_CONSOLE_TAG } from "@flutter-software/shared";
import { cn } from "@/lib/cn";
import { SettingsCard } from "./workspace";

export const SITE_NAME_MAX_LENGTH = 48;
const LOGO_ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export function IdentityStudio({
  formId,
  siteName,
  onSiteName,
  consoleTag,
  onConsoleTag,
  previewSrc,
  canReset,
  pendingFileName,
  onFile,
  onReset,
  onSubmit,
}: {
  formId: string;
  siteName: string;
  onSiteName: (value: string) => void;
  consoleTag: string;
  onConsoleTag: (value: string) => void;
  previewSrc: string;
  canReset: boolean;
  /** Name of a freshly picked (not yet saved) logo file, if any. */
  pendingFileName: string | null;
  onFile: (file: File) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const shownName = siteName.trim() || "Panel name";
  const shownTag = consoleTag.trim() || DEFAULT_CONSOLE_TAG;

  return (
    <form id={formId} className="space-y-5" onSubmit={onSubmit} noValidate>
      <SettingsCard
        title="Panel name"
        description="Shown in the sidebar, on the login page, in the browser tab, and in invite emails."
        footer={
          <span className="flex items-center gap-2">
            Preview
            <span className="inline-flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-foreground">
              <img src={previewSrc} alt="" className="size-4 object-contain" />
              <span className="max-w-48 truncate text-xs font-semibold">{shownName}</span>
            </span>
          </span>
        }
      >
        <TextInput
          aria-label="Panel name"
          required
          value={siteName}
          onChange={(event) => onSiteName(event.currentTarget.value)}
          maxLength={SITE_NAME_MAX_LENGTH}
          placeholder="Panel name"
          error={siteName.trim() ? undefined : "A panel name is required."}
          rightSection={
            <span className="pr-2 text-[11px] tabular-nums text-muted-foreground">
              {siteName.length}/{SITE_NAME_MAX_LENGTH}
            </span>
          }
          rightSectionWidth={56}
        />
      </SettingsCard>

      <SettingsCard
        title="Logo"
        description="Square images look best. PNG, JPEG, WebP, or GIF, up to 2 MB."
      >
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <img
            src={previewSrc}
            alt="Current logo"
            className="size-20 shrink-0 rounded-xl border border-border bg-background object-contain p-2"
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              const file = event.dataTransfer.files?.[0];
              if (file) onFile(file);
            }}
            className={cn(
              "flex min-h-20 flex-1 flex-col items-center justify-center gap-1 rounded-xl border border-dashed px-4 py-4 text-center outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
              dragging ? "border-primary bg-primary/10" : "border-border hover:border-primary/50 hover:bg-muted/30",
            )}
          >
            <ImageUp className={cn("size-5", dragging ? "text-primary" : "text-muted-foreground")} />
            <span className="text-sm">
              <span className="font-medium text-primary">Click to upload</span>{" "}
              <span className="text-muted-foreground">or drag and drop</span>
            </span>
            {pendingFileName ? (
              <span className="max-w-full truncate text-xs text-muted-foreground">
                Selected: <span className="text-foreground">{pendingFileName}</span>
              </span>
            ) : null}
          </button>
          <input
            ref={input}
            type="file"
            accept={LOGO_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) onFile(file);
              // Allow picking the same file again after a discard.
              event.currentTarget.value = "";
            }}
          />
        </div>
        {canReset ? (
          <Button
            type="button"
            variant="subtle"
            color="gray"
            leftSection={<RotateCcw className="size-3.5" />}
            onClick={onReset}
          >
            Use default logo
          </Button>
        ) : null}
      </SettingsCard>

      <SettingsCard
        title="Console tag"
        description="Prefix on messages the panel writes into server consoles."
        footer={
          <code className="block w-full truncate rounded-md bg-background px-3 py-2 font-mono text-xs">
            <span className="text-status-warn">[{shownTag}]</span>{" "}
            <span className="text-foreground">Server marked as running.</span>
          </code>
        }
      >
        <TextInput
          aria-label="Console tag"
          required
          value={consoleTag}
          onChange={(event) =>
            onConsoleTag(event.currentTarget.value.replace(/[[\]]/g, "").slice(0, CONSOLE_TAG_MAX_LENGTH))
          }
          maxLength={CONSOLE_TAG_MAX_LENGTH}
          placeholder={DEFAULT_CONSOLE_TAG}
          leftSection={<span className="font-mono text-xs text-muted-foreground">[</span>}
          rightSection={<span className="font-mono text-xs text-muted-foreground">]</span>}
        />
      </SettingsCard>

      {/* Lets Enter inside a field submit the form; the visible Save lives in the unsaved-changes bar. */}
      <button type="submit" hidden aria-hidden tabIndex={-1} />
    </form>
  );
}
