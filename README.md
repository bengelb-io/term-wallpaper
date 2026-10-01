# term-wallpaper

Rotating background images for [Ghostty](https://ghostty.org) and
[iTerm2](https://iterm2.com), with a smooth crossfade between them.

- Cycle through a folder of images: `next`, `prev`, `random`, or on a timer
- Crossfade between images (the terminals themselves would just cut over)
- One command sets everything up

Requires macOS, [Bun](https://bun.sh), and Ghostty 1.2+ and/or iTerm2.

## Setup

**1. Install Bun** (skip if `bun --version` already works):

```sh
curl -fsSL https://bun.sh/install | bash
```

Open a new terminal afterwards so `bun` is on your `PATH`.

**2. Install term-wallpaper:**

```sh
bun add -g github:bengelb-io/term-wallpaper
```

**3. Run setup:**

```sh
term-wallpaper init
```

This creates `~/Pictures/wallpapers`, records your screen size, and sets up
each terminal it finds. Run it again any time; it only adds what's missing.
To use a different folder: `term-wallpaper init --dir ~/some/folder`.

**4. iTerm2 only: two settings.** In iTerm2 → Settings → Profiles → Window:

- Set **Background Image** mode to **Scale to Fill**, so images aren't stretched.
- Use the **Blending** slider to set how strongly the image shows.

The first time you change the wallpaper, macOS asks whether your terminal may
control iTerm2. Click **Allow**.

**5. Add images** (JPEG, PNG or WebP) to `~/Pictures/wallpapers`, then:

```sh
term-wallpaper next
```

**6. Optional: rotate automatically:**

```sh
term-wallpaper config every=15m
```

That's it. Every open Ghostty window and iTerm2 session picks up the change.

## Commands

```
term-wallpaper init [--dir <path>]     Set up terminals, image folder and screen size
term-wallpaper next                    Next wallpaper    (also: -n, --next; the default)
term-wallpaper prev                    Previous wallpaper (also: -p, --prev)
term-wallpaper random                  Random wallpaper
term-wallpaper set <file>              Specific wallpaper
term-wallpaper list                    List images, current one marked
term-wallpaper config [key=value ...]  Show or change settings
term-wallpaper off                     Clear the wallpaper
```

`next` and `prev` move through the folder in filename order and wrap around.
`ghostty-wallpaper` also works as the command name.

## Settings

Run `term-wallpaper config` to see them all. Change any with `key=value`,
several at once if you like:

```sh
term-wallpaper config fade=1s opacity=0.4 every=30m order=random
```

| Key | Default | Effect |
|---|---|---|
| `dir` | `~/Pictures/wallpapers` | Image folder |
| `fade` | `500ms` | Crossfade length; `0` switches instantly |
| `fps` | `25` | Crossfade smoothness (1–60) |
| `every` | `off` | Rotate on a timer: `30s`, `15m`, `1h`, or `off` |
| `order` | `sequential` | `random` makes `next` and the timer shuffle |
| `opacity` | `0.3` | Image opacity, 0–1 (Ghostty; iTerm2 uses its Blending slider) |
| `size` | your screen | Pixel size images are cropped to; set by `init` |

Settings are stored in `~/.config/term-wallpaper/settings.json`.

## Troubleshooting

- **"no terminal to update".** Run `init`. iTerm2 only updates while it's running.
- **Ghostty doesn't change.** Check that your Ghostty config contains
  `config-file = ?~/.config/ghostty/wallpaper.conf` (run `init` again to add it).
- **iTerm2 doesn't change.** Allow control under System Settings → Privacy &
  Security → Automation.
- **The fade stutters.** Try fewer, longer frames: `config fps=12 fade=800ms`.
- **Wrong crop after switching monitors.** Run `init` again, or set
  `config size=3840x2160`.
- **Timer errors.** They're logged to `~/Library/Logs/term-wallpaper.log`.

## Uninstall

```sh
term-wallpaper config every=off   # remove the timer
term-wallpaper off                # clear the wallpaper
bun remove -g term-wallpaper
rm -rf ~/.config/term-wallpaper ~/Library/Caches/term-wallpaper
```

For Ghostty, also delete the `config-file = ?…/wallpaper.conf` line from your
config.

## How it works

Neither terminal has image transitions, so a crossfade pre-renders blended
frames with [sharp](https://sharp.pixelplumbing.com), cached in
`~/Library/Caches/term-wallpaper`, and shows them in quick succession.

- **Ghostty:** `init` adds `config-file = ?~/.config/ghostty/wallpaper.conf` to
  your config. Each frame rewrites that file and sends Ghostty `SIGUSR2`, which
  reloads its config.
- **iTerm2:** AppleScript sets the background image of every open session.

The timer is a launchd agent, `com.term-wallpaper`.

## License

MIT
