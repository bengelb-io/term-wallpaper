// Ghostty: the image lives in ~/.config/ghostty/wallpaper.conf, included from
// the main config. Each change rewrites it and sends SIGUSR2 to reload.

import { join } from "node:path";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { HOME, XDG, type Settings, type Terminal } from "./common";

const STATE = join(XDG, "ghostty/wallpaper.conf");
const INCLUDE = /^\s*config-file\s*=.*ghostty\/wallpaper\.conf\s*$/m;

function configPath(): string {
  const candidates = [
    join(XDG, "ghostty/config.ghostty"),
    join(XDG, "ghostty/config"),
    join(HOME, "Library/Application Support/com.mitchellh.ghostty/config.ghostty"),
    join(HOME, "Library/Application Support/com.mitchellh.ghostty/config"),
  ];
  return candidates.find(existsSync) ?? candidates[0]!;
}

function includes(): boolean {
  const path = configPath();
  return existsSync(path) && INCLUDE.test(readFileSync(path, "utf8"));
}

function show(image: string, s: Settings) {
  writeFileSync(STATE, [
    "# Managed by term-wallpaper; changes are overwritten.",
    `background-image = ${image}`,
    "background-image-fit = cover",
    `background-image-opacity = ${s.opacity}`,
    "",
  ].join("\n"));
  Bun.spawnSync(["pkill", "-USR2", "-x", "ghostty"]);
}

export const ghostty: Terminal = {
  name: "Ghostty",

  installed: () => existsSync("/Applications/Ghostty.app") || existsSync(configPath()),

  active: includes,

  init() {
    const path = configPath();
    if (includes()) return [`Ghostty: ${path} already includes wallpaper.conf`];
    const text = existsSync(path) ? readFileSync(path, "utf8") : "";
    mkdirSync(join(path, ".."), { recursive: true });
    const sep = text && !text.endsWith("\n") ? "\n" : "";
    appendFileSync(path, `${sep}\n# Background image, managed by term-wallpaper\nconfig-file = ?${STATE}\n`);
    return [`Ghostty: added wallpaper.conf include to ${path}`];
  },

  async play(images, frameMs, s) {
    for (const [i, image] of images.entries()) {
      show(image, s);
      if (i < images.length - 1) await Bun.sleep(frameMs);
    }
  },

  restyle: show,

  clear() {
    rmSync(STATE, { force: true });
    Bun.spawnSync(["pkill", "-USR2", "-x", "ghostty"]);
  },
};
