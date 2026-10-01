// Which terminal this command is running in.
//
// Walks the process tree up from this process to the first terminal app. The
// environment can't be trusted for this: tmux and similar multiplexers keep the
// TERM_PROGRAM of whichever terminal first started them. A session that has
// outlived its terminal (detached tmux, herdr) has no terminal ancestor at all,
// so it can't be resolved; `--env` names the terminal instead.

import { basename } from "node:path";
import { fail, isEnvId, type EnvId, ENV_IDS } from "./common";

/** Process names, as `ps` reports them, of each supported terminal. */
const PROCESS: Record<string, EnvId> = { ghostty: "ghostty", iTerm2: "iterm2" };

/** The terminal running this process, or undefined if there isn't one. */
export function detect(): EnvId | undefined {
  const out = Bun.spawnSync(["ps", "-axo", "pid=,ppid=,comm="]).stdout.toString();
  const parent = new Map<number, number>();
  const name = new Map<number, string>();
  for (const line of out.split("\n")) {
    const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
    if (!m) continue;
    parent.set(Number(m[1]), Number(m[2]));
    name.set(Number(m[1]), basename(m[3]!.trim()));
  }
  for (let pid = process.pid, seen = 0; pid > 1 && seen < 64; seen++) {
    const env = PROCESS[name.get(pid) ?? ""];
    if (env) return env;
    pid = parent.get(pid) ?? 0;
  }
}

/** The terminal a command should act on: `--env` if given, else the detected one. */
export function resolve(flag?: string): EnvId {
  const usage = `pass --env ${ENV_IDS.join("|")}`;
  if (flag !== undefined) {
    if (isEnvId(flag)) return flag;
    fail(`unknown terminal: ${flag} (${usage})`);
  }
  return detect() ?? fail(`can't tell which terminal this is running in; ${usage}`);
}
