#!/usr/bin/env bun
// Cycle Ghostty background images with a crossfade.
//
// Ghostty has no image transitions, so a change pre-renders blended frames and
// reloads the config through them (SIGUSR2). The current pick lives in
// ~/.config/ghostty/wallpaper.conf, included from the main Ghostty config.

import sharp from "sharp";
import { homedir, userInfo } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import {
  appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync,
  realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";

const HOME = homedir();
const XDG = process.env.XDG_CONFIG_HOME ?? join(HOME, ".config");
const STATE = join(XDG, "ghostty/wallpaper.conf");
const SETTINGS = join(XDG, "ghostty-wallpaper/settings.json");
const CACHE = join(HOME, "Library/Caches/ghostty-wallpaper");
const LABEL = "com.ghostty-wallpaper";
const PLIST = join(HOME, "Library/LaunchAgents", `${LABEL}.plist`);
const LOG = join(HOME, "Library/Logs/ghostty-wallpaper.log");
const IMAGE = /\.(jpe?g|png|webp)$/i;

type Settings = {
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

// --- helpers ---------------------------------------------------------------

const expand = (p: string) => resolve(p.replace(/^~(?=$|\/)/, HOME));

function fail(msg: string): never {
  console.error(msg);
  process.exit(1);
}

/** "500ms", "1.5s", "15m", "1h" → milliseconds; bare "0" allowed. */
function duration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|m|h)?$/.exec(s);
  if (!m || (!m[2] && m[1] !== "0")) fail(`bad duration: ${s} (use e.g. 500ms, 30s, 15m, 1h)`);
  const unit = { ms: 1, s: 1e3, m: 60e3, h: 3600e3 }[m[2] ?? "ms"]!;
  return Number(m[1]) * unit;
}

function loadSettings(): Settings {
  if (!existsSync(SETTINGS)) return { ...DEFAULTS };
  return { ...DEFAULTS, ...JSON.parse(readFileSync(SETTINGS, "utf8")) };
}

function saveSettings(s: Settings) {
  mkdirSync(join(SETTINGS, ".."), { recursive: true });
  writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + "\n");
}

function images(s: Settings): string[] {
  const dir = expand(s.dir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => IMAGE.test(f)).sort().map((f) => join(dir, f));
}

function current(): string | undefined {
  if (!existsSync(STATE)) return;
  return /^# src: (.+)$/m.exec(readFileSync(STATE, "utf8"))?.[1];
}

function reload() {
  Bun.spawnSync(["pkill", "-USR2", "-x", "ghostty"]);
}

function show(s: Settings, src: string, img: string) {
  writeFileSync(STATE, [
    "# Managed by ghostty-wallpaper; changes are overwritten.",
    `# src: ${src}`,
    `background-image = ${img}`,
    "background-image-fit = cover",
    `background-image-opacity = ${s.opacity}`,
    "",
  ].join("\n"));
  reload();
}

/** Cover-crop to screen size so any two images can be blended; cached. */
async function normalize(s: Settings, src: string): Promise<string> {
  const [w, h] = s.size;
  const out = join(CACHE, "norm", `${w}x${h}-${basename(src, extname(src))}.jpg`);
  if (!existsSync(out) || statSync(src).mtimeMs > statSync(out).mtimeMs) {
    mkdirSync(join(out, ".."), { recursive: true });
    await sharp(src).rotate().resize(w, h, { fit: "cover" })
      .toColourspace("srgb").jpeg({ quality: 92 }).toFile(out);
  }
  return out;
}

async function apply(s: Settings, src: string) {
  const to = await normalize(s, src);
  const prev = current();
  const frames = Math.round((duration(s.fade) / 1000) * s.fps);

  if (prev && prev !== src && existsSync(prev) && frames > 1) {
    const from = await normalize(s, prev);
    const dir = join(CACHE, "fade", String(process.pid));
    rmSync(join(CACHE, "fade"), { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });

    // Overlay the new image at rising alpha. Unique paths per frame so
    // Ghostty can't serve a cached image.
    const paths = await Promise.all(
      Array.from({ length: frames - 1 }, async (_, i) => {
        const { data, info } = await sharp(to).ensureAlpha((i + 1) / frames)
          .raw().toBuffer({ resolveWithObject: true });
        const path = join(dir, `${i + 1}.jpg`);
        await sharp(from).composite([{ input: data, raw: info }])
          .jpeg({ quality: 85 }).toFile(path);
        return path;
      }),
    );
    for (const path of paths) {
      show(s, src, path);
      await Bun.sleep(1000 / s.fps);
    }
  }

  show(s, src, to);
  console.log(`set: ${basename(src)}`);
}

