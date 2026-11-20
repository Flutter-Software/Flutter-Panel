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
import { Gauge, Save, X } from "lucide-react";
import { Button } from "@/components/ui";
import { Rail, type RailTone } from "@/components/status";
import { cn } from "@/lib/cn";
import { pressedKey } from "@/components/kbd";

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
/*                             Themes and labels                              */
/* -------------------------------------------------------------------------- */

/**
 * Monaco themes built from the Rack tokens (globals.css / DESIGN.md). Monaco
 * needs literal hex values, so these mirror the CSS variables: the code sits in
 * the recessed well colour, keys and keywords take the signal cyan, values and
 * numbers reuse the status green and amber at a calmer strength.
 */
const RACK_THEMES = {
  "rack-dark": {
    base: "vs-dark" as const,
    rules: [
      { token: "comment", foreground: "7a7a80", fontStyle: "italic" },
      { token: "keyword", foreground: "5cc8f2" },
      { token: "key", foreground: "5cc8f2" },
      { token: "type", foreground: "5cc8f2" },
      { token: "tag", foreground: "5cc8f2" },
      { token: "attribute.name", foreground: "5cc8f2" },
      { token: "string.key.json", foreground: "5cc8f2" },
      { token: "string", foreground: "8fdcb2" },
      { token: "string.value.json", foreground: "8fdcb2" },
      { token: "attribute.value", foreground: "8fdcb2" },
      { token: "number", foreground: "f2c46b" },
      { token: "keyword.json", foreground: "f2c46b" },
      { token: "delimiter", foreground: "9a9a9f" },
      { token: "operator", foreground: "9a9a9f" },
    ],
    colors: {
      "editor.background": "#151516",
      "editor.foreground": "#e8e8e9",
      "editorGutter.background": "#151516",
      "editorLineNumber.foreground": "#5a5a5f",
      "editorLineNumber.activeForeground": "#e8e8e9",
      "editor.lineHighlightBackground": "#1d1d1f",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#2bb3ec40",
      "editor.inactiveSelectionBackground": "#2bb3ec22",
      "editorCursor.foreground": "#2bb3ec",
      "editorIndentGuide.background1": "#262628",
      "editorIndentGuide.activeBackground1": "#3c3c3f",
      "editorWhitespace.foreground": "#3c3c3f",
      "editorWidget.background": "#222223",
      "editorWidget.border": "#323234",
      "input.background": "#151516",
      "input.border": "#3c3c3f",
      "focusBorder": "#2bb3ec",
      "scrollbarSlider.background": "#3c3c3f80",
      "scrollbarSlider.hoverBackground": "#4a4a4ecc",
      "diffEditor.insertedTextBackground": "#4cd38e26",
      "diffEditor.removedTextBackground": "#ef5a5226",
      "diffEditor.insertedLineBackground": "#4cd38e14",
      "diffEditor.removedLineBackground": "#ef5a5214",
    },
  },
  "rack-light": {
    base: "vs" as const,
    rules: [
      { token: "comment", foreground: "8c8c92", fontStyle: "italic" },
      { token: "keyword", foreground: "0b7fb8" },
      { token: "key", foreground: "0b7fb8" },
      { token: "type", foreground: "0b7fb8" },
      { token: "tag", foreground: "0b7fb8" },
      { token: "attribute.name", foreground: "0b7fb8" },
      { token: "string.key.json", foreground: "0b7fb8" },
      { token: "string", foreground: "17784a" },
      { token: "string.value.json", foreground: "17784a" },
      { token: "attribute.value", foreground: "17784a" },
      { token: "number", foreground: "9a5f0e" },
      { token: "keyword.json", foreground: "9a5f0e" },
      { token: "delimiter", foreground: "6a6a70" },
      { token: "operator", foreground: "6a6a70" },
    ],
    colors: {
      "editor.background": "#f7f7f7",
      "editor.foreground": "#1c1c1e",
      "editorGutter.background": "#f7f7f7",
      "editorLineNumber.foreground": "#a0a0a5",
      "editorLineNumber.activeForeground": "#1c1c1e",
      "editor.lineHighlightBackground": "#ededee",
      "editor.lineHighlightBorder": "#00000000",
      "editor.selectionBackground": "#0b7fb833",
      "editor.inactiveSelectionBackground": "#0b7fb81c",
      "editorCursor.foreground": "#0b7fb8",
      "editorIndentGuide.background1": "#e4e4e6",
      "editorIndentGuide.activeBackground1": "#c3c3c6",
      "editorWidget.background": "#ffffff",
      "editorWidget.border": "#d3d3d5",
      "focusBorder": "#0b7fb8",
      "diffEditor.insertedTextBackground": "#178a5326",
      "diffEditor.removedTextBackground": "#c9372f22",
      "diffEditor.insertedLineBackground": "#178a5312",
      "diffEditor.removedLineBackground": "#c9372f10",
    },
  },
};

