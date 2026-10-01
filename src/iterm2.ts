// iTerm2: AppleScript sets `background image` on every open session. Its
// AppleScript has no blend or fit properties, so opacity and fit stay with the
// profile's settings.

import { existsSync } from "node:fs";
import type { Terminal } from "./common";

/** Sets every session's background image to each argument in turn. */
const SCRIPT = `
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

const command = (images: string[], frameMs: number) => [
  "osascript",
  ...SCRIPT.trim().split("\n").flatMap((line) => ["-e", line]),
  String(frameMs / 1000),
  ...images,
];

async function setImages(images: string[], frameMs: number) {
  const proc = Bun.spawn(command(images, frameMs), {
    stdout: "ignore",
    stderr: "pipe",
  });
  if ((await proc.exited) !== 0) {
    console.error(`iTerm2: ${(await new Response(proc.stderr).text()).trim()}`);
  }
}

// Checked first so AppleScript never launches iTerm2 itself. `-a` because
// pgrep skips its own ancestors, and run from iTerm2, iTerm2 is one.
const running = () => Bun.spawnSync(["pgrep", "-a", "-x", "iTerm2"]).exitCode === 0;

export const iterm2: Terminal = {
  name: "iTerm2",

  installed: () => existsSync("/Applications/iTerm.app"),

  active: running,

  init: () => [
    "iTerm2: changes apply to every open session while iTerm2 is running.",
    "  In Settings → Profiles → Window, set Background Image mode to",
    "  “Scale to Fill” and use the Blending slider for opacity.",
    "  macOS asks once to let this tool control iTerm2.",
  ],

  play: (images, frameMs) => setImages(images, frameMs),

  restyle() {},

  clear() {
    if (running()) Bun.spawnSync(command([""], 0));
  },
};