function pick(s: Settings, step: 1 | -1): string {
  const imgs = images(s);
  if (!imgs.length) fail(`no images in ${s.dir}`);
  const i = imgs.indexOf(current() ?? "");
  if (i < 0) return step > 0 ? imgs[0]! : imgs.at(-1)!;
  return imgs[(i + step + imgs.length) % imgs.length]!;
}

function pickRandom(s: Settings): string {
  const imgs = images(s);
  if (!imgs.length) fail(`no images in ${s.dir}`);
  const pool = imgs.length > 1 ? imgs.filter((f) => f !== current()) : imgs;
  return pool[Math.floor(Math.random() * pool.length)]!;
}

/** Main display's pixel size, or undefined if it can't be read. */
function screenSize(): [number, number] | undefined {
  const out = Bun.spawnSync(["system_profiler", "SPDisplaysDataType", "-json"]).stdout.toString();
  try {
    const gpus = JSON.parse(out).SPDisplaysDataType ?? [];
    const displays = gpus.flatMap((g: any) => g.spdisplays_ndrvs ?? []);
    const main = displays.find((d: any) => d.spdisplays_main === "spdisplays_yes") ?? displays[0];
    const m = /(\d+) x (\d+)/.exec(main?._spdisplays_pixels ?? "");
    if (m) return [Number(m[1]), Number(m[2])];
  } catch {}
}

function ghosttyConfig(): string {
  const candidates = [
    join(XDG, "ghostty/config.ghostty"),
    join(XDG, "ghostty/config"),
    join(HOME, "Library/Application Support/com.mitchellh.ghostty/config.ghostty"),
    join(HOME, "Library/Application Support/com.mitchellh.ghostty/config"),
  ];
  return candidates.find(existsSync) ?? candidates[0]!;
}

// --- launchd timer -----------------------------------------------------------

function launchctl(...args: string[]) {
  return Bun.spawnSync(["launchctl", ...args]);
}

function setTimer(every: string) {
  const domain = `gui/${userInfo().uid}`;
  launchctl("bootout", `${domain}/${LABEL}`);
  if (every === "off") {
    rmSync(PLIST, { force: true });
    return;
  }
  const seconds = Math.max(1, Math.round(duration(every) / 1000));
  const args = [process.execPath, realpathSync(Bun.main), "next"];
  mkdirSync(join(PLIST, ".."), { recursive: true });
  writeFileSync(PLIST, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${LABEL}</string>
	<key>ProgramArguments</key>
	<array>
${args.map((a) => `\t\t<string>${a}</string>`).join("\n")}
	</array>
	<key>StartInterval</key>
	<integer>${seconds}</integer>
	<key>StandardErrorPath</key>
	<string>${LOG}</string>
</dict>
</plist>
`);
  const r = launchctl("bootstrap", domain, PLIST);
  if (r.exitCode !== 0) fail(`launchctl bootstrap failed: ${r.stderr.toString().trim()}`);
}

// --- commands ----------------------------------------------------------------

async function init(args: string[]) {
  const s = loadSettings();
  const i = args.indexOf("--dir");
  if (i >= 0) s.dir = args[i + 1] ?? fail("usage: ghostty-wallpaper init [--dir <path>]");

  mkdirSync(expand(s.dir), { recursive: true });
  s.size = screenSize() ?? s.size;
  saveSettings(s);

  const config = ghosttyConfig();
  const text = existsSync(config) ? readFileSync(config, "utf8") : "";
  if (/^\s*config-file\s*=.*ghostty\/wallpaper\.conf\s*$/m.test(text)) {
    console.log(`ghostty config: ${config} (already includes wallpaper.conf)`);
  } else {
    mkdirSync(join(config, ".."), { recursive: true });
    const sep = text && !text.endsWith("\n") ? "\n" : "";
    appendFileSync(config, `${sep}\n# Background image, managed by ghostty-wallpaper\nconfig-file = ?${STATE}\n`);
    console.log(`ghostty config: ${config} (added wallpaper.conf include)`);
  }
  console.log(`images: ${s.dir} (${images(s).length} found)`);
  console.log(`screen: ${s.size.join("x")}`);

  const cur = current();
  if (cur && existsSync(cur)) await apply(s, cur);
  else if (images(s).length) await apply(s, s.order === "random" ? pickRandom(s) : pick(s, 1));
}