function defineRackThemes(monaco: Monaco) {
  for (const [name, theme] of Object.entries(RACK_THEMES)) {
    monaco.editor.defineTheme(name, { base: theme.base, inherit: true, rules: theme.rules, colors: theme.colors });
  }
}

/** Names people recognise, for the status strip. Falls back to the Monaco id. */
const LANGUAGE_LABELS: Record<string, string> = {
  typescript: "TypeScript",
  javascript: "JavaScript",
  json: "JSON",
  markdown: "Markdown",
  css: "CSS",
  scss: "SCSS",
  less: "Less",
  html: "HTML",
  xml: "XML",
  yaml: "YAML",
  ini: "Config (key = value)",
  shell: "Shell script",
  powershell: "PowerShell",
  python: "Python",
  java: "Java",
  kotlin: "Kotlin",
  go: "Go",
  rust: "Rust",
  php: "PHP",
  ruby: "Ruby",
  lua: "Lua",
  sql: "SQL",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  swift: "Swift",
  dockerfile: "Dockerfile",
  plaintext: "Plain text",
};

/**
 * Line and column, in its own component: cursor moves re-render only this
 * readout, never the editor or the rest of the frame.
 */
function CursorReadout({ editor }: { editor: MonacoEditor.IStandaloneCodeEditor | null }) {
  const [position, setPosition] = useState<{ line: number; column: number } | null>(null);
  useEffect(() => {
    if (!editor) return;
    const read = () => {
      const pos = editor.getPosition();
      if (pos) setPosition({ line: pos.lineNumber, column: pos.column });
    };
    read();
    const subscription = editor.onDidChangeCursorPosition(read);
    return () => subscription.dispose();
  }, [editor]);
  if (!position) return null;
  return (
    <span className="tabular-nums">
      Line {position.line.toLocaleString()}, column {position.column}
    </span>
  );
}

/**
 * Current size and line count. `getValueLength()` and `getLineCount()` are O(1)
 * on Monaco's piece table, and this lives in its own component so an edit only
 * re-renders these two numbers. (`profile` is the opening snapshot, used for
 * the performance tier, and would go stale as you type.)
 */
