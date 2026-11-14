"use client";

/**
 * In-browser file editor (Monaco) used by the server file manager.
 *
 * Performance model
 * -----------------
 * The editor is deliberately *uncontrolled*. Monaco's text model is the single
 * source of truth while the modal is open:
 *
 *  - Keystrokes never copy the document into React state. (`@monaco-editor/react`'s
 *    `value`/`onChange` props call `editor.getValue()` on every change and every
 *    render, which is O(file size) per keystroke and re-renders the whole file page.)
 *  - "Dirty" is tracked with `model.getAlternativeVersionId()`, which is O(1) and
 *    also clears correctly when the user undoes back to the saved state.
 *  - The full text is materialised exactly once per save (`model.getValue()`).
 *  - The diff view attaches the *same* model as its modified side, so switching
 *    between editor and diff never copies or re-diffs the buffer through React.
 *
 * Large files additionally get a reduced feature set (see `profileContent` and
 * `editorOptionsFor`) because word wrap, bracket colouring, folding, occurrence
 * highlighting and worker-side validation are what make Monaco stutter on
 * multi-megabyte or minified files.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import Editor, { type BeforeMount, type Monaco, type OnMount } from "@monaco-editor/react";
import type { editor as MonacoEditor } from "monaco-editor";
import { useTheme } from "next-themes";
import { FileCode, Gauge, GitCompare, Save, X } from "lucide-react";
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

/* -------------------------------------------------------------------------- */
/*                               Size profiling                               */
/* -------------------------------------------------------------------------- */

/**
 * How much of Monaco we can afford for a given document.
 *  - `normal`: everything on.
 *  - `large`:  expensive cosmetics and worker validation off, no word wrap.
 *  - `huge`:   as `large`, plus syntax highlighting off (plaintext model).
 */
type SizeTier = "normal" | "large" | "huge";

/** Thresholds are in UTF-16 code units, which is what JS string length counts. */
const LARGE_CHARS = 512 * 1024;
const LARGE_LINES = 20_000;
/** A single line this long is almost certainly minified/generated output. */
const LARGE_LINE_LENGTH = 5_000;
const HUGE_CHARS = 8 * 1024 * 1024;
const HUGE_LINE_LENGTH = 100_000;

type ContentProfile = {
  chars: number;
  lines: number;
  longestLine: number;
  tier: SizeTier;
};

/**
 * Single O(n) pass over the text, run once when the modal opens.
 * Uses charCodeAt rather than split("\n") so a multi-MB file doesn't allocate
 * an array of tens of thousands of substrings just to count them.
 */
function profileContent(text: string): ContentProfile {
  const chars = text.length;
  let lines = 1;
  let longestLine = 0;
  let lineStart = 0;

  for (let i = 0; i < chars; i++) {
    if (text.charCodeAt(i) === 10 /* \n */) {
      longestLine = Math.max(longestLine, i - lineStart);
      lineStart = i + 1;
      lines++;
    }
  }
  longestLine = Math.max(longestLine, chars - lineStart);

  let tier: SizeTier = "normal";
  if (chars > HUGE_CHARS || longestLine > HUGE_LINE_LENGTH) tier = "huge";
  else if (chars > LARGE_CHARS || lines > LARGE_LINES || longestLine > LARGE_LINE_LENGTH) tier = "large";

  return { chars, lines, longestLine, tier };
}

function formatSize(chars: number) {
  if (chars < 1024) return `${chars} B`;
  if (chars < 1024 * 1024) return `${(chars / 1024).toFixed(1)} KB`;
  return `${(chars / (1024 * 1024)).toFixed(1)} MB`;
}

/* -------------------------------------------------------------------------- */
/*                               Editor options                               */
/* -------------------------------------------------------------------------- */

const BASE_OPTIONS: MonacoEditor.IStandaloneEditorConstructionOptions = {
  fontFamily: "var(--font-mono)",
  fontSize: 13,
  lineHeight: 20,
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  automaticLayout: true,
  tabSize: 2,
  padding: { top: 8, bottom: 8 },
  renderLineHighlight: "line",
  // Lets Monaco apply its own built-in degradations for very big models.
  largeFileOptimizations: true,
};

/**
 * Features that cost per-render or per-keystroke work proportional to the
 * visible text or the whole document. Turned off for `large`/`huge` files.
 */
