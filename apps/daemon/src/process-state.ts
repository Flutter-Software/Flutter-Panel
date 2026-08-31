export type ProcessState = "offline" | "starting" | "running" | "stopping";

const states = new Map<string, ProcessState>();

let statusBroadcast: ((uuid: string, state: ProcessState) => void) | null = null;
let panelReporter: ((uuid: string, state: ProcessState) => void) | null = null;

export function setStatusBroadcast(fn: (uuid: string, state: ProcessState) => void) {
  statusBroadcast = fn;
}

export function setPanelStateReporter(fn: (uuid: string, state: ProcessState) => void) {
  panelReporter = fn;
}

export function getProcessState(uuid: string): ProcessState {
  return states.get(uuid) ?? "offline";
}

export function setProcessState(uuid: string, state: ProcessState) {
  if (states.get(uuid) === state) return false;
  states.set(uuid, state);
  statusBroadcast?.(uuid, state);
  panelReporter?.(uuid, state);
  return true;
}