function LiveFileStats({ model, initial }: { model: MonacoEditor.ITextModel | null; initial: ContentProfile }) {
  const [stats, setStats] = useState({ chars: initial.chars, lines: initial.lines });
  useEffect(() => {
    if (!model) return;
    const read = () => setStats({ chars: model.getValueLength(), lines: model.getLineCount() });
    read();
    const subscription = model.onDidChangeContent(read);
    return () => subscription.dispose();
  }, [model]);
  return (
    <>
      <span className="tabular-nums">{formatSize(stats.chars)}</span>
      <span className="tabular-nums">
        {stats.lines.toLocaleString()} {stats.lines === 1 ? "line" : "lines"}
      </span>
    </>
  );
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

/** The file's state, shown on the header rail and in the status strip. */
type SaveState = "clean" | "saved" | "dirty" | "saving" | "failed" | "readonly";

const SAVE_STATE: Record<SaveState, { label: string; tone: RailTone; text: string }> = {
  clean: { label: "No changes", tone: "off", text: "text-muted-foreground" },
  saved: { label: "Saved", tone: "ok", text: "text-status-running" },
  dirty: { label: "Unsaved changes", tone: "warn", text: "text-status-warn" },
  saving: { label: "Saving…", tone: "warn", text: "text-status-warn" },
  failed: { label: "Couldn't save. Your changes are still here; try again.", tone: "error", text: "text-status-error" },
  readonly: { label: "Read-only", tone: "off", text: "text-muted-foreground" },
};

/**
 * The file editor, styled as a Rack unit (see DESIGN.md): a front-panel header
 * with the file's name and folder and a status rail on its left edge, the code
 * in a recessed well, and a status strip along the bottom.
 */
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
  // State copy of the editor for components that subscribe to it (cursor readout).
  const [editor, setEditor] = useState<MonacoEditor.IStandaloneCodeEditor | null>(null);
  const [monaco, setMonaco] = useState<Monaco | null>(null);
  const [model, setModel] = useState<MonacoEditor.ITextModel | null>(null);

  /** Alternative version id of the model at the last successful save. */
  const savedVersion = useRef(0);
  /** Text at the last successful save; only used as the diff's left side. */
  const [savedText, setSavedText] = useState(initialContent);
  const [dirty, setDirty] = useState(false);
  const [diffing, setDiffing] = useState(false);
  /** Presentation only: did the last save succeed or fail? Cleared by the next edit. */
  const [lastSave, setLastSave] = useState<"ok" | "failed" | null>(null);

  const fileName = path.split("/").pop() || path;
  const dir = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) || "/" : "/";

  async function handleSave() {
    const current = editorRef.current?.getModel();
    if (!current || readOnly || pending) return;

    // Remember which version we're saving so edits typed while the request is
    // in flight still count as unsaved afterwards.
    const version = current.getAlternativeVersionId();
    const text = current.getValue();
    const ok = await onSave(text);
    if (current.isDisposed()) return;
    if (!ok) {
      setLastSave("failed");
      return;
    }

    savedVersion.current = version;
    setSavedText(text);
    setDirty(current.getAlternativeVersionId() !== version);
    setDiffing(false);
    setLastSave("ok");
  }

  // Window listener reads through a ref so it never needs re-binding.
  const saveRef = useRef(handleSave);
  saveRef.current = handleSave;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && pressedKey(event) === "s") {
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
    defineRackThemes(instance);
    configureLanguageServices(instance, tier);
  };

  const onMount: OnMount = (mountedEditor, instance) => {
    const mounted = mountedEditor.getModel();
    editorRef.current = mountedEditor;
    setEditor(mountedEditor);
    setMonaco(instance);
    setModel(mounted);
    if (!mounted) return;

    savedVersion.current = mounted.getAlternativeVersionId();
    // O(1) per edit. React bails out when the values don't change, so
    // ordinary typing causes no re-render at all.
    mountedEditor.onDidChangeModelContent(() => {
      setDirty(mounted.getAlternativeVersionId() !== savedVersion.current);
      setLastSave(null);
    });
    mountedEditor.focus();
  };

  // Returning from the diff: the editor was display:none, so re-measure and refocus.
  useEffect(() => {
    if (diffing) return;
    editorRef.current?.layout();
    editorRef.current?.focus();
  }, [diffing]);

  const saveState: SaveState = readOnly
    ? "readonly"
    : pending
      ? "saving"
      : lastSave === "failed"
        ? "failed"
        : dirty
          ? "dirty"
          : lastSave === "ok"
            ? "saved"
            : "clean";
  const state = SAVE_STATE[saveState];
  const canCompare = !readOnly && (dirty || diffing);

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center sm:p-4">
      <button type="button" className="absolute inset-0 bg-background/75" aria-label="Close editor" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Edit ${path}`}
        className="relative flex w-full max-w-[96rem] flex-col overflow-hidden bg-card shadow-[var(--shadow-float)] sm:rounded-xl"
      >
        {/* Front panel: the file as a unit. The rail on the left edge is its save state. */}
        <header className="relative flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
          <Rail tone={state.tone} pulse={saveState === "saving"} />
          <div className="min-w-0 flex-1 pl-1">
            <h2 className="truncate text-[22px] font-semibold" title={path}>
              {fileName}
            </h2>
            <p className="truncate font-mono text-[12.5px] text-muted-foreground" title={path}>
              {dir}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canCompare ? (
              // Edit the file, or see what changed since the last save. Both views share one buffer.
              <div role="group" aria-label="View" className="flex rounded-md border border-border p-0.5">
                {(
                  [
                    [false, "Edit"],
                    [true, "Changes"],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={label}
                    type="button"
                    aria-pressed={diffing === value}
                    disabled={pending || !model}
                    onClick={() => setDiffing(value)}
                    title={value ? "Compare with the last saved version" : undefined}
                    className={cn(
                      "no-press h-7 rounded-sm px-2.5 text-[13px] font-medium disabled:opacity-50",
                      diffing === value ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            {readOnly ? null : (
              <Button
                type="button"
                size="sm"
                disabled={pending || !dirty}
                onClick={() => void handleSave()}
                title="Save changes (Ctrl+S)"
              >
                <Save className="size-3.5" />
                {pending ? "Saving…" : "Save changes"}
              </Button>
            )}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="hit-slop size-8 px-0 text-muted-foreground"
              onClick={onClose}
              aria-label="Close editor"
              title="Close (Esc)"
            >
              <X className="size-4" />
            </Button>
          </div>
        </header>

        <div className="relative min-h-0 flex-1 bg-well">
          {/*
            The editor stays mounted while comparing (just hidden) so its model,
            undo stack, cursor and scroll position survive the round trip.
          */}
          <div className={diffing ? "hidden" : "h-full"}>
            <Editor
              height="100%"
              defaultValue={initialContent}
              language={language}
              theme={dark ? "rack-dark" : "rack-light"}
              beforeMount={beforeMount}
              onMount={onMount}
              options={options}
              loading={<div className="flex h-full items-center px-5 text-sm text-muted-foreground">Loading the editor…</div>}
            />
          </div>
          {diffing && monaco && model ? (
            <div className="absolute inset-0">
              <DiffPane monaco={monaco} model={model} savedText={savedText} tier={tier} readOnly={readOnly} />
            </div>
          ) : null}
        </div>

        {/* Status strip: separate fields, no dot-joined meta. */}
        <footer className="flex flex-wrap items-center gap-x-5 gap-y-1 border-t border-border px-4 py-2 text-[12.5px] text-muted-foreground sm:px-5">
          <span role="status" className={cn("flex items-center gap-2 font-medium", state.text)}>
            <span aria-hidden className={cn("size-2 shrink-0 rounded-full bg-current", saveState === "saving" && "led-pulse")} />
            {state.label}
          </span>
          {diffing ? <span>Comparing with the last saved version</span> : <CursorReadout editor={editor} />}
          <span>{LANGUAGE_LABELS[language] ?? language}</span>
          <LiveFileStats model={model} initial={profile} />
          {tier !== "normal" ? (
            <span
              className="flex items-center gap-1.5 text-status-warn sm:ml-auto"
              title={
                tier === "huge"
                  ? "Very large file: syntax highlighting, word wrap, folding, suggestions and validation are off to keep editing responsive."
                  : "Large file: word wrap, folding, bracket colouring, suggestions and validation are off to keep editing responsive."
              }
            >
              <Gauge className="size-3.5" />
              {tier === "huge" ? "Performance mode: no highlighting" : "Performance mode"}
            </span>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