const LARGE_FILE_OVERRIDES: MonacoEditor.IStandaloneEditorConstructionOptions = {
  // Word wrap forces Monaco to measure and re-flow every line; on a minified
  // file that's one enormous line re-wrapped on each edit.
  wordWrap: "off",
  smoothScrolling: false,
  folding: false,
  bracketPairColorization: { enabled: false },
  guides: { bracketPairs: false, indentation: false, highlightActiveIndentation: false },
  matchBrackets: "never",
  occurrencesHighlight: "off",
  selectionHighlight: false,
  renderWhitespace: "none",
  stickyScroll: { enabled: false },
  links: false,
  colorDecorators: false,
  codeLens: false,
  quickSuggestions: false,
  suggestOnTriggerCharacters: false,
  wordBasedSuggestions: "off",
  parameterHints: { enabled: false },
  unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false, nonBasicASCII: false },
  // Stop tokenizing / painting absurdly long lines instead of freezing on them.
  maxTokenizationLineLength: 2_000,
  stopRenderingLineAfter: 5_000,
};

function editorOptionsFor(tier: SizeTier, readOnly: boolean): MonacoEditor.IStandaloneEditorConstructionOptions {
  return tier === "normal"
    ? { ...BASE_OPTIONS, readOnly, wordWrap: "on", smoothScrolling: true }
    : { ...BASE_OPTIONS, ...LARGE_FILE_OVERRIDES, readOnly };
}

/* -------------------------------------------------------------------------- */
/*                           Language service tuning                          */
/* -------------------------------------------------------------------------- */

type DiagnosticsDefaults = {
  setDiagnosticsOptions: (options: Record<string, unknown>) => void;
  diagnosticsOptions?: Record<string, unknown>;
};

/**
 * monaco-editor 0.55+ moved the language services to top-level namespaces
 * (`monaco.typescript`, `monaco.json`) and left `monaco.languages.typescript`
 * as a `{ deprecated: true }` stub. The runtime is loaded from the CDN by
 * `@monaco-editor/loader`, so resolve whichever shape is actually present
 * instead of trusting the compile-time types.
 */
function languageService(monaco: Monaco, name: "typescript" | "json"): Record<string, DiagnosticsDefaults> | undefined {
  const loose = monaco as unknown as Record<string, unknown> & { languages: Record<string, unknown> };
  const candidate = (loose[name] ?? loose.languages[name]) as Record<string, unknown> | undefined;
  if (!candidate || "deprecated" in candidate) return undefined;
  return candidate as Record<string, DiagnosticsDefaults>;
}

/**
 * Worker-side validation re-parses the whole document after each edit and
 * ships the full text to a web worker. Keep cheap syntax checks for normal
 * files; switch validation off entirely for large ones.
 *
 * These defaults are global to the Monaco instance, so they're re-applied on
 * every mount to match the file being opened.
 */
function configureLanguageServices(monaco: Monaco, tier: SizeTier) {
  const heavy = tier !== "normal";
  const ts = languageService(monaco, "typescript");
  for (const defaults of [ts?.typescriptDefaults, ts?.javascriptDefaults]) {
    defaults?.setDiagnosticsOptions({ noSemanticValidation: true, noSyntaxValidation: heavy });
  }
  const json = languageService(monaco, "json")?.jsonDefaults;
  json?.setDiagnosticsOptions({ ...(json.diagnosticsOptions ?? {}), validate: !heavy });
}

/* -------------------------------------------------------------------------- */
/*                                  Diff view                                 */
/* -------------------------------------------------------------------------- */

type DiffPaneProps = {
  monaco: Monaco;
  /** The live editor model; becomes the editable right-hand side. */
  model: MonacoEditor.ITextModel;
  savedText: string;
  tier: SizeTier;
  readOnly: boolean;
};

/**
 * Diff editor built directly on the Monaco API rather than `<DiffEditor>`, so
 * the modified side can *share* the main editor's model. Edits made here land
 * in the same buffer, keep the same undo stack, and drive the same dirty flag.
 */
function DiffPane({ monaco, model, savedText, tier, readOnly }: DiffPaneProps) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    const large = tier !== "normal";
    const original = monaco.editor.createModel(savedText, model.getLanguageId());
    const diff = monaco.editor.createDiffEditor(container.current, {
      ...editorOptionsFor(tier, readOnly),
      originalEditable: false,
      renderSideBySide: true,
      // Give up on an exact diff rather than block the UI on giant inputs.
      maxComputationTime: large ? 2_000 : 5_000,
      // Collapse unchanged stretches so a big file shows only what changed.
      hideUnchangedRegions: { enabled: large },
    });
    diff.setModel({ original, modified: model });

    return () => {
      // Detach before disposing: the modified model belongs to the main editor.
      diff.setModel(null);
      diff.dispose();
      original.dispose();
    };
  }, [monaco, model, savedText, tier, readOnly]);

  return <div ref={container} className="h-full w-full" />;
}

