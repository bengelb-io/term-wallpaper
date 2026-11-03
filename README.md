# term-wallpaper

Rotating background images for [Ghostty](https://ghostty.org) and
[iTerm2](https://iterm2.com), with a smooth crossfade between them.

- Cycle through a folder of images: `next`, `prev`, `random`, or on a timer
- Crossfade between images (the terminals themselves would just cut over)
- One command sets up each terminal you want it in

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

**3. Run setup in your terminal:**

```sh
term-wallpaper init
```

This sets up the terminal you run it in, creates `~/Pictures/wallpapers`, and
records your screen size. To add another terminal, run `init` again from
inside that one. Running it again in the same terminal changes nothing. To use
a different folder: `term-wallpaper init --dir ~/some/folder`.

`init` finds your terminal by looking at which app the command is running
under. If it can't tell (for example in a tmux session started from a terminal
that has since quit), it stops and asks you to name it:
`term-wallpaper init --env ghostty` or `--env iterm2`.

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

That's it. Wallpaper changes go to every terminal you've set up, whichever one
you run the command from.

## Commands

```
term-wallpaper init [--env <terminal>] [--dir <path>]
                                       Set up this terminal, image folder and screen size
term-wallpaper next                    Next wallpaper    (also: -n, --next; the default)
term-wallpaper prev                    Previous wallpaper (also: -p, --prev)
term-wallpaper random                  Random wallpaper
term-wallpaper set <file>              Specific wallpaper
term-wallpaper list                    List images, current one marked
term-wallpaper config [key=value ...]  Show or change settings
term-wallpaper off                     Clear the wallpaper
term-wallpaper uninstall [--env <terminal>]
                                       Undo init for this terminal
term-wallpaper env                     The terminal this is running in
term-wallpaper envs                    Terminals set up, and whether their setup is in place
```

`init` and `uninstall` act on the terminal they run in; `--env ghostty` or
`--env iterm2` names one instead. Everything else applies to all terminals
you've set up.

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

Settings are stored in `~/.config/term-wallpaper/settings.json` and apply to
every terminal. Which terminals are set up is kept separately, in `envs.json`;
`init` and `uninstall` manage it.

## Troubleshooting

- **"no terminal to update".** Run `init` in your terminal. iTerm2 only
  updates while it's running.
- **"can't tell which terminal this is running in".** Pass `--env ghostty` or
  `--env iterm2`.
- **Ghostty doesn't change.** Run `term-wallpaper envs`. If it says the setup
  is missing, your config no longer includes `wallpaper.conf`; run
  `init --env ghostty` to add it back.
- **iTerm2 doesn't change.** Allow control under System Settings → Privacy &
  Security → Automation.
- **The fade stutters.** Try fewer, longer frames: `config fps=12 fade=800ms`.
- **Wrong crop after switching monitors.** Run `init` again, or set
  `config size=3840x2160`.
- **Timer errors.** They're logged to `~/Library/Logs/term-wallpaper.log`.

## Uninstall

Run `uninstall` in each terminal you set up (or name it with `--env`):

```sh
term-wallpaper uninstall
```

It puts that terminal back as it was before `init`, and leaves your other
terminals alone:

- **Ghostty:** removes what `init` added to your config, and the config file
  itself if `init` created it. An include you added by hand is left in place;
  `uninstall` tells you which line to delete.
- **iTerm2:** gives each open session back the background image it had before
  term-wallpaper first changed it.

Uninstalling the last terminal also stops the timer. Settings and cached images
stay, so a later `init` picks up where you left off. To remove everything:

```sh
bun remove -g term-wallpaper
rm -rf ~/.config/term-wallpaper ~/Library/Caches/term-wallpaper
```

## How it works

Neither terminal has image transitions, so a crossfade pre-renders blended
frames with [sharp](https://sharp.pixelplumbing.com), cached in
`~/Library/Caches/term-wallpaper`, and shows them in quick succession.

- **Ghostty:** `init` adds `config-file = ?~/.config/ghostty/wallpaper.conf` to
  your config. Each frame rewrites that file and sends Ghostty `SIGUSR2`, which
  reloads its config.
- **iTerm2:** AppleScript sets the background image of every open session,
  after recording each session's own image the first time it's changed.

The timer is a launchd agent, `com.term-wallpaper`.

## License

MIT
