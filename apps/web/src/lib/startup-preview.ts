export function portFromAddress(address?: string | null) {
  if (!address || address === "unassigned") return null;
  const index = address.lastIndexOf(":");
  if (index < 0) return null;
  const port = Number(address.slice(index + 1));
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

export function ipFromAddress(address?: string | null) {
  if (!address || address === "unassigned") return "";
  const index = address.lastIndexOf(":");
  return index > 0 ? address.slice(0, index) : "";
}

export function interpolateStartup(template: string, env: Record<string, string>) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    Object.prototype.hasOwnProperty.call(env, key) ? (env[key] ?? "") : `{{${key}}}`,
  );
}

export function startupUsesVariable(template: string, key: string) {
  if (!key) return false;
  return template.includes(`{{${key}}}`);
}

export function isPortVariable(key: string, description = "") {
  return /port/i.test(key) || /\bports?\b/i.test(description);
}

export function portNumbersInValue(value: string) {
  return [...value.matchAll(/\b(\d{2,5})\b/g)]
    .map((match) => Number(match[1]))
    .filter((port) => port >= 1 && port <= 65535);
}

export function unallocatedPorts(value: string, allocated: number[]) {
  if (!value.trim()) return [];
  const allow = new Set(allocated);
  return [...new Set(portNumbersInValue(value).filter((port) => !allow.has(port)))];
}

export type StartupPart =
  | { kind: "text"; text: string }
  | { kind: "var"; key: string; value: string; missing: boolean };

export function startupPreviewParts(template: string, env: Record<string, string>): StartupPart[] {
  if (!template) return [];
  const parts: StartupPart[] = [];
  for (const chunk of template.split(/(\{\{\w+\}\})/g)) {
    if (!chunk) continue;
    const match = chunk.match(/^\{\{(\w+)\}\}$/);
    if (!match) {
      parts.push({ kind: "text", text: chunk });
      continue;
    }
    const key = match[1] ?? "";
    const value = env[key];
    const missing = value === undefined || value === "";
    parts.push({ kind: "var", key, value: missing ? `{{${key}}}` : value, missing });
  }
  return parts;
}
