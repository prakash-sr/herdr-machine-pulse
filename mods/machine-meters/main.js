import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, machines, spaces, theme, props, shared, setShared, layout, run, openOverlay, checking } from "herdr";

// CPU, memory and load of this computer and every connected machine (Linux and macOS):
// a card per machine in the sidebar, and/or one line in the status bar (props: { variant: "bar" }).
// A click opens the options (where to show, which machines, what to show); every copy shares them.
// Both readings keep a history of the last 40 samples.
const MOD = "machine-meters";
const DEFAULTS = { interval: 3, cpu: true, mem: true, load: true, graph: true, bar: "active", hidden: [] };
const opts = () => ({ ...DEFAULTS, ...(shared(MOD) || {}) });
const POINTS = 40;
const LOCAL = "This computer";

// One shell call per machine and sample. Linux reads /proc; macOS has no cheap CPU counter, so it
// sums ps's per-process share (a short average, not an exact tick delta).
const PROBE = `if [ -r /proc/stat ]; then echo linux; head -1 /proc/stat; grep -E '^(MemTotal|MemAvailable):' /proc/meminfo; nproc; cut -d' ' -f1 /proc/loadavg
elif [ "$(uname)" = Darwin ]; then echo darwin; sysctl -n hw.ncpu hw.memsize vm.loadavg; vm_stat | grep -E 'page size|Pages (active|wired down|occupied by compressor)'; ps -A -o %cpu= | awk '{s+=$1} END{print "cpu", s}'
else echo unsupported; fi`;

// One sampler for every copy of the mod (module code is shared by copies): a sidebar card and a
// status bar line cost one probe per machine, not two.
const store = { m: {}, at: 0, busy: false, rev: 0 };
const push = (hist, v) => { hist.push(Math.max(0, Math.round(v))); if (hist.length > POINTS) hist.shift(); };

function parse(text, s) {
  const out = text.trim().split("\n");
  s.os = out[0];
  let cpu = null;
  if (s.os === "linux") {
    const f = out[1].split(/\s+/).slice(1).map(Number);
    const idle = f[3] + (f[4] || 0), total = f.reduce((a, b) => a + b, 0);
    if (s.prev && total > s.prev[1]) cpu = 100 * (1 - (idle - s.prev[0]) / (total - s.prev[1]));
    s.prev = [idle, total];
    const kb = (k) => Number((out.find((l) => l.startsWith(k)) || "0 0").split(/\s+/)[1]);
    const mt = kb("MemTotal:");
    s.mem = mt ? Math.round(100 * (1 - kb("MemAvailable:") / mt)) : null;
    s.cores = Number(out[out.length - 2]);
    s.load = out[out.length - 1];
  } else if (s.os === "darwin") {
    s.cores = Number(out[1]);
    s.load = (out[3].match(/[\d.]+/) || [""])[0];
    const page = Number((text.match(/page size of (\d+)/) || [0, 0])[1]);
    const pages = (k) => Number((text.match(new RegExp(k + ":\\s+(\\d+)")) || [0, 0])[1]);
    const used = (pages("Pages active") + pages("Pages wired down") + pages("Pages occupied by compressor")) * page;
    s.mem = Number(out[2]) ? Math.round((100 * used) / Number(out[2])) : null;
    cpu = Math.min(100, Number((text.match(/^cpu ([\d.]+)/m) || [0, 0])[1]) / (s.cores || 1));
  }
  if (cpu != null) push(s.cpu, cpu);
  if (s.mem != null) push(s.mems, s.mem);
}

async function sample() {
  if (store.busy) return;
  store.busy = true;
  const hidden = opts().hidden;
  const targets = machines().filter((m) => !hidden.includes(m.name ?? "") && (!m.name || m.layout !== "unavailable"));
  await Promise.all(targets.map(async ({ name }) => {
    const s = (store.m[name ?? ""] ??= { cpu: [], mems: [] });
    try {
      parse((await exec("sh", ["-c", PROBE], { on: name, timeout: 5000 })).stdout, s);
      s.ok = s.os === "linux" || s.os === "darwin";
    } catch { s.ok = false; } // offline, or no sh (Windows): the row is left out
  }));
  store.at = Date.now();
  store.busy = false;
  store.rev++;
}

// This mod's block for a place ("panel" or "bar") in the shown layout, with whether it or a node
// above it is hidden.
function block(place, node = layout(), hidden = false, parent = null) {
  if (!node) return null;
  hidden ||= node.hidden === true;
  const c = node.content;
  if (c?.mod === MOD && (c.props?.variant === "bar") === (place === "bar")) return { node, parent, hidden };
  for (const child of node.children || []) {
    const hit = block(place, child, hidden, node);
    if (hit) return hit;
  }
  return null;
}