/* -------------------------------------------------------------------------- */
/*                                    Modal                                   */
/* -------------------------------------------------------------------------- */

type FileIdeModalProps = {
  path: string;
  /**
   * Initial file contents. Read once on mount; the editor owns the text after
   * that. Give the modal a new `key` to load a different file.
   */
  content: string;
  pending?: boolean;
  readOnly?: boolean;
  /** Persist `content`. Resolve `true` on success so the modal marks itself clean. */
  onSave: (content: string) => boolean | Promise<boolean>;
  onClose: () => void;
};

export function FileIdeModal({ path, content, pending, readOnly = false, onSave, onClose }: FileIdeModalProps) {
  const { resolvedTheme } = useTheme();
  const dark = resolvedTheme !== "light";

  // Snapshot the initial text and its profile; later prop changes are ignored on purpose.
  const [initialContent] = useState(content);
  const profile = useMemo(() => profileContent(initialContent), [initialContent]);
  const { tier } = profile;

  const baseLanguage = languageFor(path);
  // Tokenizing a huge file is the single biggest cost; render it as plain text.
  const language = tier === "huge" ? "plaintext" : baseLanguage;
  const options = useMemo(() => editorOptionsFor(tier, readOnly), [tier, readOnly]);

  const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const [model, setModel] = useState<MonacoEditor.ITextModel | null>(null);

  /** Alternative version id of the model at the last successful save. */
  const savedVersion = useRef(0);
  /** Text at the last successful save; only used as the diff's left side. */
  const [savedText, setSavedText] = useState(initialContent);
  const [dirty, setDirty] = useState(false);
  const [diffing, setDiffing] = useState(false);

  const fileName = path.split("/").pop() || path;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : "";

  async function handleSave() {
    const current = editorRef.current?.getModel();
    if (!current || readOnly || pending) return;

    // Remember which version we're saving so edits typed while the request is
    // in flight still count as unsaved afterwards.
    const version = current.getAlternativeVersionId();
    const text = current.getValue();
    const ok = await onSave(text);
    if (!ok || current.isDisposed()) return;

    savedVersion.current = version;
    setSavedText(text);
    setDirty(current.getAlternativeVersionId() !== version);
    setDiffing(false);
  }

  // Window listener reads through a ref so it never needs re-binding.
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

  const beforeMount: BeforeMount = (instance) => {
    configureLanguageServices(instance, tier);
  };

  const onMount: OnMount = (editor, instance) => {
    const mounted = editor.getModel();
    editorRef.current = editor;
    setMonaco(instance);
    setModel(mounted);
    if (!mounted) return;

    savedVersion.current = mounted.getAlternativeVersionId();
    // O(1) per edit. React bails out when the boolean doesn't change, so
    // ordinary typing causes no re-render at all.
    editor.onDidChangeModelContent(() => {
      setDirty(mounted.getAlternativeVersionId() !== savedVersion.current);
    });
    editor.focus();
  };

  // Returning from the diff: the editor was display:none, so re-measure and refocus.
  useEffect(() => {
    if (diffing) return;
    editorRef.current?.layout();
    editorRef.current?.focus();
  }, [diffing]);

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
                    disabled={pending || !model}
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
          {tier !== "normal" ? (
            <div
              className="ml-auto flex shrink-0 items-center gap-1 px-2.5 text-[10px] text-muted-foreground"
              title={
                tier === "huge"
                  ? "Very large file: syntax highlighting, word wrap, folding, suggestions and validation are off to keep editing responsive."
                  : "Large file: word wrap, folding, bracket colouring, suggestions and validation are off to keep editing responsive."
              }
            >
              <Gauge className="size-3" />
              <span>
                {tier === "huge" ? "Performance mode · no highlighting" : "Performance mode"} ·{" "}
                {formatSize(profile.chars)} · {profile.lines.toLocaleString()} lines
              </span>
            </div>
          ) : null}
        </div>
        <div className="relative min-h-0 flex-1 bg-background">
          {/*
            The editor stays mounted while diffing (just hidden) so its model,
            undo stack, cursor and scroll position survive the round trip.
          */}
          <div className={diffing ? "hidden" : "h-full"}>
            <Editor
              height="100%"
              defaultValue={initialContent}
              language={language}
              theme={dark ? "vs-dark" : "light"}
              beforeMount={beforeMount}
              onMount={onMount}
              options={options}
              loading={
                <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                  Loading editor…
                </div>
              }
            />
          </div>
          {diffing && monaco && model ? (
            <div className="absolute inset-0">
              <DiffPane monaco={monaco} model={model} savedText={savedText} tier={tier} readOnly={readOnly} />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
