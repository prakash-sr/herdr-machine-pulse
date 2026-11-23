# Machine Pulse

A mod for the [Herdr](https://herdr.dev) desktop app: live CPU, memory and load for this computer and every machine you've added, in the sidebar, the status bar, or both.

![Machine Pulse](preview.png)

*The sidebar card, the status bar line and the options, with sample machines.*

- **Every machine, local or over ssh.** Linux and macOS. Nothing to install on the machine: one small shell call per sample.
- **Sidebar and status bar.** A card per machine with CPU and memory history graphs in the sidebar; one line in the status bar that follows the machine of the space you are looking at. Turn either on or off from the mod's options.
- **Pick your machines.** Tick the ones to show; unticked machines are not sampled.
- **Pick your readings.** CPU, memory, their history graphs and load average, each on or off. Refresh every 2, 3, 5 or 10 seconds.
- **Green, yellow, red.** Below 60%, from 60%, from 85%.

## Why this one

Herdr has several machine monitors. Most open a window or a side tab of their own, or watch only the computer Herdr runs on. Machine Pulse is for people whose agents run on other machines and who want the numbers in the places they already look:

- **In the sidebar and the status bar, not a separate view.** Nothing to open: the card sits under your spaces, the line sits in the status row, and either can be turned off.
- **Remote machines first.** Every machine you added to Herdr is sampled over Herdr's own connection, Linux or macOS, with nothing installed there.
- **The status bar follows you.** It shows the machine of the space on screen, so switching to a space on another machine switches the numbers.
- **History for both readings.** CPU and memory each keep a graph of the last 40 samples, colored by how busy they were.
- **You pick the machines.** Untick the ones you don't care about and they are no longer sampled.
- **It fits itself.** The sidebar block is exactly as tall as the machines and readings shown.
- **Small and plain.** One JavaScript file of about 200 lines. It runs one shell probe per machine and nothing else: no helper programs, no network requests, no files written.

It does not do alerts, disks, network, GPU or per-process views. For those, look at the other monitors under the [`herdr-mod`](https://github.com/topics/herdr-mod) topic.

This is an unofficial mod. It is not affiliated with Herdr.

## Install

Ask the agent in your Herdr window:

> Read `~/.config/herdr-app/AGENTS.md`, then add this mod: https://github.com/prakash-sr/herdr-machine-pulse

Or by hand:

```sh
git clone https://github.com/prakash-sr/herdr-machine-pulse
cp -R herdr-machine-pulse/mods/machine-pulse ~/.config/herdr-app/mods/
herdr-app do mod.open --name machine-pulse
```

The last line opens the options. Under **Show in**, tick **Sidebar** and/or **Status bar**: the mod adds its block to the shown layout, above the sidebar footer and at the right end of the status bar.

Herdr's own layouts are read-only, so do this on a layout of your own. To get one from Herdr's:

```sh
herdr-app do layout.clone '{"name":"main","as":"mine"}'
```

To open the options from a key, add to `~/.config/herdr-app/keys.json`:

```json
{ "global": { "ctrl-shift-m": "mod.open:machine-pulse" } }
```

### Placing the blocks yourself

In a layout with other ids than Herdr's `sidebar` and `status`, add the blocks where you want them:

```json
{ "id": "pulse", "type": "block", "size": { "px": 82 }, "content": { "mod": "machine-pulse" } }
```

```json
{ "id": "status-pulse", "type": "block", "size": { "px": 430 }, "content": { "mod": "machine-pulse", "props": { "variant": "bar" } } }
```

The sidebar block sets its own height to fit the machines and readings shown. The status bar line needs about 430 px a machine.

## Options

A click on either meter opens them in the middle of the window. They are kept in Herdr's shared state under `machine-pulse`, so every copy of the mod follows them.

| Option | What it does | Default |
|---|---|---|
| Show in: Sidebar, Status bar | shows or hides that block; adds it if the layout has none | as the layout has them |
| Machines | which machines are shown and sampled | all |
| CPU, Memory, History graphs, Load average | which readings to show; without the graphs, the sidebar draws a bar for each | all on |
| Status bar shows | the shown space's machine, or all ticked machines | the shown space's machine |
| Refresh every | 2, 3, 5 or 10 seconds | 3 seconds |

## What it reads

- **Linux:** `/proc/stat` (CPU, as the change between two samples), `/proc/meminfo` (`MemAvailable` over `MemTotal`), `/proc/loadavg`, `nproc`.
- **macOS:** `sysctl` (cores, memory size, load), `vm_stat` (active, wired and compressed pages count as used), and the sum of `ps`'s per-process CPU share over the core count. That CPU figure is a short average, not an exact tick count.
- **Windows** machines are left out: the probe needs `sh`.

Load is the 1-minute load average over the core count: `2.0/2` means every core is busy.

## What it costs

One `sh -c` per shown machine per refresh, shared by the sidebar and the status bar copies. A hidden copy does not sample. Each new sample redraws the window, as any mod redraw does in Herdr, so choose a longer refresh on battery.

## Development

```sh
node test.mjs                                  # the layout logic, with the app's functions faked
herdr-app check mods/machine-pulse            # loads the mod once
```

[RECIPE.md](RECIPE.md) is the brief an agent can rebuild the mod from.

## License

MIT
