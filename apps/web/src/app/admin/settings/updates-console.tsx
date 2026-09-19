"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { cn } from "@/lib/cn";
import { ansiSpans, stripConsoleAnsi } from "@/lib/console-ansi";

export type UpdatePhase = "preparing" | "packages" | "database" | "building" | "promoting" | "restarting";

export type UpdateOptions = {
  applySchema: boolean;
  restartDaemon: boolean;
};

export type UpdateJob = {
  state: "idle" | "running" | "ok" | "failed";
  log: string[];
  startedAt?: string;
  finishedAt?: string;
  error?: string | null;
  sha?: string;
  version?: string;
  phase?: UpdatePhase | null;
  activity?: string | null;
  options?: UpdateOptions | null;
};

export type UpdateStatus = {
  version: string;
  repo: string;
  ref: string;
  currentSha: string;
  currentShortSha: string;
  latest: { sha: string; shortSha: string; message: string; date: string; url: string };
  updateAvailable: boolean;
  canUpdate: boolean;
  blockedReason: string | null;
  method: "git" | "clone";
  checkError: string | null;
  job: UpdateJob;
};

const BANNER = `███████╗██╗     ██╗   ██╗████████╗████████╗███████╗██████╗
██╔════╝██║     ██║   ██║╚══██╔══╝╚══██╔══╝██╔════╝██╔══██╗
█████╗  ██║     ██║   ██║   ██║      ██║   █████╗  ██████╔╝
██╔══╝  ██║     ██║   ██║   ██║      ██║   ██╔══╝  ██╔══██╗
██║     ███████╗╚██████╔╝   ██║      ██║   ███████╗██║  ██║
╚═╝     ╚══════╝ ╚═════╝    ╚═╝      ╚═╝   ╚══════╝╚═╝  ╚═╝`;

const PHASES: { id: UpdatePhase; title: string }[] = [
  { id: "preparing", title: "Preparing staging" },
  { id: "packages", title: "Installing packages" },
  { id: "database", title: "Applying database" },
  { id: "building", title: "Building panel" },
  { id: "promoting", title: "Promoting live install" },
  { id: "restarting", title: "Restarting services" },
];

type WizardStep = "schema" | "daemon" | "confirm";
type HistoryItem = { header: string; answer: string };

function yesNo(value: boolean) {
  return value ? "Yes" : "No";
}

function visiblePhases(applySchema: boolean) {
  return PHASES.filter((phase) => phase.id !== "database" || applySchema);
}

function phaseStatus(
  id: UpdatePhase,
  job: UpdateJob,
  running: boolean,
  applySchema: boolean,
): "pending" | "current" | "done" | "failed" {
  const list = visiblePhases(applySchema);
  const thisIndex = list.findIndex((phase) => phase.id === id);
  const currentIndex = list.findIndex((phase) => phase.id === job.phase);
  if (thisIndex < 0) return "pending";
  if (job.state === "ok") return "done";
  if (job.state === "failed") {
    if (currentIndex < 0) return thisIndex === 0 ? "failed" : "pending";
    if (thisIndex < currentIndex) return "done";
    if (thisIndex === currentIndex) return "failed";
    return "pending";
  }
  if (!running && job.state !== "running") return "pending";
  if (currentIndex < 0) return thisIndex === 0 && running ? "current" : "pending";
  if (thisIndex < currentIndex) return "done";
  if (thisIndex === currentIndex) return "current";
  return "pending";
}

function pad(value: string, width: number) {
  if (value.length >= width) return value.slice(0, width);
  return `${value}${" ".repeat(width - value.length)}`;
}

function KvTable({ rows }: { rows: [string, string][] }) {
  const keyW = Math.max(12, ...rows.map(([key]) => key.length));
  const valW = Math.min(64, Math.max(24, ...rows.map(([, value]) => value.length)));
  const top = `┌${"─".repeat(keyW + 2)}┬${"─".repeat(valW + 2)}┐`;
  const bottom = `└${"─".repeat(keyW + 2)}┴${"─".repeat(valW + 2)}┘`;
  return (
    <div className="overflow-x-auto whitespace-pre text-zinc-100">
      <div>{top}</div>
      {rows.map(([key, value]) => (
        <div key={key}>
          │ {pad(key, keyW)} │ {pad(value.length > valW ? `${value.slice(0, valW - 1)}…` : value, valW)} │
        </div>
      ))}
      <div>{bottom}</div>
    </div>
  );
}