function config(args: string[]) {
  const s = loadSettings();
  if (!args.length) {
    for (const [k, v] of Object.entries(s)) {
      console.log(`${k}=${Array.isArray(v) ? v.join("x") : v}`);
    }
    return;
  }
  let restyle = false;
  for (const arg of args) {
    const [key, value] = arg.split(/=(.*)/s);
    if (value === undefined) fail(`expected key=value, got: ${arg}`);
    switch (key) {
      case "dir":
        if (!existsSync(expand(value))) fail(`no such directory: ${value}`);
        s.dir = value;
        break;
      case "fade":
        duration(value);
        s.fade = value;
        break;
      case "fps":
        s.fps = Number(value);
        if (!Number.isInteger(s.fps) || s.fps < 1 || s.fps > 60) fail("fps must be 1–60");
        break;
      case "every":
        if (value !== "off") duration(value);
        s.every = value;
        setTimer(value);
        break;
      case "order":
        if (value !== "sequential" && value !== "random") fail("order must be sequential or random");
        s.order = value;
        break;
      case "opacity":
        s.opacity = Number(value);
        if (!(s.opacity >= 0 && s.opacity <= 1)) fail("opacity must be 0–1");
        restyle = true;
        break;
      case "size": {
        const m = /^(\d+)x(\d+)$/.exec(value) ?? fail("size must be WIDTHxHEIGHT");
        s.size = [Number(m[1]), Number(m[2])];
        break;
      }
      default:
        fail(`unknown setting: ${key} (dir, fade, fps, every, order, opacity, size)`);
    }
    console.log(`${key}=${value}`);
  }
  saveSettings(s);

  const cur = current();
  if (restyle && cur && existsSync(STATE)) {
    const img = /^background-image = (.+)$/m.exec(readFileSync(STATE, "utf8"))?.[1];
    if (img) show(s, cur, img);
  }
}

const USAGE = `usage: ghostty-wallpaper <command>

  init [--dir <path>]     Set up the Ghostty config, image folder and screen size
  next, -n, --next        Next wallpaper (random if order=random)
  prev, -p, --prev        Previous wallpaper in folder order
  random                  Random wallpaper
  set <file>              Specific wallpaper
  list                    List images, current one marked
  config [key=value ...]  Show or change settings:
                            dir, fade (500ms), fps (25), every (off|15m),
                            order (sequential|random), opacity (0.3), size (2560x1440)
  off                     Clear the wallpaper`;

const [cmd = "next", ...rest] = process.argv.slice(2);
const s = loadSettings();

switch (cmd) {
  case "init":
    await init(rest);
    break;
  case "next": case "-n": case "--next":
    await apply(s, s.order === "random" ? pickRandom(s) : pick(s, 1));
    break;
  case "prev": case "-p": case "--prev":
    await apply(s, pick(s, -1));
    break;
  case "random":
    await apply(s, pickRandom(s));
    break;
  case "set": {
    const file = rest[0] ? expand(rest[0]) : fail("usage: ghostty-wallpaper set <file>");
    if (!existsSync(file)) fail(`no such file: ${rest[0]}`);
    await apply(s, file);
    break;
  }
  case "list": {
    const cur = current();
    for (const f of images(s)) console.log(`${f === cur ? "*" : " "} ${basename(f)}`);
    break;
  }
  case "config":
    config(rest);
    break;
  case "off":
    rmSync(STATE, { force: true });
    rmSync(join(CACHE, "fade"), { recursive: true, force: true });
    reload();
    console.log("wallpaper off");
    break;
  case "help": case "-h": case "--help":
    console.log(USAGE);
    break;
  default:
    fail(USAGE);
}
