"use client";

/**
 * Code-scan UI for Admin → Extensions: the risk badge on each row, the short
 * summary inside the enable/approve dialog, and the full report.
 *
 * The scan itself runs on the API (apps/api/src/extension-analyzer.ts). It's
 * a heuristic reviewer's aid; the sandbox and permission checks are what
 * actually contain an extension, and the copy here says so.
 */

import { FileCode, Globe, ScanSearch, ShieldAlert, ShieldCheck, ShieldQuestion, Terminal, FilePen } from "lucide-react";
import type { ExtensionAnalysis, ExtensionFinding, ExtensionFindingSeverity } from "@flutter-software/shared";
import { cn } from "@/lib/cn";

const RISK = {
  low: { label: "Low risk", className: "bg-status-running/15 text-status-running", icon: ShieldCheck },
  medium: { label: "Review advised", className: "bg-status-warn/15 text-status-warn", icon: ShieldQuestion },
  high: { label: "High risk", className: "bg-status-error/15 text-status-error", icon: ShieldAlert },
} as const;

const SEVERITY: Record<ExtensionFindingSeverity, { label: string; className: string }> = {
  high: { label: "High", className: "bg-status-error/15 text-status-error" },
  medium: { label: "Medium", className: "bg-status-warn/15 text-status-warn" },
  low: { label: "Low", className: "bg-muted text-muted-foreground" },
  info: { label: "Info", className: "bg-status-info/15 text-status-info" },
};

function countIssues(analysis: ExtensionAnalysis) {
  return analysis.findings.filter((finding) => finding.severity !== "info").length;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Row badge; clicking opens the full report. */
export function RiskBadge({ analysis, onClick }: { analysis: ExtensionAnalysis | null; onClick: () => void }) {
  if (!analysis) return null;
  const risk = RISK[analysis.risk];
  const Icon = risk.icon;
  const issues = countIssues(analysis);
  return (
    <button
      type="button"
      onClick={onClick}
      title="View code scan report"
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-80",
        risk.className,
      )}
    >
      <Icon className="size-3" />
      {risk.label}
      {issues ? ` · ${issues}` : ""}
    </button>
  );
}

function Chips({ icon: Icon, label, values, mono = true }: { icon: typeof Globe; label: string; values: string[]; mono?: boolean }) {
  if (!values.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      {values.map((value) => (
        <span key={value} className={cn("rounded-md border border-border px-1.5 py-0.5 text-[11px]", mono && "font-mono")}>
          {value}
        </span>
      ))}
    </div>
  );
}

function FindingRow({ finding }: { finding: ExtensionFinding }) {
  const severity = SEVERITY[finding.severity];
  return (
    <li className="space-y-1 px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase", severity.className)}>{severity.label}</span>
        <span className="text-sm font-medium">{finding.title}</span>
      </div>
      <p className="text-xs text-muted-foreground">{finding.detail}</p>
      {finding.file ? (
        <p className="inline-flex items-center gap-1 font-mono text-[11px] text-muted-foreground">
          <FileCode className="size-3" />
          {finding.file}
          {finding.line ? `:${finding.line}` : ""}
        </p>
      ) : null}
      {finding.snippet ? (
        <pre className="overflow-x-auto rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[11px]">
          {finding.snippet}
        </pre>
      ) : null}
    </li>
  );
}

/**
 * Compact version for the enable/approve dialog: verdict, where data can go,
 * what it does, and the top issues.
 */
export function AnalysisSummary({ analysis, onOpenReport }: { analysis: ExtensionAnalysis | null; onOpenReport: () => void }) {
  if (!analysis) {
    return (
      <p className="rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground">
        The code scan didn&apos;t run for this extension. Review its files manually before enabling.
      </p>
    );
  }
  const risk = RISK[analysis.risk];
  const Icon = risk.icon;
  const issues = analysis.findings.filter((finding) => finding.severity !== "info");
  return (
    <div className="space-y-2 rounded-lg border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <ScanSearch className="size-4 text-muted-foreground" />
          Code scan
        </span>
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium", risk.className)}>
          <Icon className="size-3" />
          {risk.label}
        </span>
      </div>
      <Chips icon={Globe} label="Contacts" values={analysis.domains} />
      <Chips icon={Terminal} label="Commands" values={analysis.commands} />
      <Chips icon={FilePen} label="Writes" values={analysis.writes} />
      {issues.length ? (
        <ul className="space-y-1 text-xs">
          {issues.slice(0, 4).map((finding, index) => (
            <li key={`${finding.rule}-${index}`} className="flex gap-1.5">
              <span className={cn("mt-0.5 shrink-0 rounded px-1 text-[9px] font-semibold uppercase", SEVERITY[finding.severity].className)}>
                {SEVERITY[finding.severity].label}
              </span>
              <span>
                {finding.title}
                {finding.file ? (
                  <span className="font-mono text-muted-foreground">
                    {" "}
                    {finding.file}
                    {finding.line ? `:${finding.line}` : ""}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">No issues found in {analysis.stats.files} files.</p>
      )}
      <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={onOpenReport}>
        View full report
      </button>
    </div>
  );
}

/** Full report, shown in its own modal. */
export function AnalysisReport({ analysis }: { analysis: ExtensionAnalysis }) {
  const risk = RISK[analysis.risk];
  const Icon = risk.icon;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium", risk.className)}>
          <Icon className="size-3.5" />
          {risk.label}
        </span>
        <span className="text-xs text-muted-foreground">
          {analysis.stats.files} files · {formatBytes(analysis.stats.bytes)}
          {analysis.stats.languages.length ? ` · ${analysis.stats.languages.join(", ")}` : ""}
          {analysis.stats.skipped ? ` · ${analysis.stats.skipped} skipped` : ""} · scanned{" "}
          {new Date(analysis.analyzedAt).toLocaleString()}
        </span>
      </div>

      <div className="space-y-1.5">
        <Chips icon={Globe} label="Contacts" values={analysis.domains} />
        <Chips icon={Terminal} label="Commands" values={analysis.commands} />
        <Chips icon={FilePen} label="Writes" values={analysis.writes} />
      </div>

      {analysis.findings.length ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {analysis.findings.map((finding, index) => (
            <FindingRow key={`${finding.rule}-${finding.file ?? ""}-${finding.line ?? index}`} finding={finding} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-border px-3 py-6 text-center text-muted-foreground">Nothing to report.</p>
      )}

      <p className="text-xs text-muted-foreground">
        This is an automated, pattern-based scan of the extension&apos;s source. It can miss things and flag harmless
        code. Dependencies in <code className="font-mono">node_modules</code> and build folders aren&apos;t scanned.
        Whatever the result, extensions stay sandboxed and limited to the permissions you approve.
      </p>
    </div>
  );
}
