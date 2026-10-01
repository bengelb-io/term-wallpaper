// Per-terminal setup: `init` and `uninstall` touch only the terminal they run
// in (or `--env`), `uninstall` leaves that terminal as it was before `init`,
// and nothing else changes along the way.
//
// Each test runs the real CLI in a throwaway $HOME, with the system commands it
// drives (ps, launchctl, pkill, pgrep, osascript, system_profiler) replaced on
// PATH by fakes that keep their effects in files. Nothing here touches the real
// terminals, launchd or ~/.config.

import sharp from "sharp";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, writeFileSync,
} from "node:fs";

const CLI = join(import.meta.dir, "../src/index.ts");
const GHOSTTY_PROCESS = "/Applications/Ghostty.app/Contents/MacOS/ghostty";

let root: string;
let home: string;
let fake: string;

// Fakes.
// - `ps` shows the CLI (its own parent) under the terminal process named in
//   $FAKE/terminal, or under launchd when that file is absent.
// - `launchctl` keeps one file per loaded job.
// - `osascript` stands in for iTerm2, whose sessions live in
//   $FAKE/iterm2-sessions as "<id><TAB><image>" lines; it tells the three
//   scripts apart by their "-- term-wallpaper: <name>" first line.
const SHIMS: Record<string, string> = {
  ps: `
if [ -e "$FAKE/terminal" ]; then
  echo "$PPID 999 bun"
  echo "999 1 $(cat "$FAKE/terminal")"
else
  echo "$PPID 1 bun"
fi`,
  launchctl: `
case "$1" in
  bootstrap) touch "$FAKE/launchd/$(basename "$3" .plist)" ;;
  bootout) rm -f "$FAKE/launchd/\${2##*/}" ;;
esac`,
  pkill: `echo "$@" >> "$FAKE/pkill.log"`,
  pgrep: `[ -e "$FAKE/iterm2-running" ]`,
  osascript: `
script="$2"
while [ "$1" = "-e" ]; do shift 2; done
sessions="$FAKE/iterm2-sessions"
[ -e "$sessions" ] || exit 0
case "$script" in
  *snapshot) cat "$sessions" ;;
  *set)
    shift
    for img in "$@"; do last="$img"; done
    while IFS=$'\\t' read -r id _; do printf '%s\\t%s\\n' "$id" "$last"; done \\
      < "$sessions" > "$sessions.new"
    mv "$sessions.new" "$sessions" ;;
  *restore)
    while IFS=$'\\t' read -r id image; do
      args=("$@")
      for ((i = 0; i < \${#args[@]}; i += 2)); do
        [ "\${args[i]}" = "$id" ] && image="\${args[i+1]}"
      done
      printf '%s\\t%s\\n' "$id" "$image"
    done < "$sessions" > "$sessions.new"
    mv "$sessions.new" "$sessions" ;;
esac`,
  system_profiler: `echo '{"SPDisplaysDataType":[{"spdisplays_ndrvs":[{"spdisplays_main":"spdisplays_yes","_spdisplays_pixels":"64 x 36"}]}]}'`,
};

