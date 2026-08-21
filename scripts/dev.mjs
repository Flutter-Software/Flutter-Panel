import { spawn } from "node:child_process";

const procs = [
  spawn("npm", ["run", "dev", "-w", "@flutter-software/api"], {
    stdio: "inherit",
    shell: true,
  }),
  spawn("npm", ["run", "dev", "-w", "@flutter-software/web"], {
    stdio: "inherit",
    shell: true,
  }),
];

for (const proc of procs) {
  proc.on("exit", (code) => {
    if (code && code !== 0) process.exitCode = code;
  });
}
