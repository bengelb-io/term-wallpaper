# ghostty-wallpaper

Cycle Ghostty background images with a crossfade. macOS, Bun.

```sh
bun install && bun link
ghostty-wallpaper init --dir ~/Pictures/wallpapers
```

## Commands

```
init [--dir <path>]     Set up the Ghostty config, image folder and screen size
next, -n, --next        Next wallpaper (random if order=random)
prev, -p, --prev        Previous wallpaper in folder order
random                  Random wallpaper
set <file>              Specific wallpaper
list                    List images, current one marked
config [key=value ...]  Show or change settings
off                     Clear the wallpaper
```

## Settings

| Key | Default | Effect |
|---|---|---|
| `dir` | `~/Pictures/wallpapers` | Image folder |
| `fade` | `500ms` | Crossfade length; `0` = instant |
| `fps` | `25` | Crossfade smoothness |
| `every` | `off` | Timer interval (`30s`, `15m`, `1h`); installs or removes a launchd job |
| `order` | `sequential` | `random` makes `next` and the timer shuffle |
| `opacity` | `0.3` | Image opacity |
| `size` | detected by `init` | Screen pixel size images are cropped to |

Settings live in `~/.config/ghostty-wallpaper/settings.json`.

## How it works

`init` adds `config-file = ?~/.config/ghostty/wallpaper.conf` to the Ghostty
config. Each change rewrites that file and sends Ghostty `SIGUSR2` to reload.
Ghostty has no image transitions, so a crossfade pre-renders blended frames
(cached in `~/Library/Caches/ghostty-wallpaper`) and reloads through them.
