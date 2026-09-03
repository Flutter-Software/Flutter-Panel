"use client";

import type { ComponentType } from "react";
import {
  IconBrandCSharp,
  IconBrandDocker,
  IconBrandGit,
  IconBrandGolang,
  IconBrandKotlin,
  IconBrandPython,
  IconFileCode,
  IconFileMusic,
  IconFileSettings,
  IconFileText,
  IconFileTypeBmp,
  IconFileTypeCss,
  IconFileTypeCsv,
  IconFileTypeDoc,
  IconFileTypeDocx,
  IconFileTypeHtml,
  IconFileTypeJpg,
  IconFileTypeJs,
  IconFileTypeJsx,
  IconFileTypePdf,
  IconFileTypePhp,
  IconFileTypePng,
  IconFileTypePpt,
  IconFileTypeRs,
  IconFileTypeSql,
  IconFileTypeSvg,
  IconFileTypeTs,
  IconFileTypeTsx,
  IconFileTypeTxt,
  IconFileTypeVue,
  IconFileTypeXls,
  IconFileTypeXml,
  IconFileTypeZip,
  IconJson,
  IconMarkdown,
  IconMovie,
  IconPhoto,
  IconTerminal2,
} from "@tabler/icons-react";

type Glyph = ComponentType<{ size?: number | string; stroke?: number | string; className?: string }>;

const BY_NAME: Record<string, Glyph> = {
  dockerfile: IconBrandDocker,
  containerfile: IconBrandDocker,
  makefile: IconFileCode,
  cmakelists: IconFileCode,
  procfile: IconTerminal2,
  gitignore: IconBrandGit,
  gitattributes: IconBrandGit,
  gitmodules: IconBrandGit,
  license: IconFileText,
  copying: IconFileText,
};

const BY_EXT: Record<string, Glyph> = {
  ts: IconFileTypeTs,
  mts: IconFileTypeTs,
  cts: IconFileTypeTs,
  tsx: IconFileTypeTsx,
  js: IconFileTypeJs,
  mjs: IconFileTypeJs,
  cjs: IconFileTypeJs,
  jsx: IconFileTypeJsx,
  vue: IconFileTypeVue,
  css: IconFileTypeCss,
  scss: IconFileTypeCss,
  sass: IconFileTypeCss,
  less: IconFileTypeCss,
  html: IconFileTypeHtml,
  htm: IconFileTypeHtml,
  xml: IconFileTypeXml,
  svg: IconFileTypeSvg,
  php: IconFileTypePhp,
  rs: IconFileTypeRs,
  sql: IconFileTypeSql,
  py: IconBrandPython,
  pyw: IconBrandPython,
  pyi: IconBrandPython,
  go: IconBrandGolang,
  kt: IconBrandKotlin,
  kts: IconBrandKotlin,
  cs: IconBrandCSharp,
  json: IconJson,
  jsonc: IconJson,
  json5: IconJson,
  mcmeta: IconJson,
  md: IconMarkdown,
  markdown: IconMarkdown,
  yml: IconFileCode,
  yaml: IconFileCode,
  toml: IconFileSettings,
  ini: IconFileSettings,
  conf: IconFileSettings,
  cfg: IconFileSettings,
  env: IconFileSettings,
  properties: IconFileSettings,
  htaccess: IconFileSettings,
  c: IconFileCode,
  h: IconFileCode,
  cpp: IconFileCode,
  cc: IconFileCode,
  cxx: IconFileCode,
  hpp: IconFileCode,
  java: IconFileCode,
  lua: IconFileCode,
  rb: IconFileCode,
  swift: IconFileCode,
  dart: IconFileCode,
  sh: IconTerminal2,
  bash: IconTerminal2,
  zsh: IconTerminal2,
  fish: IconTerminal2,
  ps1: IconTerminal2,
  bat: IconTerminal2,
  cmd: IconTerminal2,
  txt: IconFileTypeTxt,
  log: IconFileText,
  csv: IconFileTypeCsv,
  pdf: IconFileTypePdf,
  doc: IconFileTypeDoc,
  docx: IconFileTypeDocx,
  ppt: IconFileTypePpt,
  pptx: IconFileTypePpt,
  xls: IconFileTypeXls,
  xlsx: IconFileTypeXls,
  png: IconFileTypePng,
  jpg: IconFileTypeJpg,
  jpeg: IconFileTypeJpg,
  jfif: IconFileTypeJpg,
  bmp: IconFileTypeBmp,
  gif: IconPhoto,
  webp: IconPhoto,
  ico: IconPhoto,
  avif: IconPhoto,
  zip: IconFileTypeZip,
  rar: IconFileTypeZip,
  "7z": IconFileTypeZip,
  tar: IconFileTypeZip,
  gz: IconFileTypeZip,
  tgz: IconFileTypeZip,
  jar: IconFileTypeZip,
  war: IconFileTypeZip,
  mp3: IconFileMusic,
  wav: IconFileMusic,
  ogg: IconFileMusic,
  flac: IconFileMusic,
  mp4: IconMovie,
  webm: IconMovie,
  mov: IconMovie,
  avi: IconMovie,
  mkv: IconMovie,
};

function extensionOf(name: string) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) return "tgz";
  if (lower.endsWith(".d.ts") || lower.endsWith(".d.mts") || lower.endsWith(".d.cts")) return "ts";
  const dot = lower.lastIndexOf(".");
  if (dot <= 0) return lower.startsWith(".") ? lower.slice(1) : lower;
  return lower.slice(dot + 1);
}

export function fileIconFor(name: string): Glyph {
  const base = (name.split("/").pop() ?? name).toLowerCase();
  const stem = base.startsWith(".") ? base.slice(1) : base;
  return BY_NAME[stem] ?? BY_EXT[extensionOf(base)] ?? IconFileText;
}

export function FileTypeIcon({
  name,
  className,
  size = 16,
}: {
  name: string;
  className?: string;
  size?: number;
}) {
  const Icon = fileIconFor(name);
  return <Icon size={size} stroke={2} className={className} />;
}