const find = (node, id) => (node.id === id ? node : (node.children || []).map((c) => find(c, id)).find(Boolean));

// Shows or hides a place. A layout that has no block for it gets one, where Herdr's main layout
// (and its clones) keep the sidebar and the status bar; shipped layouts refuse structure changes.
function setPlace(place, on) {
  const hit = block(place);
  if (hit) return run(on ? "layout.show" : "layout.hide", { id: hit.node.id });
  if (!on) return null;
  const tree = JSON.parse(JSON.stringify(layout()));
  if (place === "bar") {
    const status = find(tree, "status");
    if (!status) return null;
    const bar = { id: "status-meters", type: "block", size: { px: 430 }, content: { mod: MOD, props: { variant: "bar" } } };
    if (status.type === "block") {
      const main = { id: "status-main", type: "block", size: { weight: 1 }, content: status.content };
      delete status.content;
      Object.assign(status, { type: "row", resizable: false, children: [main, bar] });
    } else (status.children ||= []).push(bar);
  } else {
    const sidebar = find(tree, "sidebar");
    if (!sidebar?.children) return null;
    const at = sidebar.children.findIndex((c) => c.id === "sidebar-footer");
    sidebar.children.splice(at < 0 ? sidebar.children.length : at, 0,
      { id: "meters", type: "block", size: { px: 82 }, content: { mod: MOD } }); // fit() sets the real height
  }
  return run("layout.set", { layout: tree });
}

export default class MachineMeters extends View {
  init(_props, cx) {
    this.rev = -1;
    this.place = props()?.variant === "bar" ? "bar" : "panel";
    if (checking() || this.isSettings()) return;
    cx.timer.every(1000, (cx) => this.tick(cx));
    this.tick(cx);
  }

  // The options: the popup a click opens, or the mod opened by itself (mod.open, the palette).
  isSettings() {
    const p = props();
    return p?.view === "settings" || Boolean(p?.overlay && !p?.variant);
  }

  // Samples when the interval is up and this copy is shown; redraws only on a new sample.
  tick(cx) {
    cx.spawn(async (cx) => {
      if (block(this.place)?.hidden) return;
      if (Date.now() - store.at >= opts().interval * 1000 - 50) await sample();
      this.fit();
      if (this.rev !== store.rev) { this.rev = store.rev; cx.notify(); }
    });
  }

  // Keeps the sidebar block as tall as its cards: a title and up to two rows a machine. Without it
  // an unticked machine or reading leaves a gap. Runs only when the wanted height changes.
  fit() {
    const n = this.rows().length, o = opts();
    if (this.place !== "panel" || !n) return;
    const want = 21 + n * (17 + (o.cpu ? 22 : 0) + (o.mem ? 22 : 0)) + 10 * (n - 1);
    if (want === this.want) return;
    this.want = want;
    const hit = block("panel");
    if (hit) run("layout.resize", { id: hit.node.id, px: want });
  }

  // Shown machines: this computer first, then the others by name.
  rows(only) {
    const hidden = opts().hidden;
    return Object.entries(store.m)
      .filter(([key, s]) => s.ok && !hidden.includes(key) && (only === undefined || key === only))
      .sort(([a], [b]) => (a === "" ? -1 : b === "" ? 1 : a.localeCompare(b)))
      .map(([key, s]) => ({ name: key || LOCAL, s }));
  }

  graph(samples, t, tone, w, h, n) {
    const hist = Array.from({ length: n }, (_, i) => samples[samples.length - n + i]);
    return h_flex().h(h).gap(1).items_end().children(
      hist.map((p) => div().w(w).h(Math.max(1, ((p ?? 0) * h) / 100)).bg(p == null ? t.border : tone(p))));
  }

  meter(p, t, tone, w) {
    return h_flex().w(w).h(5).rounded(2).bg(t.border).child(div().h_full().w(((p ?? 0) * w) / 100).rounded(2).bg(tone(p ?? 0)));
  }

