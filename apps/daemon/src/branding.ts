import { DEFAULT_CONSOLE_TAG, normalizeConsoleTag } from "@flutter-software/shared";

let tag = DEFAULT_CONSOLE_TAG;

export function setConsoleTag(value: string | null | undefined) {
  tag = normalizeConsoleTag(value);
}

export function consoleTag() {
  return tag;
}

export function consoleTagged(message: string) {
  return `[${tag}] ${message.replace(/\s+/g, " ").trim()}`;
}
