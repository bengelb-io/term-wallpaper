// Ghostty: the image lives in ~/.config/ghostty/wallpaper.conf, included from
// the main config. Each change rewrites it and sends SIGUSR2 to reload.

import { dirname, join } from "node:path";
import {
  appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync,
} from "node:fs";
import { CONFIG_DIR, HOME, XDG, type Settings, type Terminal } from "./common";

const STATE = join(XDG, "ghostty/wallpaper.conf");
const INCLUDE = /^\s*config-file\s*=.*ghostty\/wallpaper\.conf\s*$/m;

/** What `init` changed, so `uninstall` can undo exactly that. */
const RECORD = join(CONFIG_DIR, "ghostty-init.json");
type Record = {
  path: string;
  added: string;
  createdFile: boolean;
  createdDir: boolean;
  createdStateDir: boolean;
};

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
  // The include can live in Application Support while STATE is under XDG.
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, [
    "# Managed by term-wallpaper; changes are overwritten.",
    `background-image = ${image}`,
    "background-image-fit = cover",
    `background-image-opacity = ${s.opacity}`,
    "",
  ].join("\n"));
  reload();
}

// `-a` because pkill skips its own ancestors, and run from Ghostty, Ghostty is one.
// The signal must come first: macOS pkill reads `-a -USR2` as `-a -U SR2`.
const reload = () => Bun.spawnSync(["pkill", "-USR2", "-a", "-x", "ghostty"]);

export const ghostty: Terminal = {
  id: "ghostty",
  name: "Ghostty",

  setUp: includes,

  // The config is read at launch, so a closed Ghostty still picks the image up.
  reachable: () => true,

  init() {
    const path = configPath();
    if (includes()) return [`Ghostty: ${path} already includes wallpaper.conf`];
    const createdFile = !existsSync(path);
    const createdDir = !existsSync(dirname(path));
    const createdStateDir = !existsSync(dirname(STATE)) && dirname(STATE) !== dirname(path);
    const text = createdFile ? "" : readFileSync(path, "utf8");
    mkdirSync(dirname(path), { recursive: true });
    const sep = text && !text.endsWith("\n") ? "\n" : "";
    const added = `${sep}\n# Background image, managed by term-wallpaper\nconfig-file = ?${STATE}\n`;
    appendFileSync(path, added);
    mkdirSync(CONFIG_DIR, { recursive: true });
    writeFileSync(RECORD, JSON.stringify(
      { path, added, createdFile, createdDir, createdStateDir } satisfies Record,
    ));
    return [`Ghostty: added wallpaper.conf include to ${path}`];
  },

  uninstall() {
    rmSync(STATE, { force: true });
    const lines: string[] = [];
    const record: Record | undefined = existsSync(RECORD)
      ? JSON.parse(readFileSync(RECORD, "utf8"))
      : undefined;
    const text = record && existsSync(record.path) ? readFileSync(record.path, "utf8") : undefined;

    if (record && text?.endsWith(record.added)) {
      const rest = text.slice(0, -record.added.length);
      if (record.createdFile && !rest) {
        rmSync(record.path);
        const dir = dirname(record.path);
        if (record.createdDir && !readdirSync(dir).length) rmSync(dir, { recursive: true });
      } else {
        writeFileSync(record.path, rest);
      }
      lines.push(`Ghostty: removed wallpaper.conf include from ${record.path}`);
    } else if (includes()) {
      // Added by hand, or edited since `init`: not ours to rewrite.
      lines.push(`Ghostty: delete the config-file = ?…/wallpaper.conf line from ${configPath()}`);
    }

    const stateDir = dirname(STATE);
    if (record?.createdStateDir && existsSync(stateDir) && !readdirSync(stateDir).length) {
      rmSync(stateDir, { recursive: true });
    }
    rmSync(RECORD, { force: true });
    reload();
    return lines;
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
    reload();
  },
};