function exec(...args: string[]) {
  const r = Bun.spawnSync(["bun", CLI, ...args], {
    env: {
      HOME: home,
      XDG_CONFIG_HOME: join(home, ".config"),
      FAKE: fake,
      // Bun's own transpiler cache would otherwise land in the fake $HOME.
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0",
      PATH: `${join(fake, "bin")}:${process.env.PATH}`,
    },
  });
  return { code: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

function run(...args: string[]) {
  const r = exec(...args);
  if (r.code !== 0) throw new Error(`${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

// Settings, cache and the current image are kept across uninstall on purpose.
const KEPT = [".config/term-wallpaper/", "Library/Caches/term-wallpaper/"];

/** Everything outside the kept app data: files under $HOME, launchd jobs, iTerm2 sessions. */
function state() {
  const files: Record<string, string> = {};
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      const rel = relative(home, path);
      if (statSync(path).isDirectory()) {
        if (KEPT.includes(rel + "/")) continue;
        files[rel + "/"] = "";
        walk(path);
      } else {
        files[rel] = readFileSync(path, "utf8");
      }
    }
  };
  walk(home);
  return {
    files,
    launchd: readdirSync(join(fake, "launchd")),
    iterm2: sessions(),
  };
}

const sessions = () => {
  const path = join(fake, "iterm2-sessions");
  return existsSync(path) ? readFileSync(path, "utf8") : null;
};

const envs = () => JSON.parse(readFileSync(join(home, ".config/term-wallpaper/envs.json"), "utf8"));

function ghosttyConfig(text: string, path = join(home, ".config/ghostty/config")) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, text);
  return path;
}

function iterm2Running(lines: string) {
  writeFileSync(join(fake, "iterm2-running"), "");
  writeFileSync(join(fake, "iterm2-sessions"), lines);
}

/** Install in one terminal, use every feature that leaves state behind, uninstall. */
function roundTrip(env: string) {
  run("init", "--env", env);
  run("next");
  run("next");
  run("config", "every=15m", "opacity=0.5");
  run("off");
  run("next");
  run("uninstall", "--env", env);
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "term-wallpaper-test-"));
  home = join(root, "home");
  fake = join(root, "fake");

  mkdirSync(join(fake, "bin"), { recursive: true });
  mkdirSync(join(fake, "launchd"));
  for (const [name, body] of Object.entries(SHIMS)) {
    const path = join(fake, "bin", name);
    writeFileSync(path, `#!/bin/bash\n${body}\n`);
    chmodSync(path, 0o755);
  }

  // What a Mac home already has, so directories the tool merely reuses don't
  // read as leftovers.
  for (const dir of [".config", "Library/LaunchAgents", "Library/Logs", "Library/Caches"]) {
    mkdirSync(join(home, dir), { recursive: true });
  }
  const pictures = join(home, "Pictures/wallpapers");
  mkdirSync(pictures, { recursive: true });
  for (const [name, color] of [["a.png", "#c33"], ["b.png", "#3c3"], ["c.png", "#33c"]] as const) {
    await sharp({ create: { width: 8, height: 8, channels: 3, background: color } })
      .png().toFile(join(pictures, name));
  }
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

// --- uninstall restores the terminal ------------------------------------------

test("Ghostty: config ending in a newline is restored exactly", () => {
  ghosttyConfig("font-size = 14\ntheme = dark\n");
  const before = state();
  roundTrip("ghostty");
  expect(state()).toEqual(before);
});

test("Ghostty: config without a trailing newline is restored exactly", () => {
  ghosttyConfig("font-size = 14");
  const before = state();
  roundTrip("ghostty");
  expect(state()).toEqual(before);
});

test("Ghostty: only an Application Support config", () => {
  ghosttyConfig("font-size = 14\n",
    join(home, "Library/Application Support/com.mitchellh.ghostty/config"));
  const before = state();
  roundTrip("ghostty");
  expect(state()).toEqual(before);
});

test("Ghostty: an include added by hand is adopted by init and left alone by uninstall", () => {
  ghosttyConfig("# mine\nconfig-file = ?~/.config/ghostty/wallpaper.conf\n");
  const before = state();

  roundTrip("ghostty");

  expect(state()).toEqual(before);
});

test("iTerm2: every session gets back the background image it had", () => {
  iterm2Running("s1\t/Users/me/own-background.png\ns2\t\n");
  const before = state();
  roundTrip("iterm2");
  expect(state()).toEqual(before);
});

test("iTerm2: a session opened after init gets its own image back too", () => {
  iterm2Running("s1\t/Users/me/one.png\n");

  run("init", "--env", "iterm2");
  run("next");
  writeFileSync(join(fake, "iterm2-sessions"), sessions() + "s2\t/Users/me/two.png\n");
  run("next");
  run("uninstall", "--env", "iterm2");

  expect(sessions()).toBe("s1\t/Users/me/one.png\ns2\t/Users/me/two.png\n");
});

// --- one terminal at a time ---------------------------------------------------

test("init in Ghostty leaves iTerm2 alone", () => {
  ghosttyConfig("font-size = 14\n");
  iterm2Running("s1\t/Users/me/one.png\n");

  run("init", "--env", "ghostty");
  run("next");

  expect(sessions()).toBe("s1\t/Users/me/one.png\n");
  expect(envs()).toEqual(["ghostty"]);
});

test("init in iTerm2 leaves Ghostty's config alone", () => {
  const config = ghosttyConfig("font-size = 14\n");
  iterm2Running("s1\t\n");

  run("init", "--env", "iterm2");
  run("next");

  expect(readFileSync(config, "utf8")).toBe("font-size = 14\n");
  expect(existsSync(join(home, ".config/ghostty/wallpaper.conf"))).toBe(false);
});

test("uninstalling one terminal keeps the other and the timer", () => {
  const config = ghosttyConfig("font-size = 14\n");
  iterm2Running("s1\t\n");

  run("init", "--env", "ghostty");
  run("init", "--env", "iterm2");
  run("config", "every=15m");
  run("uninstall", "--env", "iterm2");

  expect(envs()).toEqual(["ghostty"]);
  expect(readdirSync(join(fake, "launchd"))).toEqual(["com.term-wallpaper"]);
  expect(readFileSync(config, "utf8")).toContain("wallpaper.conf");
  expect(run("next")).toStartWith("set: ");
});

test("the last uninstall removes the timer but keeps settings", () => {
  ghosttyConfig("font-size = 14\n");

  run("init", "--env", "ghostty");
  run("config", "every=15m", "fade=1s");
  run("uninstall", "--env", "ghostty");

  expect(readdirSync(join(fake, "launchd"))).toEqual([]);
  expect(existsSync(join(home, "Library/LaunchAgents/com.term-wallpaper.plist"))).toBe(false);
  expect(run("config")).toContain("fade=1s");
});

test("init again restarts the timer from the kept setting", () => {
  ghosttyConfig("font-size = 14\n");

  run("init", "--env", "ghostty");
  run("config", "every=15m");
  run("uninstall", "--env", "ghostty");
  run("init", "--env", "ghostty");

  expect(readdirSync(join(fake, "launchd"))).toEqual(["com.term-wallpaper"]);
});

test("init is idempotent", () => {
  const config = ghosttyConfig("font-size = 14\n");

  run("init", "--env", "ghostty");
  const once = readFileSync(config, "utf8");
  run("init", "--env", "ghostty");

  expect(readFileSync(config, "utf8")).toBe(once);
  expect(envs()).toEqual(["ghostty"]);
});

test("uninstall in a terminal that was never set up changes nothing", () => {
  const before = state();
  expect(run("uninstall", "--env", "iterm2")).toBe("iTerm2: not set up\n");
  expect(state()).toEqual(before);
});

// --- detection ----------------------------------------------------------------

test("init and env detect the terminal they run in", () => {
  ghosttyConfig("font-size = 14\n");
  writeFileSync(join(fake, "terminal"), GHOSTTY_PROCESS);

  expect(run("env")).toBe("ghostty\n");
  run("init");

  expect(envs()).toEqual(["ghostty"]);
});

test("with no terminal and no --env, init and uninstall abort without side effects", () => {
  ghosttyConfig("font-size = 14\n");
  const before = state();

  for (const cmd of ["init", "uninstall", "env"]) {
    const r = exec(cmd);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("pass --env ghostty|iterm2");
  }
  expect(state()).toEqual(before);
  expect(existsSync(join(home, ".config/term-wallpaper"))).toBe(false);
});

test("--env overrides detection, and rejects an unknown terminal", () => {
  ghosttyConfig("font-size = 14\n");
  iterm2Running("s1\t\n");
  writeFileSync(join(fake, "terminal"), GHOSTTY_PROCESS);

  run("init", "--env", "iterm2");
  expect(envs()).toEqual(["iterm2"]);

  const r = exec("init", "--env", "kitty");
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("unknown terminal: kitty");
});

// --- drift ----------------------------------------------------------------------

test("a Ghostty include deleted by hand is reported, not silently 'set'", () => {
  const config = ghosttyConfig("font-size = 14\n");
  run("init", "--env", "ghostty");
  writeFileSync(config, "font-size = 14\n");

  expect(run("envs")).toBe("ghostty\tsetup missing; run `term-wallpaper init --env ghostty`\n");
  const r = exec("next");
  expect(r.code).toBe(1);
  expect(r.stderr).toContain("Ghostty: its setup is missing");

  run("init", "--env", "ghostty");
  expect(run("envs")).toBe("ghostty\tok\n");
});

test("an include present but not recorded is reported", () => {
  ghosttyConfig("config-file = ?~/.config/ghostty/wallpaper.conf\n");
  expect(run("envs")).toBe("ghostty\tset up but not recorded; run `term-wallpaper init --env ghostty`\n");
});