function RadioPrompt({
  header,
  options,
  selected,
  onSelect,
  onConfirm,
}: {
  header: string;
  options: string[];
  selected: number;
  onSelect: (index: number) => void;
  onConfirm: () => void;
}) {
  return (
    <div>
      <div className="text-zinc-100">{header}</div>
      <div className="text-zinc-500">↑/↓ move · enter to confirm</div>
      <div className="mt-3 space-y-0.5">
        {options.map((option, index) => {
          const active = index === selected;
          return (
            <button
              key={option}
              type="button"
              className={cn(
                "block w-full rounded-sm px-0 text-left outline-none",
                active ? "text-zinc-100" : "text-zinc-500",
              )}
              onClick={() => {
                if (active) onConfirm();
                else onSelect(index);
              }}
            >
              <span className={active ? "text-primary" : "text-zinc-600"}>{active ? "●" : "○"}</span> {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function LogLine({ line }: { line: string }) {
  const plain = stripConsoleAnsi(line);
  const banner = plain.startsWith("╔") || plain.startsWith("║") || plain.startsWith("╚");
  const spans = ansiSpans(line);
  return (
    <div className={cn("whitespace-pre-wrap break-all", banner && "font-semibold text-primary")}>
      {spans.length
        ? spans.map((span, index) => (
            <span key={index} className={span.className || undefined}>
              {span.text}
            </span>
          ))
        : line}
    </div>
  );
}

function StepEditor({
  job,
  running,
  applySchema,
  preview,
}: {
  job: UpdateJob;
  running: boolean;
  applySchema: boolean;
  preview: boolean;
}) {
  const phases = visiblePhases(applySchema);
  return (
    <aside className="flex max-h-48 shrink-0 flex-col border-t border-zinc-800 bg-zinc-950 lg:max-h-none lg:w-72 lg:border-l lg:border-t-0">
      <div className="border-b border-zinc-800 px-4 py-3">
        <p className="font-mono text-[11px] font-semibold tracking-wide text-primary">
          {running || job.state === "running" ? "UPDATING" : preview ? "WILL UPDATE" : "UPDATE"}
        </p>
        <p className="mt-1 font-mono text-[11px] text-zinc-500">
          {job.activity || (preview ? "Waiting for confirm" : "Idle")}
        </p>
      </div>
      <ol className="min-h-0 flex-1 space-y-1 overflow-y-auto px-4 py-3">
        {phases.map((phase) => {
          const status = preview ? "pending" : phaseStatus(phase.id, job, running, applySchema);
          const current = status === "current";
          return (
            <li key={phase.id} className="font-mono text-[12px] leading-5">
              <div
                className={cn(
                  "flex gap-2",
                  status === "done" && "text-zinc-500",
                  current && "text-zinc-100",
                  status === "failed" && "text-red-400",
                  status === "pending" && "text-zinc-600",
                )}
              >
                <span className={cn("shrink-0", current && "text-primary", status === "done" && "text-emerald-500")}>
                  {status === "done" ? "✓" : status === "failed" ? "×" : current ? "●" : "○"}
                </span>
                <span>
                  {phase.title}
                  {current && job.activity ? (
                    <span className="mt-0.5 block text-[11px] text-zinc-500">{job.activity}</span>
                  ) : null}
                </span>
              </div>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function LiveWizard({
  status,
  enabled,
  shellRef,
  onStart,
  onOptions,
}: {
  status: UpdateStatus | null;
  enabled: boolean;
  shellRef: RefObject<HTMLDivElement | null>;
  onStart: (options: UpdateOptions) => void;
  onOptions: (options: UpdateOptions) => void;
}) {
  const [step, setStep] = useState<WizardStep>("schema");
  const [selected, setSelected] = useState(0);
  const [applySchema, setApplySchema] = useState(true);
  const [restartDaemon, setRestartDaemon] = useState(true);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const stepRef = useRef(step);
  const selectedRef = useRef(selected);
  const applyRef = useRef(applySchema);
  const daemonRef = useRef(restartDaemon);
  const onStartRef = useRef(onStart);
  const onOptionsRef = useRef(onOptions);

  stepRef.current = step;
  selectedRef.current = selected;
  applyRef.current = applySchema;
  daemonRef.current = restartDaemon;
  onStartRef.current = onStart;
  onOptionsRef.current = onOptions;

  const options = ["Yes", "No"];
  const header =
    step === "schema"
      ? "Apply database schema changes?"
      : step === "daemon"
        ? "Restart the game-node daemon on this machine?"
        : "Start update with these settings?";

  function confirmChoice(index = selectedRef.current) {
    const answer = options[index] === "Yes";
    const currentStep = stepRef.current;
    const currentHeader =
      currentStep === "schema"
        ? "Apply database schema changes?"
        : currentStep === "daemon"
          ? "Restart the game-node daemon on this machine?"
          : "Start update with these settings?";
    if (currentStep === "schema") {
      setApplySchema(answer);
      applyRef.current = answer;
      onOptionsRef.current({ applySchema: answer, restartDaemon: daemonRef.current });
      setHistory((current) => [...current, { header: currentHeader, answer: yesNo(answer) }]);
      setStep("daemon");
      stepRef.current = "daemon";
      setSelected(0);
      selectedRef.current = 0;
      return;
    }
    if (currentStep === "daemon") {
      setRestartDaemon(answer);
      daemonRef.current = answer;
      onOptionsRef.current({ applySchema: applyRef.current, restartDaemon: answer });
      setHistory((current) => [...current, { header: currentHeader, answer: yesNo(answer) }]);
      setStep("confirm");
      stepRef.current = "confirm";
      setSelected(0);
      selectedRef.current = 0;
      return;
    }
    if (!answer) return;
    if (!status?.canUpdate) return;
    onStartRef.current({ applySchema: applyRef.current, restartDaemon: daemonRef.current });
  }

  const confirmChoiceRef = useRef(confirmChoice);
  confirmChoiceRef.current = confirmChoice;

  useEffect(() => {
    if (!enabled) return;
    function onKey(event: KeyboardEvent) {
      const shell = shellRef.current;
      if (!shell?.getClientRects().length) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
      if (target?.closest("button") && !shell.contains(target)) return;
      if (event.key === "ArrowUp" || event.key === "k") {
        event.preventDefault();
        setSelected((current) => {
          const next = (current - 1 + 2) % 2;
          selectedRef.current = next;
          return next;
        });
      } else if (event.key === "ArrowDown" || event.key === "j") {
        event.preventDefault();
        setSelected((current) => {
          const next = (current + 1) % 2;
          selectedRef.current = next;
          return next;
        });
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        confirmChoiceRef.current(selectedRef.current);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [enabled, shellRef]);

  const tableRows: [string, string][] = [
    ["Current", `v${status?.version ?? "…"} (${status?.currentShortSha || "unknown"})`],
    ["GitHub", `${status?.ref ?? "main"} ${status?.latest.shortSha || "—"}`],
    ["Message", status?.latest.message || "—"],
    ["Database", yesNo(applySchema)],
    ["Local daemon", yesNo(restartDaemon)],
    ["Panel restart", "Yes"],
  ];

  return (
    <div className="space-y-4">
      <pre className="overflow-x-auto whitespace-pre text-[8px] leading-[1.08] text-primary sm:text-[10px] sm:leading-[1.12]">
        {BANNER}
      </pre>
      <div>
        <div className="font-semibold text-zinc-100">FLUTTER updater</div>
        <div className="text-zinc-500">Arrow keys to move · enter to confirm</div>
        {status?.blockedReason ? <div className="mt-2 text-red-400">{status.blockedReason}</div> : null}
      </div>
      {history.map((item) => (
        <div key={item.header} className="space-y-1">
          <div className="text-zinc-100">{item.header}</div>
          <div>
            <span className="text-primary">●</span> <span className="text-zinc-300">{item.answer}</span>
          </div>
        </div>
      ))}
      {step === "confirm" ? <KvTable rows={tableRows} /> : null}
      <RadioPrompt
        header={header}
        options={options}
        selected={selected}
        onSelect={(index) => {
          selectedRef.current = index;
          setSelected(index);
        }}
        onConfirm={() => confirmChoice(selected)}
      />
    </div>
  );
}

function ConsolePane({
  showWizard,
  status,
  job,
  running,
  starting,
  scroller,
  stickToBottom,
  enabled,
  shellRef,
  onStart,
  onOptions,
}: {
  showWizard: boolean;
  status: UpdateStatus | null;
  job: UpdateJob;
  running: boolean;
  starting: boolean;
  scroller: RefObject<HTMLDivElement | null>;
  stickToBottom: { current: boolean };
  enabled: boolean;
  shellRef: RefObject<HTMLDivElement | null>;
  onStart: (options: UpdateOptions) => void;
  onOptions: (options: UpdateOptions) => void;
}) {
  if (showWizard) {
    return (
      <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 font-mono text-[12px] leading-5 text-zinc-300">
        <LiveWizard status={status} enabled={enabled} shellRef={shellRef} onStart={onStart} onOptions={onOptions} />
      </div>
    );
  }

  const empty = !job.log.length && !starting && job.state !== "running";
  return (
    <div
      ref={scroller}
      className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-4 font-mono text-[12px] leading-5 text-zinc-300"
      onScroll={(event) => {
        const el = event.currentTarget;
        stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
      }}
    >
      {empty ? (
        <p>No updater output yet. Start an update to stream logs here.</p>
      ) : (
        job.log.map((line, index) => <LogLine key={`${index}:${line.slice(0, 32)}`} line={line} />)
      )}
      {running ? <span className="ml-0.5 inline-block animate-pulse text-primary">▋</span> : null}
    </div>
  );
}

export function shouldOpenUpdaterWizard(intent: "wizard" | "logs", job: UpdateJob) {
  if (job.state === "running") return false;
  if (intent === "wizard") return true;
  return job.state === "idle" && job.log.length === 0;
}

export function UpdateConsole({
  running,
  job,
  status,
  wizard,
  starting,
  onStart,
  className,
}: {
  running: boolean;
  job: UpdateJob;
  status: UpdateStatus | null;
  wizard: boolean;
  starting: boolean;
  onStart: (options: UpdateOptions) => void;
  className?: string;
}) {
  const shellRef = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const [wizardOptions, setWizardOptions] = useState<UpdateOptions>({
    applySchema: true,
    restartDaemon: true,
  });
  const showWizard = wizard && !running && !starting && job.state !== "running";
  const applySchema = job.options?.applySchema ?? wizardOptions.applySchema;

  useEffect(() => {
    if (showWizard) {
      setWizardOptions({ applySchema: true, restartDaemon: true });
      stickToBottom.current = true;
    }
  }, [showWizard]);

  useEffect(() => {
    const el = scroller.current;
    if (!el || showWizard || !stickToBottom.current) return;
    el.scrollTop = el.scrollHeight;
  }, [job.log, showWizard, running]);

  return (
    <div
      ref={shellRef}
      data-updater-console=""
      tabIndex={0}
      aria-label="Updater console"
      className={cn(
        "flex h-[min(36rem,70vh)] flex-col overflow-hidden bg-black outline-none lg:flex-row",
        className,
      )}
    >
      <ConsolePane
        showWizard={showWizard}
        status={status}
        job={job}
        running={running || starting}
        starting={starting}
        scroller={scroller}
        stickToBottom={stickToBottom}
        enabled={showWizard}
        shellRef={shellRef}
        onStart={(next) => {
          setWizardOptions(next);
          onStart(next);
        }}
        onOptions={setWizardOptions}
      />
      <StepEditor job={job} running={running || starting} applySchema={applySchema} preview={showWizard} />
    </div>
  );
}
