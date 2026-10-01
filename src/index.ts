#!/usr/bin/env bun
// Rotate terminal background images with a crossfade.
//
// Terminals have no image transitions, so a change pre-renders blended frames
// and shows them in quick succession.
//
// `init` and `uninstall` act only on the terminal they run in (src/env.ts), or
// the one `--env` names. Wallpaper changes go to every terminal set up so far
// (envs.json), since there is one current image and the timer runs outside any
// terminal.

import sharp from "sharp";
import { userInfo } from "node:os";
import { basename, extname, join } from "node:path";
import {
  existsSync, mkdirSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import {
  CACHE, ENV_IDS, HOME, current, duration, expand, fail, loadEnvs, loadSettings, saveEnvs,
  saveSettings, setCurrent, type EnvId, type Settings, type Terminal,
} from "./common";
import { resolve } from "./env";
import { ghostty } from "./ghostty";
import { iterm2 } from "./iterm2";

const ADAPTERS: Record<EnvId, Terminal> = { ghostty, iterm2 };
const LABEL = "com.term-wallpaper";
const PLIST = join(HOME, "Library/LaunchAgents", `${LABEL}.plist`);
const LOG = join(HOME, "Library/Logs/term-wallpaper.log");
const IMAGE = /\.(jpe?g|png|webp)$/i;

function images(s: Settings): string[] {
  const dir = expand(s.dir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => IMAGE.test(f)).sort().map((f) => join(dir, f));
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

/** Blended frames from `from` to `to`, ending with `to` itself. */
async function frames(s: Settings, from: string, to: string): Promise<string[]> {
  const count = Math.round((duration(s.fade) / 1000) * s.fps);
  if (count < 2) return [to];

  const dir = join(CACHE, "fade", String(process.pid));
  rmSync(join(CACHE, "fade"), { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  // Overlay the new image at rising alpha. Unique paths per frame so the
  // terminal can't serve a cached image.
  const blended = await Promise.all(
    Array.from({ length: count - 1 }, async (_, i) => {
      const { data, info } = await sharp(to).ensureAlpha((i + 1) / count)
        .raw().toBuffer({ resolveWithObject: true });
      const path = join(dir, `${i + 1}.jpg`);
      await sharp(from).composite([{ input: data, raw: info }])
        .jpeg({ quality: 85 }).toFile(path);
      return path;
    }),
  );
  return [...blended, to];
}

const configured = () => loadEnvs().map((id) => ADAPTERS[id]);

/**
 * Configured terminals that can show a change now. One whose setup has gone
 * missing since `init` (Ghostty's include deleted by hand) is skipped with a
 * warning rather than reported as set.
 */
function reachable(): Terminal[] {
  return configured().filter((t) => {
    if (t.setUp() === false) {
      console.error(`${t.name}: its setup is missing; run \`term-wallpaper init --env ${t.id}\``);
      return false;
    }
    return t.reachable();
  });
}

async function apply(s: Settings, src: string, targets = reachable()) {
  if (!targets.length) {
    fail("no terminal to update: run `term-wallpaper init` in your terminal, and start iTerm2 if you use it");
  }

  const to = await normalize(s, src);
  const prev = current();
  const shown = prev && prev !== src && existsSync(prev)
    ? await frames(s, await normalize(s, prev), to)
    : [to];

  await Promise.all(targets.map((t) => t.play(shown, 1000 / s.fps, s)));
  setCurrent(src);
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

/** Remove `--name <value>` from `args` and return the value. */
function option(args: string[], name: string, usage: string): string | undefined {
  const i = args.indexOf(name);
  if (i < 0) return;
  const value = args[i + 1] ?? fail(usage);
  args.splice(i, 2);
  return value;
}

/** Set up the terminal this runs in (or `--env`). Safe to run again. */
async function init(args: string[]) {
  const usage = "usage: term-wallpaper init [--env <terminal>] [--dir <path>]";
  const t = ADAPTERS[resolve(option(args, "--env", usage))];
  const s = loadSettings();
  const dir = option(args, "--dir", usage);
  if (dir) s.dir = dir;
  if (args.length) fail(usage);

  mkdirSync(expand(s.dir), { recursive: true });
  s.size = screenSize() ?? s.size;
  saveSettings(s);

  for (const line of t.init()) console.log(line);
  const envs = loadEnvs();
  if (!envs.includes(t.id)) saveEnvs([...envs, t.id]);
  console.log(`images: ${s.dir} (${images(s).length} found)`);
  console.log(`screen: ${s.size.join("x")}`);
  if (s.every !== "off") setTimer(s.every);

  // Show the wallpaper in the terminal just set up; the others already have it.
  if (!t.reachable()) return;
  const cur = current();
  if (cur && existsSync(cur)) await apply(s, cur, [t]);
  else if (images(s).length) await apply(s, s.order === "random" ? pickRandom(s) : pick(s, 1), [t]);
}

/**
 * Undo `init` for the terminal this runs in (or `--env`). Settings and cache
 * stay for the other terminals and a later `init`; the timer goes with the
 * last terminal, since it would otherwise fire with nothing to update.
 */
function uninstall(args: string[]) {
  const usage = "usage: term-wallpaper uninstall [--env <terminal>]";
  const t = ADAPTERS[resolve(option(args, "--env", usage))];
  if (args.length) fail(usage);

  const envs = loadEnvs();
  const lines = t.uninstall();
  if (!envs.includes(t.id) && !lines.length) {
    console.log(`${t.name}: not set up`);
    return;
  }
  for (const line of lines) console.log(line);
  const left = envs.filter((e) => e !== t.id);
  saveEnvs(left);
  console.log(`${t.name}: uninstalled`);
  if (left.length) return;
  setTimer("off");
  console.log("no terminals left; removed the timer");
  console.log("to remove the command itself: bun remove -g term-wallpaper");
}

/**
 * Configured terminals and whether their setup is really in place, plus any
 * terminal set up outside `init` (a hand-added Ghostty include).
 */
function listEnvs() {
  const envs = loadEnvs();
  let any = false;
  for (const id of ENV_IDS) {
    const setUp = ADAPTERS[id].setUp();
    const fix = `run \`term-wallpaper init --env ${id}\``;
    let status: string;
    if (envs.includes(id)) status = setUp === false ? `setup missing; ${fix}` : "ok";
    else if (setUp) status = `set up but not recorded; ${fix}`;
    else continue;
    console.log(`${id}\t${status}`);
    any = true;
  }
  if (!any) console.log("no terminals set up; run `term-wallpaper init` in one");
}

async function config(args: string[]) {
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
        // With no terminal set up there is nothing to rotate; `init` starts it.
        if (value === "off" || loadEnvs().length) setTimer(value);
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
  if (restyle && cur && existsSync(cur)) {
    const image = await normalize(s, cur);
    for (const t of reachable()) t.restyle(image, s);
  }
}

const USAGE = `usage: term-wallpaper <command>

  init [--env <terminal>] [--dir <path>]
                          Set up this terminal, image folder and screen size
  next, -n, --next        Next wallpaper (random if order=random)
  prev, -p, --prev        Previous wallpaper in folder order
  random                  Random wallpaper
  set <file>              Specific wallpaper
  list                    List images, current one marked
  config [key=value ...]  Show or change settings:
                            dir, fade (500ms), fps (25), every (off|15m),
                            order (sequential|random), opacity (0.3, Ghostty only),
                            size (2560x1440)
  off                     Clear the wallpaper
  uninstall [--env <terminal>]
                          Undo init for this terminal; the last one also stops the timer
  env                     The terminal this is running in
  envs                    Terminals set up, and whether their setup is in place

init and uninstall act on the terminal they run in; --env names one instead
(${ENV_IDS.join(", ")}). Wallpaper changes go to every terminal set up.`;

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
    const file = rest[0] ? expand(rest[0]) : fail("usage: term-wallpaper set <file>");
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
    await config(rest);
    break;
  case "off":
    for (const t of configured()) t.clear();
    setCurrent(undefined);
    rmSync(join(CACHE, "fade"), { recursive: true, force: true });
    console.log("wallpaper off");
    break;
  case "uninstall":
    uninstall(rest);
    break;
  case "env":
    console.log(resolve());
    break;
  case "envs":
    listEnvs();
    break;
  case "help": case "-h": case "--help":
    console.log(USAGE);
    break;
  default:
    fail(USAGE);
}
