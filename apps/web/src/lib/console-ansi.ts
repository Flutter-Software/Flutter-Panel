import { cn } from "@/lib/cn";
import { DEFAULT_CONSOLE_TAG, normalizeConsoleTag } from "@flutter-software/shared";

const FG: Record<number, string> = {
  30: "console-fg-black",
  31: "console-fg-red",
  32: "console-fg-green",
  33: "console-fg-yellow",
  34: "console-fg-blue",
  35: "console-fg-magenta",
  36: "console-fg-cyan",
  37: "console-fg-white",
  90: "console-fg-bright-black",
  91: "console-fg-bright-red",
  92: "console-fg-bright-green",
  93: "console-fg-bright-yellow",
  94: "console-fg-bright-blue",
  95: "console-fg-bright-magenta",
  96: "console-fg-bright-cyan",
  97: "console-fg-bright-white",
};

const BG: Record<number, string> = {
  40: "console-bg-black",
  41: "console-bg-red",
  42: "console-bg-green",
  43: "console-bg-yellow",
  44: "console-bg-blue",
  45: "console-bg-magenta",
  46: "console-bg-cyan",
  47: "console-bg-white",
  100: "console-bg-black",
  101: "console-bg-red",
  102: "console-bg-green",
  103: "console-bg-yellow",
  104: "console-bg-blue",
  105: "console-bg-magenta",
  106: "console-bg-cyan",
  107: "console-bg-white",
};

export function stripConsoleAnsi(value: string) {
  return value
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\[{1,2}\d+(?:;\d+)*[GHfKJ]/g, "")
    .replace(/\[{1,2}\d+(?:;\d+)*m/g, "")
    .replace(/\u001b./g, "");
}

const DOCKER_RFC3339 =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const tagPatternCache = new Map<string, RegExp>();

export function consoleTags(tag?: string | null) {
  return [...new Set([normalizeConsoleTag(tag), DEFAULT_CONSOLE_TAG])];
}

function tagPattern(tags?: string | string[] | null) {
  const list = (Array.isArray(tags) ? tags : consoleTags(tags)).map((item) => normalizeConsoleTag(item));
  const unique = [...new Set(list.filter(Boolean))];
  const key = unique.join("\0").toLowerCase();
  const cached = tagPatternCache.get(key);
  if (cached) return cached;
  const pattern = new RegExp(`^\\[(${unique.map(escapeRegExp).join("|")})\\]\\s+`, "i");
  tagPatternCache.set(key, pattern);
  return pattern;
}

export function splitConsoleLine(line: string, tags?: string | string[] | null) {
  const stamped = /^\[(\d{2}:\d{2}:\d{2})\]\s+/.exec(line);
  let rest = stamped ? line.slice(stamped[0].length) : line;
  const pattern = tagPattern(tags);
  const stripped = stripConsoleAnsi(rest);
  const flutterMatch = pattern.exec(stripped);
  const flutter = Boolean(flutterMatch);
  let tag: string | null = null;
  if (flutter) {
    const direct = pattern.exec(rest);
    tag = direct?.[1] || flutterMatch?.[1] || null;
    rest = direct ? rest.slice(direct[0].length) : stripped.replace(pattern, "");
  }
  return {
    time: stamped?.[1] ?? null,
    flutter,
    tag,
    body: rest,
  };
}

export function isFlutterConsoleLine(line: string, tags?: string | string[] | null) {
  return splitConsoleLine(line, tags).flutter;
}

export function isBareDockerTimestampLine(line: string, tags?: string | string[] | null) {
  return DOCKER_RFC3339.test(stripConsoleAnsi(splitConsoleLine(line, tags).body).trim());
}

export function scrubDockerTimestamps(line: string) {
  return line
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?/g, "")
    .replace(/[ \t]{2,}/g, " ");
}

export function isConsoleHaltNotice(line: string, tags?: string | string[] | null) {
  const parts = splitConsoleLine(line, tags);
  if (!parts.flutter) return false;
  return /^(Stopping server|Killing server|Restarting server)\.\.\./i.test(stripConsoleAnsi(parts.body).trim());
}

export function isConsoleResumeNotice(line: string, tags?: string | string[] | null) {
  const parts = splitConsoleLine(line, tags);
  if (!parts.flutter) return false;
  return /^Starting server\.\.\./i.test(stripConsoleAnsi(parts.body).trim());
}

export function isConsoleRunningHeartbeat(line: string, tags?: string | string[] | null) {
  const parts = splitConsoleLine(line, tags);
  if (!parts.flutter) return false;
  return /^(?:\d{2}:\d{2}:\d{2}\s+)?running\s*$/i.test(stripConsoleAnsi(parts.body).trim());
}

type AnsiStyle = {
  fg: string | null;
  bg: string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
};

function emptyStyle(): AnsiStyle {
  return { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
}

function applyCodes(style: AnsiStyle, codes: number[]) {
  for (let i = 0; i < codes.length; i += 1) {
    const code = codes[i] ?? 0;
    if (code === 0) {
      Object.assign(style, emptyStyle());
      continue;
    }
    if (code === 1) style.bold = true;
    else if (code === 2) style.dim = true;
    else if (code === 3) style.italic = true;
    else if (code === 4) style.underline = true;
    else if (code === 22) {
      style.bold = false;
      style.dim = false;
    } else if (code === 23) style.italic = false;
    else if (code === 24) style.underline = false;
    else if (code === 39) style.fg = null;
    else if (code === 49) style.bg = null;
    else if (FG[code]) style.fg = FG[code];
    else if (BG[code]) style.bg = BG[code];
    else if (code === 38 || code === 48) {
      const next = codes[i + 1];
      if (next === 5) i += 2;
      else if (next === 2) i += 4;
    }
  }
}

function classNameFor(style: AnsiStyle) {
  return cn(
    style.fg,
    style.bg,
    style.bold && "font-semibold",
    style.dim && "opacity-70",
    style.italic && "italic",
    style.underline && "underline",
  );
}

export function ansiSpans(text: string) {
  const spans: { text: string; className: string }[] = [];
  const style = emptyStyle();
  const re = /\u001b\[([0-9;]*)m/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    if (match.index > last) {
      spans.push({ text: text.slice(last, match.index), className: classNameFor(style) });
    }
    const codes = match[1] ? match[1].split(";").map((part) => Number(part) || 0) : [0];
    applyCodes(style, codes);
    last = match.index + match[0].length;
  }
  if (last < text.length) spans.push({ text: text.slice(last), className: classNameFor(style) });
  return spans.filter((span) => span.text.length > 0);
}
