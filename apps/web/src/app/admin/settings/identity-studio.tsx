"use client";

import { type FormEvent } from "react";
import { Button, FileButton, TextInput } from "@mantine/core";
import { SettingsActions } from "./workspace";
import { CONSOLE_TAG_MAX_LENGTH, DEFAULT_CONSOLE_TAG } from "@flutter-software/shared";

export function IdentityStudio({
  siteName,
  onSiteName,
  consoleTag,
  onConsoleTag,
  previewSrc,
  canReset,
  pending,
  onFile,
  onReset,
  onSubmit,
}: {
  siteName: string;
  onSiteName: (value: string) => void;
  consoleTag: string;
  onConsoleTag: (value: string) => void;
  previewSrc: string;
  canReset: boolean;
  pending: boolean;
  onFile: (file: File) => void;
  onReset: () => void;
  onSubmit: (event: FormEvent) => void;
}) {
  return (
    <form className="space-y-4" onSubmit={onSubmit}>
      <TextInput
        label="Site name"
        description="Sidebar, login page, browser tab, and invite emails."
        required
        value={siteName}
        onChange={(event) => onSiteName(event.currentTarget.value)}
        maxLength={48}
        placeholder="Panel name"
      />
      <TextInput
        label="Console tag"
        description="Prefix on panel messages in the server console, shown as [Tag]."
        required
        value={consoleTag}
        onChange={(event) => onConsoleTag(event.currentTarget.value.replace(/[\[\]]/g, "").slice(0, CONSOLE_TAG_MAX_LENGTH))}
        maxLength={CONSOLE_TAG_MAX_LENGTH}
        placeholder={DEFAULT_CONSOLE_TAG}
      />
      <div>
        <p className="text-sm font-medium">Logo</p>
        <p className="mt-1 text-xs text-muted-foreground">
          PNG, JPEG, WebP, or GIF. Square images look best. 2 MB max.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <img
            src={previewSrc}
            alt=""
            className="size-12 rounded-lg border border-border bg-background object-contain p-1"
          />
          <FileButton
            accept="image/png,image/jpeg,image/webp,image/gif"
            onChange={(file) => {
              if (file) onFile(file);
            }}
          >
            {(props) => (
              <Button {...props} type="button" variant="default">
                Upload logo
              </Button>
            )}
          </FileButton>
          {canReset ? (
            <Button type="button" variant="subtle" onClick={onReset}>
              Use default logo
            </Button>
          ) : null}
        </div>
      </div>
      <SettingsActions>
        <Button type="submit" disabled={pending} className="ml-auto">
          {pending ? "Saving…" : "Save branding"}
        </Button>
      </SettingsActions>
    </form>
  );
}