  settings() {
    const t = theme(), o = opts();
    const set = (k, v) => setShared(MOD, { ...o, [k]: v });
    const box = (on) => div().size(12).rounded(3).border(1).border_color(on ? t.accent : t.input).bg(on ? t.accent : t.surface);
    const row = (id, on, label, click, note) => h_flex().id(id).gap(8).items_center().px(6).py(4).rounded(4).hover((s) => s.bg(t.hover))
      .on_click(click).child(box(on)).child(label).when(Boolean(note), (el) => el.child(div().text_color(t.dim).text_size(11).child(note)));
    const toggle = (k, label) => row(`opt-${k}`, o[k], label, () => set(k, !o[k]));
    const choice = (k, v, label) => div().id(`opt-${k}-${v}`).px(8).py(3).rounded(4).border(1)
      .border_color(o[k] === v ? t.accent : t.border).text_color(o[k] === v ? t.foreground : t.muted)
      .hover((s) => s.bg(t.hover)).on_click(() => set(k, v)).child(label);
    const head = (text) => div().px(6).pt(8).pb(2).text_color(t.dim).text_size(11).child(text);
    const place = (id, label) => {
      const hit = block(id);
      return row(`place-${id}`, Boolean(hit && !hit.node.hidden), label, () => setPlace(id, !(hit && !hit.node.hidden)), hit ? "" : "not in this layout");
    };
    const machine = ({ name }) => {
      const key = name ?? "", on = !o.hidden.includes(key);
      return row(`machine-${key || "local"}`, on, key || LOCAL,
        () => set("hidden", on ? [...o.hidden, key] : o.hidden.filter((h) => h !== key)));
    };
    return v_flex().size_full().p(8).bg(t.popover).text_size(12.5).text_color(t.foreground).overflow_y_scrollbar()
      .child(div().px(6).pb(2).font_semibold().child("Machine meters"))
      .child(head("Show in")).child(place("panel", "Sidebar")).child(place("bar", "Status bar"))
      .child(head("Machines")).children(machines().map(machine))
      .child(head("Readings"))
      .child(toggle("cpu", "CPU")).child(toggle("mem", "Memory")).child(toggle("graph", "History graphs")).child(toggle("load", "Load average"))
      .child(head("Status bar shows"))
      .child(h_flex().gap(6).px(6).child(choice("bar", "active", "Shown space's machine")).child(choice("bar", "all", "All")))
      .child(head("Refresh every"))
      .child(h_flex().gap(6).px(6).children([2, 3, 5, 10].map((n) => choice("interval", n, `${n} s`))));
  }

  render() {
    if (this.isSettings()) return this.settings();
    const t = theme(), o = opts();
    const tone = (p) => (p >= 85 ? t.ansi1 : p >= 60 ? t.ansi3 : t.ansi2);
    const open = () => openOverlay({ mod: MOD, props: { view: "settings" }, kind: "dialog", width: 260, height: 396 + 26 * machines().length });
    const dim = (text) => div().text_color(t.dim).child(text);
    const val = (text) => div().text_color(t.foreground).child(text);

    if (this.place === "bar") {
      const active = spaces().find((s) => s.active);
      const rows = this.rows(o.bar === "active" ? active?.machine ?? "" : undefined);
      return h_flex().id("meters-bar").size_full().px(14).gap(18).items_center().justify_end().bg(t.chrome).border_t(1).border_color(t.border)
        .text_size(11.8).on_click(open).children(rows.map(({ name, s }) => {
          const cpu = s.cpu.at(-1);
          return h_flex().gap(7).items_center().child(div().text_color(t.muted).child(name))
            .when(o.cpu, (el) => el.child(dim("CPU")).when(o.graph, (e) => e.child(this.graph(s.cpu, t, tone, 2, 12, 20))).child(val(cpu == null ? "–" : `${cpu}%`)))
            .when(o.mem, (el) => el.child(dim("MEM")).when(o.graph, (e) => e.child(this.graph(s.mems, t, tone, 2, 12, 20))).child(val(s.mem == null ? "–" : `${s.mem}%`)))
            .when(o.load && Boolean(s.load), (el) => el.child(dim(`load ${s.load}/${s.cores}`)));
        }));
    }

    const rows = this.rows().map(({ name, s }) => {
      const cpu = s.cpu.at(-1);
      const line = (label, el, text) => h_flex().gap(8).items_center().child(div().w(30).text_color(t.dim).child(label)).child(el).child(val(text));
      return v_flex().gap(4)
        .child(h_flex().justify_between().child(div().text_color(t.foreground).font_semibold().child(name))
          .child(dim(o.load && s.load ? `load ${s.load}/${s.cores}` : "")))
        .when(o.cpu, (el) => el.child(line("CPU", o.graph ? this.graph(s.cpu, t, tone, 3, 18, POINTS) : this.meter(cpu, t, tone, POINTS * 4), cpu == null ? "–" : `${cpu}%`)))
        .when(o.mem, (el) => el.child(line("MEM", o.graph ? this.graph(s.mems, t, tone, 3, 18, POINTS) : this.meter(s.mem, t, tone, POINTS * 4), s.mem == null ? "–" : `${s.mem}%`)));
    });
    return v_flex().id("meters-panel").size_full().bg(t.chrome).border_t(1).border_color(t.border).px(14).py(10).gap(10).text_size(11.5)
      .overflow_y_scrollbar().on_click(open).children(rows.length ? rows : [dim("waiting for machines…")]);
  }
}
