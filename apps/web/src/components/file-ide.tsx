"use client";

import { useEffect, useRef } from "react";
import Editor, { type OnMount } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui";

const LANGUAGES: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  json: "json",
  jsonc: "json",
  md: "markdown",
  markdown: "markdown",
  css: "css",
  scss: "scss",
  less: "less",
  html: "html",
  htm: "html",
  xml: "xml",
  svg: "xml",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  env: "ini",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  ps1: "powershell",
  py: "python",
  java: "java",
  kt: "kotlin",
  go: "go",
  rs: "rust",
  php: "php",
  rb: "ruby",
  lua: "lua",
  sql: "sql",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  hpp: "cpp",
  cs: "csharp",
  swift: "swift",
  dockerfile: "dockerfile",
  properties: "ini",
  conf: "ini",
  cfg: "ini",
  log: "plaintext",
  txt: "plaintext",
  gitignore: "plaintext",
};

export function languageFor(path: string) {
  const base = path.split("/").pop() ?? path;
  if (/^dockerfile$/i.test(base)) return "dockerfile";
  const ext = base.includes(".") ? base.split(".").pop()?.toLowerCase() ?? "" : "";
  return LANGUAGES[ext] || "plaintext";
}

type FileIdeModalProps = {
  path: string;
  content: string;
  pending?: boolean;
  readOnly?: boolean;
  onChange: (content: string) => void;
  onSave: () => void;
  onClose: () => void;
};

export function FileIdeModal({ path, content, pending, readOnly, onChange, onSave, onClose }: FileIdeModalProps) {
  const { resolvedTheme } = useTheme();
  const dirty = useRef(false);
  const original = useRef(content);
  const language = languageFor(path);
  const dark = resolvedTheme !== "light";

  useEffect(() => {
    original.current = content;
    dirty.current = false;
  }, [path]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (!readOnly) onSave();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onSave, readOnly]);

  const onMount: OnMount = (_editor, monaco) => {
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: false,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6">
      <button
        type="button"
        className="absolute inset-0 bg-background/80 backdrop-blur-sm"
        aria-label="Close editor"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${path}`}
        className="relative flex h-[min(92vh,52rem)] w-full max-w-6xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2.5">
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm">{path}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{language}</p>
          </div>
          {readOnly ? null : (
          <Button type="button" size="sm" disabled={pending} onClick={onSave}>
            <Save className="size-3.5" />
            {pending ? "Saving…" : "Save"}
          </Button>
          )}
          <Button type="button" size="sm" variant="ghost" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 bg-background">
          <Editor
            height="100%"
            language={language}
            value={content}
            theme={dark ? "vs-dark" : "light"}
            onChange={(value) => {
              dirty.current = value !== original.current;
              onChange(value ?? "");
            }}
            onMount={onMount}
            options={{
              fontFamily: "var(--font-mono)",
              fontSize: 13,
              lineHeight: 20,
              minimap: { enabled: false },
              scrollBeyondLastLine: false,
              automaticLayout: true,
              tabSize: 2,
              padding: { top: 12, bottom: 12 },
              readOnly: Boolean(readOnly),
              wordWrap: "on",
              renderLineHighlight: "line",
              smoothScrolling: true,
            }}
            loading={
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Loading editor…
              </div>
            }
          />
        </div>
        <p className="shrink-0 border-t border-border px-4 py-1.5 text-[11px] text-muted-foreground">
          {readOnly ? "Read only · Esc to close" : "Ctrl+S to save · Esc to close"}
        </p>
      </div>
    </div>
  );
}
