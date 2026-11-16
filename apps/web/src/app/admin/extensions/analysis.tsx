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
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

// Risk and severity are status text: coloured words (and a rail on findings), no pill backgrounds.
const RISK = {
  low: { label: "Low risk", className: "text-status-running", icon: ShieldCheck },
  medium: { label: "Review advised", className: "text-status-warn", icon: ShieldQuestion },
  high: { label: "High risk", className: "text-status-error", icon: ShieldAlert },
} as const;

const SEVERITY: Record<ExtensionFindingSeverity, { label: string; className: string; rail: string }> = {
  high: { label: "High", className: "text-status-error", rail: "bg-status-error" },
  medium: { label: "Medium", className: "text-status-warn", rail: "bg-status-warn" },
  low: { label: "Low", className: "text-muted-foreground", rail: "bg-status-offline/50" },
  info: { label: "Info", className: "text-status-info", rail: "bg-status-info" },
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
        "inline-flex items-center gap-1 rounded-md text-[13px] font-medium underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
        risk.className,
      )}
    >
      <Icon className="size-3.5" />
      {risk.label}
      {issues ? `, ${issues} issue${issues === 1 ? "" : "s"}` : ""}
    </button>
  );
}

function Chips({ icon: Icon, label, values, mono = true }: { icon: typeof Globe; label: string; values: string[]; mono?: boolean }) {
  if (!values.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </span>
      {values.map((value) => (
        <span key={value} className={cn("rounded-md border border-border px-1.5 py-0.5 text-[12px]", mono && "font-mono")}>
          {value}
        </span>
      ))}
    </div>
  );
}

function FindingRow({ finding }: { finding: ExtensionFinding }) {
  const severity = SEVERITY[finding.severity];
  return (
    <li className="relative space-y-1 px-4 py-3">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-[3px]", severity.rail)} />
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-sm font-medium">{finding.title}</span>
        <span className={cn("text-[13px] font-medium", severity.className)}>{severity.label}</span>
      </div>
      <p className="text-[13px] text-muted-foreground">{finding.detail}</p>
      {finding.file ? (
        <p className="inline-flex items-center gap-1 font-mono text-[12px] text-muted-foreground">
          <FileCode className="size-3" />
          {finding.file}
          {finding.line ? `:${finding.line}` : ""}
        </p>
      ) : null}
      {finding.snippet ? (
        <pre className="overflow-x-auto rounded-md border border-border bg-well px-2 py-1.5 font-mono text-[12px]">
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
      <p className="border-l-2 border-status-warn pl-3 text-[13px] text-muted-foreground">
        The code scan didn&apos;t run for this extension. Review its files manually before enabling.
      </p>
    );
  }
  const risk = RISK[analysis.risk];
  const Icon = risk.icon;
  const issues = analysis.findings.filter((finding) => finding.severity !== "info");
  return (
    // A seam-topped section of the dialog rather than a box inside it.
    <div className="space-y-2 border-t border-border pt-4">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-sm font-medium">
          <ScanSearch className="size-4 text-muted-foreground" />
          Code scan
        </span>
        <span className={cn("inline-flex items-center gap-1 text-[13px] font-medium", risk.className)}>
          <Icon className="size-3.5" />
          {risk.label}
        </span>
      </div>
      <Chips icon={Globe} label="Contacts" values={analysis.domains} />
      <Chips icon={Terminal} label="Commands" values={analysis.commands} />
      <Chips icon={FilePen} label="Writes" values={analysis.writes} />
      {issues.length ? (
        <ul className="space-y-1 text-[13px]">
          {issues.slice(0, 4).map((finding, index) => (
            <li key={`${finding.rule}-${index}`} className="flex gap-2">
              <span className={cn("w-14 shrink-0 font-medium", SEVERITY[finding.severity].className)}>
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
        <p className="text-[13px] text-muted-foreground">No issues found in {analysis.stats.files} files.</p>
      )}
      <button
        type="button"
        className="rounded-md text-[13px] font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        onClick={onOpenReport}
      >
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
      <p className={cn("inline-flex items-center gap-1.5 font-medium", risk.className)}>
        <Icon className="size-4" />
        {risk.label}
      </p>
      {/* Scan facts as labelled fields, not a dot-joined meta string. */}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
        <ScanFact label="Files">
          {analysis.stats.files}
          {analysis.stats.skipped ? <span className="text-muted-foreground"> ({analysis.stats.skipped} skipped)</span> : null}
        </ScanFact>
        <ScanFact label="Size">{formatBytes(analysis.stats.bytes)}</ScanFact>
        <ScanFact label="Languages">
          {analysis.stats.languages.length ? analysis.stats.languages.join(", ") : "None found"}
        </ScanFact>
        <ScanFact label="Scanned">{new Date(analysis.analyzedAt).toLocaleString()}</ScanFact>
      </dl>

      <div className="space-y-1.5">
        <Chips icon={Globe} label="Contacts" values={analysis.domains} />
        <Chips icon={Terminal} label="Commands" values={analysis.commands} />
        <Chips icon={FilePen} label="Writes" values={analysis.writes} />
      </div>

      {analysis.findings.length ? (
        // Findings as a rack: one row per finding, a severity rail on its left edge.
        <ul aria-label="Findings" className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {analysis.findings.map((finding, index) => (
            <FindingRow key={`${finding.rule}-${finding.file ?? ""}-${finding.line ?? index}`} finding={finding} />
          ))}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-input px-4 py-6 text-muted-foreground">
          Nothing to report. The scan found no risky patterns in these files.
        </p>
      )}

      <p className="text-[13px] text-muted-foreground">
        This is an automated, pattern-based scan of the extension&apos;s source. It can miss things and flag harmless
        code. Dependencies in <code className="font-mono">node_modules</code> and build folders aren&apos;t scanned.
        Whatever the result, extensions stay sandboxed and limited to the permissions you approve.
      </p>
    </div>
  );
}

/** One labelled scan fact in the report header. */
function ScanFact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className="truncate tabular-nums">{children}</dd>
    </div>
  );
}
