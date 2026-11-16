"use client";

/**
 * Settings → General (branding).
 *
 * One card, three rows: panel name, logo, console tag. Each row shows a small
 * live preview under the control so admins see the result before saving.
 */

import { useRef, useState, type FormEvent } from "react";
import { ImageUp, RotateCcw } from "lucide-react";
import { Button, TextInput } from "@mantine/core";
import { CONSOLE_TAG_MAX_LENGTH, DEFAULT_CONSOLE_TAG } from "@flutter-software/shared";
import { cn } from "@/lib/cn";
import { SettingsCard, SettingsRow } from "./workspace";

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
  const shownTag = consoleTag.trim() || DEFAULT_CONSOLE_TAG;

  return (
    <form id={formId} onSubmit={onSubmit} noValidate>
      <SettingsCard title="Branding" description="How this panel presents itself to your users.">
        <SettingsRow
          label="Panel name"
          htmlFor="settings-site-name"
          required
          description="Shown in the sidebar, login page, browser tab and emails."
        >
          <TextInput
            id="settings-site-name"
            required
            value={siteName}
            onChange={(event) => onSiteName(event.currentTarget.value)}
            maxLength={SITE_NAME_MAX_LENGTH}
            placeholder="Panel name"
            error={siteName.trim() ? undefined : "A panel name is required."}
            rightSection={
              <span className="pr-2 text-[12px] tabular-nums text-muted-foreground">
                {siteName.length}/{SITE_NAME_MAX_LENGTH}
              </span>
            }
            rightSectionWidth={56}
          />
        </SettingsRow>

        <SettingsRow label="Logo" description="Square images look best. PNG, JPEG, WebP or GIF, up to 2 MB.">
          {/* The whole tile is a drop target; the buttons cover keyboard and click users. */}
          <div
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
              "flex items-center gap-4 rounded-md border border-dashed p-3 transition-colors",
              dragging ? "border-primary bg-primary/10" : "border-input",
            )}
          >
            <img
              src={previewSrc}
              alt="Current logo"
              className="size-14 shrink-0 rounded-md border border-border bg-well object-contain p-1.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="default"
                  size="xs"
                  leftSection={<ImageUp className="size-3.5" />}
                  onClick={() => input.current?.click()}
                >
                  Upload image
                </Button>
                {canReset ? (
                  <Button
                    type="button"
                    variant="subtle"
                    color="gray"
                    size="xs"
                    leftSection={<RotateCcw className="size-3.5" />}
                    onClick={onReset}
                  >
                    Use default
                  </Button>
                ) : null}
              </div>
              <p className="mt-1.5 truncate text-[13px] text-muted-foreground">
                {pendingFileName ? (
                  <>
                    Selected <span className="text-foreground">{pendingFileName}</span>
                  </>
                ) : (
                  "Or drop an image here."
                )}
              </p>
            </div>
          </div>
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
        </SettingsRow>

        <SettingsRow
          label="Console tag"
          htmlFor="settings-console-tag"
          description="Prefix on messages the panel writes into server consoles."
        >
          <TextInput
            id="settings-console-tag"
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
          <code className="block truncate rounded-md border border-border bg-well px-3 py-2 font-mono text-xs" aria-label="Console preview">
            <span className="text-status-warn">[{shownTag}]</span>{" "}
            <span className="text-muted-foreground">Server marked as running.</span>
          </code>
        </SettingsRow>
      </SettingsCard>

      {/* Lets Enter inside a field submit the form; the visible Save lives in the unsaved-changes bar. */}
      <button type="submit" hidden aria-hidden tabIndex={-1} />
    </form>
  );
}
