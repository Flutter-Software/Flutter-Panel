"use client";

import { useEffect, useRef, useState } from "react";
import Editor, { DiffEditor, type OnMount } from "@monaco-editor/react";
import { useTheme } from "next-themes";
import { FileCode, GitCompare, Save, X } from "lucide-react";
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
  onSave: () => boolean | Promise<boolean>;
  onClose: () => void;
};

export function FileIdeModal({ path, content, pending, readOnly, onChange, onSave, onClose }: FileIdeModalProps) {
  const { resolvedTheme } = useTheme();
  const original = useRef(content);
  const [dirty, setDirty] = useState(false);
  const [diffing, setDiffing] = useState(false);
  const language = languageFor(path);
  const dark = resolvedTheme !== "light";
  const fileName = path.split("/").pop() || path;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : "";

  useEffect(() => {
    original.current = content;
    setDirty(false);
    setDiffing(false);
  }, [path]);

  async function handleSave() {
    if (readOnly || pending) return;
    const ok = await onSave();
    if (!ok) return;
    original.current = content;
    setDirty(false);
    setDiffing(false);
  }

  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void saveRef.current();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

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
        className="relative flex h-[min(92vh,52rem)] w-full max-w-[min(96rem,96vw)] flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
      >
        <div className="flex h-7 shrink-0 items-center bg-muted/70">
          <p className="min-w-0 flex-1 truncate px-2.5 text-center font-mono text-[11px] leading-none text-muted-foreground">
            {dirty ? "● " : ""}
            {fileName}
            {dir ? ` — ${dir}` : ""}
          </p>
          <div className="flex shrink-0 items-stretch">
            {readOnly ? null : (
              <>
                {dirty || diffing ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 rounded-none px-2 text-[11px]"
                    disabled={pending}
                    onClick={() => setDiffing((current) => !current)}
                    title={diffing ? "Back to editor" : "Compare with last saved"}
                  >
                    <GitCompare className="size-3.5" />
                    {diffing ? "Editor" : "Diff"}
                  </Button>
                ) : null}
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 gap-1 rounded-none px-2 text-[11px]"
                  disabled={pending || !dirty}
                  onClick={() => void handleSave()}
                  title="Save (Ctrl+S)"
                >
                  <Save className="size-3.5" />
                  {pending ? "Saving" : "Save"}
                </Button>
              </>
            )}
            <button
              type="button"
              className="flex size-7 items-center justify-center text-muted-foreground hover:bg-destructive hover:text-white"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
            >
              <X className="size-3.5" />
            </button>
          </div>
        </div>
        <div className="flex h-7 shrink-0 items-stretch border-b border-border bg-muted/40">
          <div className="flex min-w-0 max-w-[min(100%,24rem)] items-center gap-1.5 border-r border-border bg-card px-2.5" title={path}>
            <FileCode className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono text-[12px] leading-none">{fileName}</span>
            {dirty ? (
              <span className="size-1.5 shrink-0 rounded-full bg-foreground/70" title="Unsaved changes" />
            ) : null}
            <span className="hidden shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground sm:inline">
              {language}
            </span>
          </div>
        </div>
        <div className="min-h-0 flex-1 bg-background">
          {diffing ? (
            <DiffEditor
              height="100%"
              language={language}
              original={original.current}
              modified={content}
              theme={dark ? "vs-dark" : "light"}
              onMount={(editor) => {
                const modified = editor.getModifiedEditor();
                modified.onDidChangeModelContent(() => {
                  const next = modified.getValue();
                  setDirty(next !== original.current);
                  onChange(next);
                });
              }}
              options={{
                fontFamily: "var(--font-mono)",
                fontSize: 13,
                minimap: { enabled: false },
                scrollBeyondLastLine: false,
                automaticLayout: true,
                readOnly: Boolean(readOnly),
                originalEditable: false,
                wordWrap: "on",
                renderSideBySide: true,
                renderLineHighlight: "line",
                smoothScrolling: true,
              }}
              loading={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Loading editor…
                </div>
              }
            />
          ) : (
          <Editor
            height="100%"
            language={language}
            value={content}
            theme={dark ? "vs-dark" : "light"}
            onChange={(value) => {
              const next = value ?? "";
              setDirty(next !== original.current);
              onChange(next);
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
              padding: { top: 8, bottom: 8 },
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
          )}
        </div>
      </div>
    </div>
  );
}
