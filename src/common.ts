import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

export const HOME = homedir();
export const XDG = process.env.XDG_CONFIG_HOME ?? join(HOME, ".config");
export const CONFIG_DIR = join(XDG, "term-wallpaper");
export const CACHE = join(HOME, "Library/Caches/term-wallpaper");

const SETTINGS = join(CONFIG_DIR, "settings.json");
const CURRENT = join(CONFIG_DIR, "current");
// App-managed, unlike settings.json: `config` can't reach it.
const ENVS = join(CONFIG_DIR, "envs.json");

export const ENV_IDS = ["ghostty", "iterm2"] as const;
export type EnvId = (typeof ENV_IDS)[number];
export const isEnvId = (s: string): s is EnvId => (ENV_IDS as readonly string[]).includes(s);

export type Settings = {
  dir: string;
  fade: string;
  fps: number;
  every: string;
  order: "sequential" | "random";
  opacity: number;
  size: [number, number];
};

const DEFAULTS: Settings = {
  dir: "~/Pictures/wallpapers",
  fade: "500ms",
  fps: 25,
  every: "off",
  order: "sequential",
  opacity: 0.3,
  size: [2560, 1440],
};

export const expand = (p: string) => resolve(p.replace(/^~(?=$|\/)/, HOME));

export function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** "500ms", "1.5s", "15m", "1h" → milliseconds; bare "0" allowed. */
export function duration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(s);
  if (!m || (!m[2] && m[1] !== "0")) fail(`bad duration: ${s} (use e.g. 500ms, 30s, 15m, 1h)`);
  const unit = { ms: 1, s: 1e3, m: 60e3, h: 3600e3 }[m[2] ?? "ms"]!;
  return Number(m[1]) * unit;
}

export function loadSettings(): Settings {
  if (!existsSync(SETTINGS)) return { ...DEFAULTS };
  return { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS, "utf8")) };
}

export function saveSettings(s: Settings) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + "\n");
}

/** Source path of the wallpaper on screen, if any. */
export function current(): string | undefined {
  if (!existsSync(CURRENT)) return;
  return readFileSync(CURRENT, "utf8").trim() || undefined;
}

export function setCurrent(src: string | undefined) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(CURRENT, src ? src + "\n" : "");
}

/** Terminals `init` has set up, in the order they were added. */
export function loadEnvs(): EnvId[] {
  if (!existsSync(ENVS)) return [];
  return (JSON.parse(readFileSync(ENVS, "utf8")) as string[]).filter(isEnvId);
}

export function saveEnvs(envs: EnvId[]) {
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(ENVS, JSON.stringify(envs) + "\n");
}

/** A terminal that can show a background image. */
export interface Terminal {
  id: EnvId;
  name: string;
  /**
   * Whether this terminal's own setup is in place (Ghostty: its config includes
   * wallpaper.conf), or undefined for a terminal that keeps no setup to check.
   */
  setUp(): boolean | undefined;
  /** Able to show a change right now (iTerm2: running). */
  reachable(): boolean;
  /** Setup; idempotent, and adopts a setup already in place. Returns lines to print. */
  init(): string[];
  /** Show each image in turn, `frameMs` apart, leaving the last on screen. */
  play(images: string[], frameMs: number, s: Settings): Promise<void>;
  /** Re-show `image` after a settings change. */
  restyle(image: string, s: Settings): void;
  /** Remove the background image. */
  clear(): void;
  /** Undo this terminal's `init` and wallpaper; returns lines to print. */
  uninstall(): string[];
}
