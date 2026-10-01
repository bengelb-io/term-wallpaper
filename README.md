# ghostty-wallpaper

Rotating background images for [Ghostty](https://ghostty.org), with a smooth
crossfade between them.

- Cycle through a folder of images: `next`, `prev`, `random`, or on a timer
- Crossfade between images (Ghostty itself would just cut over)
- One command sets up your Ghostty config; nothing else to edit

Requires macOS, Ghostty 1.2 or newer, and [Bun](https://bun.sh).

## Setup

**1. Install Bun** (skip if `bun --version` already works):

```sh
curl -fsSL https://bun.sh/install | bash
```

Open a new terminal afterwards so `bun` is on your `PATH`.

**2. Install ghostty-wallpaper:**

```sh
bun add -g github:bengelb-io/ghostty-wallpaper
```

**3. Run setup:**

```sh
ghostty-wallpaper init
```

This creates `~/Pictures/wallpapers`, adds one include line to your Ghostty
config, and records your screen size. Run it again any time; it only adds what's
missing. To use a different folder: `ghostty-wallpaper init --dir ~/some/folder`.

**4. Add images** (JPEG, PNG or WebP) to `~/Pictures/wallpapers`, then:

```sh
ghostty-wallpaper next
```

**5. Optional: rotate automatically:**

```sh
ghostty-wallpaper config every=15m
```

That's it. Every open Ghostty window picks up the change.

## Commands

```
ghostty-wallpaper init [--dir <path>]     Set up the Ghostty config, image folder and screen size
ghostty-wallpaper next                    Next wallpaper    (also: -n, --next; the default)
ghostty-wallpaper prev                    Previous wallpaper (also: -p, --prev)
ghostty-wallpaper random                  Random wallpaper
ghostty-wallpaper set <file>              Specific wallpaper
ghostty-wallpaper list                    List images, current one marked
ghostty-wallpaper config [key=value ...]  Show or change settings
ghostty-wallpaper off                     Clear the wallpaper
```

`next` and `prev` move through the folder in filename order and wrap around.

## Settings

Run `ghostty-wallpaper config` to see them all. Change any with `key=value`,
several at once if you like:

```sh
ghostty-wallpaper config fade=1s opacity=0.4 every=30m order=random
```

| Key | Default | Effect |
|---|---|---|
| `dir` | `~/Pictures/wallpapers` | Image folder |
| `fade` | `500ms` | Crossfade length; `0` switches instantly |
| `fps` | `25` | Crossfade smoothness (1–60) |
| `every` | `off` | Rotate on a timer: `30s`, `15m`, `1h`, or `off` |
| `order` | `sequential` | `random` makes `next` and the timer shuffle |
| `opacity` | `0.3` | Image opacity, 0–1; lower keeps text readable |
| `size` | your screen | Pixel size images are cropped to; set by `init` |

Settings are stored in `~/.config/ghostty-wallpaper/settings.json`.

## Troubleshooting

- **Nothing changes.** Check that your Ghostty config contains
  `config-file = ?~/.config/ghostty/wallpaper.conf` (run `init` again to add it).
- **The fade stutters.** Try fewer, longer frames: `config fps=12 fade=800ms`.
- **Wrong crop after switching monitors.** Run `init` again, or set
  `config size=3840x2160`.
- **Timer errors.** They're logged to `~/Library/Logs/ghostty-wallpaper.log`.

## Uninstall

```sh
ghostty-wallpaper config every=off   # remove the timer
ghostty-wallpaper off                # clear the wallpaper
bun remove -g ghostty-wallpaper
rm -rf ~/.config/ghostty-wallpaper ~/Library/Caches/ghostty-wallpaper
```

Then delete the `config-file = ?…/wallpaper.conf` line from your Ghostty config.

## How it works

`init` adds `config-file = ?~/.config/ghostty/wallpaper.conf` to your Ghostty
config. Each change rewrites that file and sends Ghostty `SIGUSR2`, which
reloads its config. Ghostty has no image transitions, so a crossfade
pre-renders blended frames with [sharp](https://sharp.pixelplumbing.com),
cached in `~/Library/Caches/ghostty-wallpaper`, and reloads through them. The
timer is a launchd agent, `com.ghostty-wallpaper`.

## License

MIT
