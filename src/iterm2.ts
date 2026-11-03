// iTerm2: AppleScript sets `background image` on every open session. Its
// AppleScript has no blend or fit properties, so opacity and fit stay with the
// profile's settings.
//
// Before a session is first changed, its own image is recorded by unique id, so
// `uninstall` can hand every session back the image it had.

import { join } from "node:path";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { CONFIG_DIR, type Terminal } from "./common";

const ORIGINALS = join(CONFIG_DIR, "iterm2-originals.json");

/** Sets every session's background image to each argument in turn. */
const SET = `
-- term-wallpaper: set
on run argv
  set delaySecs to (item 1 of argv) as real
  tell application "iTerm2"
    repeat with i from 2 to count of argv
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            set background image of s to (item i of argv)
          end repeat
        end repeat
      end repeat
      if i < (count of argv) then delay delaySecs
    end repeat
  end tell
end run`;

/** One "<unique id><TAB><background image>" line per session. */
const SNAPSHOT = `
-- term-wallpaper: snapshot
set out to ""
tell application "iTerm2"
  repeat with w in windows
    repeat with t in tabs of w
      repeat with s in sessions of t
        set out to out & (unique id of s) & (ASCII character 9) & (background image of s) & linefeed
      end repeat
    end repeat
  end repeat
end tell
return out`;

/** Arguments are id, image pairs; each listed session still open gets its image. */
const RESTORE = `
-- term-wallpaper: restore
on run argv
  tell application "iTerm2"
    repeat with w in windows
      repeat with t in tabs of w
        repeat with s in sessions of t
          repeat with i from 1 to (count of argv) by 2
            if (unique id of s) is (item i of argv) then set background image of s to (item (i + 1) of argv)
          end repeat
        end repeat
      end repeat
    end repeat
  end tell
end run`;

const osa = (script: string, args: string[] = []) => [
  "osascript",
  ...script.trim().split("\n").flatMap((line) => ["-e", line]),
  ...args,
];

async function setImages(images: string[], frameMs: number) {
  const proc = Bun.spawn(osa(SET, [String(frameMs / 1000), ...images]), {
    stdout: "ignore",
    stderr: "pipe",
  });
  if ((await proc.exited) !== 0) {
    console.error(`iTerm2: ${(await new Response(proc.stderr).text()).trim()}`);
  }
}

function originals(): Record<string, string> {
  return existsSync(ORIGINALS) ? JSON.parse(readFileSync(ORIGINALS, "utf8")) : {};
}

/** Record the image of every session not seen before, ahead of changing it. */
function remember() {
  const seen = originals();
  const out = Bun.spawnSync(osa(SNAPSHOT)).stdout.toString();
  let changed = false;
  for (const line of out.split("\n")) {
    const [id, image = ""] = line.split("\t");
    if (id && !(id in seen)) {
      seen[id] = image;
      changed = true;
    }
  }
  if (!changed) return;
  mkdirSync(CONFIG_DIR, { recursive: true });
  writeFileSync(ORIGINALS, JSON.stringify(seen, null, 2) + "\n");
}

// Checked first so AppleScript never launches iTerm2 itself. `-a` because
// pgrep skips its own ancestors, and run from iTerm2, iTerm2 is one.
const running = () => Bun.spawnSync(["pgrep", "-a", "-x", "iTerm2"]).exitCode === 0;

export const iterm2: Terminal = {
  id: "iterm2",
  name: "iTerm2",

  // Nothing on disk: the images live on the sessions themselves.
  setUp: () => undefined,

  reachable: running,

  init: () => [
    "iTerm2: changes apply to every open session while iTerm2 is running.",
    "  In Settings → Profiles → Window, set Background Image mode to",
    "  “Scale to Fill” and use the Blending slider for opacity.",
    "  macOS asks once to let this tool control iTerm2.",
  ],

  play(images, frameMs) {
    remember();
    return setImages(images, frameMs);
  },

  restyle() {},

  clear() {
    if (!running()) return;
    remember();
    Bun.spawnSync(osa(SET, ["0", ""]));
  },

  uninstall() {
    const pairs = Object.entries(originals());
    // Closed sessions took their images with them; only open ones need restoring.
    rmSync(ORIGINALS, { force: true });
    if (!pairs.length || !running()) return [];
    Bun.spawnSync(osa(RESTORE, pairs.flat()));
    return ["iTerm2: gave each open session back its own background image"];
  },
};
