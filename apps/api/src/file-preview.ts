const DP_CELLS = 1_600_000;
const PREVIEW_LINES = 160;
const CONTEXT = 2;

export type FileChangePreview = {
  created: boolean;
  added: number;
  removed: number;
  preview: string;
  truncated: boolean;
  before: string | null;
};

function splitLines(value: string) {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function lcsDiff(before: string[], after: string[]) {
  const n = before.length;
  const m = after.length;
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) {
    const row = dp[i];
    const next = dp[i + 1];
    for (let j = m - 1; j >= 0; j -= 1) {
      row[j] = before[i] === after[j] ? next[j + 1] + 1 : Math.max(next[j], row[j + 1]);
    }
  }
  const ops: { op: " " | "+" | "-"; text: string }[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      ops.push({ op: " ", text: before[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      ops.push({ op: "-", text: before[i] });
      i += 1;
    } else {
      ops.push({ op: "+", text: after[j] });
      j += 1;
    }
  }
  while (i < n) {
    ops.push({ op: "-", text: before[i] });
    i += 1;
  }
  while (j < m) {
    ops.push({ op: "+", text: after[j] });
    j += 1;
  }
  return ops;
}

function replaceDiff(before: string[], after: string[]) {
  return [
    ...before.map((text) => ({ op: "-" as const, text })),
    ...after.map((text) => ({ op: "+" as const, text })),
  ];
}

function withContext(ops: { op: " " | "+" | "-"; text: string }[]) {
  const keep = new Set<number>();
  for (let i = 0; i < ops.length; i += 1) {
    if (ops[i].op === " ") continue;
    for (let j = Math.max(0, i - CONTEXT); j <= Math.min(ops.length - 1, i + CONTEXT); j += 1) {
      keep.add(j);
    }
  }
  const lines: string[] = [];
  let skipped = false;
  for (let i = 0; i < ops.length; i += 1) {
    if (!keep.has(i)) {
      skipped = true;
      continue;
    }
    if (skipped) {
      lines.push("@@");
      skipped = false;
    }
    const row = ops[i];
    lines.push(`${row.op}${row.text}`);
  }
  return lines;
}

export function fileChangePreview(before: string | null, after: string): FileChangePreview {
  const created = before == null;
  const oldLines = splitLines(before ?? "");
  const newLines = splitLines(after);
  if (!created && before === after) {
    return { created: false, added: 0, removed: 0, preview: "", truncated: false, before };
  }

  const tooBig = oldLines.length * newLines.length > DP_CELLS || oldLines.length + newLines.length > 5000;
  const ops = tooBig ? replaceDiff(oldLines, newLines) : lcsDiff(oldLines, newLines);
  const added = ops.filter((row) => row.op === "+").length;
  const removed = ops.filter((row) => row.op === "-").length;
  let previewLines = withContext(ops);
  const truncated = tooBig || previewLines.length > PREVIEW_LINES;
  if (previewLines.length > PREVIEW_LINES) {
    previewLines = previewLines.slice(0, PREVIEW_LINES);
  }
  return {
    created,
    added,
    removed,
    preview: previewLines.join("\n"),
    truncated,
    before,
  };
}
