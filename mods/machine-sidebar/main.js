// Terminals layout's sidebar: each machine with every terminal under it, flat.
// One space per machine, so the list never shows spaces. A row is one terminal:
// its program's icon, then the tab's name if someone named it, else the shell's
// folder or the program's title. ↳ marks a sub-agent (a terminal another one started).
// Hover shows × to close; drag a row onto another of the same machine to move its tab there.
// A machine's header folds it; folded, it shows its most urgent agent state.
// Rows run in one flat list per machine, asking first, then working, then done (done,
// idle and shells); each row is tinted to say which: red, blue, green.
//
// The line at the bottom starts an agent, parsed without AI: `@machine #agent ~/folder
// what to do` (defaults: local, claude, home). Clicking it (or ctrl+shift+d) opens it
// big in a dialog — this same mod with props.composer — showing where the line will go. Each agent started carries its resume
// command as an hc label; after a reboot it comes back as a shell, and its machine's
// Restore button types the command in again.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex, TextareaState, Textarea } from "gpui-base";
import { spaces, panes, terminals, machines, focused, run, theme, openOverlay, closeOverlay, props, nextCommand, hc, exec, home as homeDir } from "herdr";

const C = {
  // The shown terminal stands out; a hovered one only hints, so the two never look alike.
  row: "#34373c",
  rowEdge: "#4a4d53",
  hover: "#ffffff07",
  chip: "#252628",
  text: "#e8e9eb",
  dim: "#8b8f95",
  bg: "#131619",
};

// A control in the draggable sidebar: the press is its own, not the window's
// (a right press there would open the system's window menu).
function own(el) {
  return el.on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_mouse_down("right", (_e, cx) => cx.stop_propagation());
}

const spaceOf = (machine) => spaces().find((p) => p.machine === machine);
const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);

function newTab(machine) {
  const space = spaceOf(machine);
  if (space) run("tab.new", { space: space.id });
  else run("space.new", { machine: machine ?? "" });
}

// The tab when it holds only this terminal, else just its pane; a sub-agent with no pane ends.
function close(term, pane, tab) {
  if (tab?.panes === 1) run("tab.close", { id: tab.id });
  else if (pane) run("pane.close", { pane: pane.pane });
  else run("terminal.kill", { terminal: term.address });
}

function open(term, pane) {
  if (pane) run("pane.focus", { terminal: term.address });
  else if (term.program?.agent || term.parent) run("agent.focus", { terminal: term.address });
  else run("terminal.peek", { terminal: term.address });
}

const URGENT = ["blocked", "done", "working"];
const ICON = (name) => `mods/workspace-chrome/${name}.svg`;

function loadFolded() {
  try {
    return new Set(JSON.parse(localStorage.getItem("machines.folded") ?? "[]"));
  } catch {
    return new Set();
  }
}

// Agents the program table can't see: the `claude agents` dashboard reports no
// state, and a machine without /proc (devbox) reports no foreground program, so
// fall back to the agent's name in the title.
const AGENTS = ["claude", "omp", "pi", "codex", "opencode", "gemini", "hermes", "amp"];

function program(t, pane) {
  const g = pane?.program ?? t.program;
  if (g && !g.shell) return g;
  const title = (pane?.title ?? "").toLowerCase();
  const key = AGENTS.find((a) => new RegExp(`\\b${a}\\b`).test(title));
  return key ? { ...g, key, icon: `icons/${key === "omp" ? "pi" : key}.svg`, tint: false, tile: null } : g;
}

// The program's tile from the app's table: its glyph (or logo), and a dot when
// its agent is busy, blocked or done.
function tile(th, g, status) {
  const dot = status && status !== "idle" ? th[status] : null;
  return div()
    .relative()
    .flex_none()
    .w(22)
    .h(22)
    .rounded(6)
    .border_1()
    .border_color("#ffffff14")
    .bg(g?.tile ?? C.chip)
    .flex()
    .items_center()
    .justify_center()
    .when(Boolean(g?.icon), (el) =>
      el.child(g.tint ? svg(g.icon).size(13).text_color(g.color ?? C.text) : image(g.icon).w(13).h(13)),
    )
    .when(Boolean(dot), (el) =>
      el.child(div().absolute().top(-4).right(-4).w(10).h(10).rounded_full().border_2().border_color(C.bg).bg(dot)),
    );
}

const tilde = (cwd) => (cwd ?? "").replace(/^\/home\/[^/]+/, "~");

function label(t, pane, tab) {
  if (tab?.named && tab.panes === 1) return tab.name;
  const g = pane?.program ?? t.program;
  if (g?.shell && pane?.cwd) return tilde(pane.cwd);
  return pane?.title || t.name || t.address;
}

// Claude Code puts a braille spinner first in its title while it works, and the
// `claude agents` dashboard reports no state but says "3 awaiting input".
function stateOf(t, pane) {
  const title = pane?.title ?? "";
  if (/\d+ awaiting input/.test(title)) return "blocked";
  const s = pane?.status ?? t.status;
  if (s && s !== "idle") return s;
  if (/^[\u2800-\u28ff]/.test(title)) return "working";
  return null;
}

// How to start each agent so it can be resumed: we pick the session id where the agent lets us.
const HARNESS = {
  claude: (id) => ({ argv: ["claude", "--session-id", id], resume: `claude --resume ${id}` }),
  pi: (id) => ({ argv: ["pi", "--session-id", id], resume: `pi --session-id ${id}` }),
  omp: () => ({ argv: ["omp"], resume: "omp --continue" }),
};

// The resume command for a terminal one of those started, read back from its argv.
// herdr-app wraps the agent in the machine's shell (`zsh -ic '"$@"; exec "$0" -i' zsh pi …`),
// so the agent can sit anywhere in it. A terminal lost in a reboot comes back with the
// bare shell as its argv, which is how a lost one differs from an agent you quit.
function resumeOf(argv) {
  const i = argv.findIndex((a) => HARNESS[a.split("/").pop()]);
  if (i < 0) return null;
  const name = argv[i].split("/").pop();
  if (name === "omp") return HARNESS.omp().resume;
  const at = argv.indexOf("--session-id", i);
  return at > 0 && argv[at + 1] ? HARNESS[name](argv[at + 1]).resume : null;
}

const uuid = () =>
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 3) | 8).toString(16);
  });

// `@machine #agent ~/folder what to do`: the leading @, # and path words in any order,
// the rest is the prompt.
function parse(text, names) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const out = { machine: null, harness: "claude", folder: "" };
  while (words.length) {
    const w = words[0];
    if (w.startsWith("@")) {
      const m = w.slice(1);
      if (m !== "local" && !names.includes(m)) return { error: `no machine ${w} (local, ${names.join(", ")})` };
      out.machine = m === "local" ? null : m;
    } else if (w.startsWith("#")) {
      if (!HARNESS[w.slice(1)]) return { error: `no agent ${w} (${Object.keys(HARNESS).join(", ")})` };
      out.harness = w.slice(1);
    } else if (/^[~/]/.test(w)) out.folder = w;
    else break;
    words.shift();
  }
  out.prompt = words.join(" ");
  return out.prompt ? out : { error: "nothing to send" };
}

// One machine's live terminals: those in panes in tab order, each followed by the
// sub-agents it started, then any terminal no pane shows.
function rowsOf(machine, all, byPane) {
  const mine = all.filter((t) => t.state === "live" && machineOf(t.address) === machine);
  const out = [];
  const add = (t) => {
    if (out.includes(t)) return;
    out.push(t);
    mine.filter((c) => c.parent === t.address).forEach(add);
  };
  for (const p of byPane) {
    const t = mine.find((x) => x.address === p.terminal);
    if (t) add(t);
  }
  mine.forEach(add);
  return out;
}

// A machine's rows in the order shown: grouped by state when anything asks or works.
function groupsOf(machine, all, byPane) {
  const rows = rowsOf(machine, all, byPane).map((t) => ({ t, pane: byPane.find((p) => p.terminal === t.address) }));
  const asking = rows.filter((r) => stateOf(r.t, r.pane) === "blocked");
  const working = rows.filter((r) => stateOf(r.t, r.pane) === "working");
  const done = rows.filter((r) => !asking.includes(r) && !working.includes(r));
  return [
    { color: "ansi1", alpha: "38", rows: asking },
    { color: "ansi4", alpha: "2e", rows: working },
    { color: "ansi2", alpha: "1c", rows: done },
  ];
}

// Terminals that held an agent we started and came back as a shell after a loss.
const lostOf = (machine, all, byPane) =>
  all.filter(
    (t) =>
      t.state === "live" &&
      machineOf(t.address) === machine &&
      t.labels?.resume &&
      !resumeOf(t.argv ?? []) &&
      (byPane.find((p) => p.terminal === t.address)?.program ?? t.program)?.shell,
  );

function restore(lost) {
  for (const t of lost) hc(["send", t.address, t.labels.resume]);
}

const PLACEHOLDER = "@machine #agent ~/folder what to do";
const machineNames = () => machines().map((m) => m.name).filter(Boolean);

function compose(value = "") {
  openOverlay({ mod: "machine-sidebar", kind: "dialog", width: 640, props: { composer: true, value } });
}

export default class Sidebar extends View {
  init(_props, cx) {
    this.folded = loadFolded();
    this.homes = {};
    this.error = null;
    // The dialog: a big textarea, and nothing else this mod does in the sidebar.
    if (props()?.composer) {
      this.area = TextareaState.new({ placeholder: PLACEHOLDER, value: props().value ?? "" });
      this.area.set_auto_grow(3, 10);
      this.area.on("submit", (e, cx) => {
        if (!e.shift) this.send(cx, this.area.value());
      });
      this.area.on("change", (_e, cx) => {
        this.error = null;
        cx.notify();
      });
      cx.timer.after(30, () => this.area.focus());
      return;
    }
    // Label new agents with their resume command while they still run it.
    cx.timer.every(3000, () => {
      for (const t of terminals()) {
        if (t.state !== "live" || t.labels?.resume) continue;
        const resume = resumeOf(t.argv ?? []);
        if (resume) hc(["label", t.address, `resume=${resume}`]);
      }
    });
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const step = c === "next" ? 1 : c === "prev" ? -1 : 0;
        if (step) this.step(step);
        // `herdr-app do "machine-sidebar.send @devbox #pi fix it"`: the same line, from a script.
        if (c.startsWith("send ")) this.send(cx, c.slice(5));
        if (c === "compose") compose();
        // `herdr-app do machine-sidebar.restore`: every machine's Restore at once.
        if (c === "restore") {
          const all = terminals();
          const byPane = panes().filter((p) => p.terminal);
          restore(machines().flatMap((m) => lostOf(m.name, all, byPane)));
        }
        // Touching cx ends this loop once a newer build of the mod replaces it.
        cx.notify();
      }
    });
  }

  async homeOf(machine) {
    if (!machine) return homeDir();
    if (!this.homes[machine]) {
      const r = await exec("printenv", ["HOME"], { on: machine }).catch(() => null);
      if (r?.code === 0) this.homes[machine] = r.stdout.trim();
    }
    return this.homes[machine] ?? null;
  }

  send(cx, text) {
    const p = parse(text, machineNames());
    if (p.error) {
      this.error = p.error;
      cx.notify();
      return;
    }
    if (this.area) closeOverlay(props().overlay);
    cx.spawn(async (cx) => {
      let folder = p.folder;
      if (folder.startsWith("~")) {
        const h = await this.homeOf(p.machine);
        folder = h ? folder.replace(/^~/, h) : "";
      }
      const { argv } = HARNESS[p.harness](uuid());
      const name = p.prompt.split(/\s+/).slice(0, 4).join(" ").slice(0, 28);
      const space = spaceOf(p.machine);
      const at = folder ? { folder } : {};
      if (space) run("tab.new", { space: space.id, name, argv, task: p.prompt, ...at });
      else run("space.new", { machine: p.machine ?? "", tab: name, argv, task: p.prompt, ...at });
      cx.notify();
    });
  }

  voice(cx) {
    this.area.focus();
    exec("voxtype", ["record", "toggle"])
      .then((r) => {
        if (r.code) this.error = `voice: ${r.stderr.trim() || "voxtype failed"}`;
      })
      .catch(() => {
        this.error = "voice needs voxtype";
      })
      .finally(() => cx.notify());
  }

  // Ctrl+Tab: the next row as the sidebar shows them (folded machines skipped), any program.
  step(by) {
    const all = terminals();
    const byPane = panes().filter((p) => p.terminal);
    const order = machines()
      .filter((m) => !this.folded.has(m.name ?? "here"))
      .flatMap((m) => groupsOf(m.name, all, byPane).flatMap((g) => g.rows.map((r) => r.t)));
    if (!order.length) return;
    const here = order.findIndex((t) => t.address === focused()?.terminal);
    const next = order[(here + by + order.length) % order.length];
    open(next, byPane.find((p) => p.terminal === next.address));
  }

  // The dialog: what you type, where it goes, how to send it.
  composer() {
    const th = theme();
    const text = this.area.value();
    const p = text.trim() ? parse(text, machineNames()) : null;
    const chip = (k, v) =>
      h_flex()
        .gap(5)
        .px(8)
        .h(24)
        .items_center()
        .rounded(6)
        .bg(th.raised)
        .text_size(12)
        .child(div().text_color(th.dim).child(k))
        .child(div().text_color(th.foreground).child(v));
    const where =
      p && !p.error
        ? h_flex()
            .gap(6)
            .child(chip("on", p.machine ?? "local"))
            .child(chip("agent", p.harness))
            .child(chip("in", p.folder || "~"))
        : div()
            .text_size(12)
            .text_color(p?.error ? th.blocked : th.dim)
            .child(p?.error ?? "@machine  #claude | #pi | #omp  ~/folder — then what to do");
    return v_flex()
      .p(14)
      .gap(10)
      .child(div().text_size(13).text_color(th.muted).child("Start an agent"))
      .child(
        Textarea.new(this.area)
          .w_full()
          .px(10)
          .py(8)
          .rounded(8)
          .bg(th.input)
          .border_1()
          .border_color(this.error ? th.blocked : th.border)
          .text_size(15)
          .text_color(th.foreground),
      )
      .child(where)
      .child(
        h_flex()
          .gap(8)
          .items_center()
          .text_size(11.5)
          .text_color(th.dim)
          .child(div().flex_1().child("Enter sends · Shift+Enter new line · Esc closes"))
          .child(
            div()
              .id("ms-mic")
              .px(8)
              .h(26)
              .flex()
              .items_center()
              .rounded(6)
              .cursor_pointer()
              .hover((s) => s.bg(th.hover))
              .tooltip("Dictate (voxtype)")
              .on_click((_e, cx) => this.voice(cx))
              .child("🎙"),
          ),
      )
      .when(Boolean(this.error), (el) => el.child(div().text_size(12).text_color(th.blocked).child(this.error)));
  }

  render() {
    if (this.area) return this.composer();
    const th = theme();
    const tabs = spaces().flatMap((s) => s.tabs);
    const all = terminals();
    const byPane = panes().filter((p) => p.terminal);
    const shown = focused()?.terminal ?? null;
    const here = spaces().find((p) => p.active)?.machine ?? null;

    // A theme color as a see-through row tint; the shown row keeps its own highlight.
    const tint = (g) => {
      const c = th[g.color];
      return /^#[0-9a-f]{6}$/i.test(c ?? "") ? c + g.alpha : C.hover;
    };

    const row = (term, g) => {
      const pane = byPane.find((p) => p.terminal === term.address);
      const on = term.address === shown;
      const tab = tabs.find((c) => c.id === pane?.tab);
      const target = this.pressed && this.pressed.address !== term.address && this.hovered === term.address;
      return own(h_flex())
        .id(`ms-${term.address}`)
        .h(32)
        .ml(6)
        .pl(8)
        .pr(8)
        .gap(8)
        .items_center()
        .rounded(9)
        .border_1()
        .cursor_pointer()
        .text_size(13)
        .bg(tint(g))
        .when(on, (el) => el.border_color(C.rowEdge))
        .when(!on, (el) => el.border_color("#00000000").hover((s) => s.border_color(C.rowEdge)))
        .when(target, (el) => el.border_color(th.accent))
        .on_hover((hover, cx) => {
          if (hover) this.hovered = term.address;
          else if (this.hovered === term.address) this.hovered = null;
          cx.notify();
        })
        .on_mouse_down("left", (_e, cx) => {
          this.pressed = { address: term.address, tab };
          cx.notify();
        })
        .on_mouse_up("left", (_e, cx) => {
          const from = this.pressed;
          this.pressed = null;
          cx.notify();
          // No press on this row (the × took it): nothing to do.
          if (!from) return;
          if (from.address === term.address) return open(term, pane);
          const same = machineOf(from.address) === machineOf(term.address);
          if (same && from.tab && tab && from.tab.id !== tab.id) run("tab.move", { id: from.tab.id, index: tab.index });
        })
        .on_mouse_down("right", () =>
          pane &&
          openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab", target: { id: pane.tab, space: spaceOf(machineOf(term.address))?.id } } }),
        )
        .when(Boolean(term.parent), (el) => el.child(div().flex_none().text_color(C.dim).child("↳")))
        .child(tile(th, program(term, pane), stateOf(term, pane)))
        .child(div().flex_1().min_w(0).truncate().text_color(on ? C.text : "#c4c6ca").child(label(term, pane, tab)))
        .when(this.hovered === term.address && !this.pressed, (el) =>
          el.child(
            own(div())
              .id(`ms-close-${term.address}`)
              .flex_none()
              .w(18)
              .h(18)
              .rounded(5)
              .flex()
              .items_center()
              .justify_center()
              .text_color(C.dim)
              .hover((s) => s.bg(C.chip).text_color(C.text))
              .on_click((_e, cx) => {
                cx.stop_propagation();
                this.hovered = null;
                close(term, pane, tab);
              })
              .child("×"),
          ),
        );
    };

    const machine = (m) => {
      const key = m.name ?? "here";
      const rows = rowsOf(m.name, all, byPane);
      const groups = groupsOf(m.name, all, byPane);
      const lost = lostOf(m.name, all, byPane);
      const folded = this.folded.has(key);
      const up = m.layout !== "unavailable";
      const states = rows.map((r) => stateOf(r, byPane.find((p) => p.terminal === r.address)));
      const urgent = URGENT.find((u) => states.includes(u));
      return v_flex()
        .gap(2)
        .child(
          own(h_flex())
            .id(`ms-machine-${key}`)
            .h(28)
            .pl(8)
            .pr(4)
            .gap(7)
            .items_center()
            .rounded(7)
            .cursor_pointer()
            .text_size(12)
            .text_color(m.name === here ? C.text : C.dim)
            .hover((s) => s.bg(C.hover).text_color(C.text))
            .when(m.layout === "loading", (el) => el.opacity(0.5))
            .on_click((_e, cx) => {
              folded ? this.folded.delete(key) : this.folded.add(key);
              try {
                localStorage.setItem("machines.folded", JSON.stringify([...this.folded]));
              } catch {}
              cx.notify();
            })
            .child(svg(ICON(m.name ? "server" : "monitor")).size(13).flex_none())
            .child(div().flex_1().truncate().child(m.name ?? "local"))
            .when(folded && rows.length > 0, (el) => el.child(div().flex_none().text_size(11).child(String(rows.length))))
            .when(folded && Boolean(urgent), (el) => el.child(div().flex_none().w(7).h(7).rounded_full().bg(th[urgent])))
            .when(!up, (el) => el.child(div().flex_none().text_size(11).child("offline")))
            .when(up && lost.length > 0, (el) =>
              el.child(
                own(div())
                  .id(`ms-restore-${key}`)
                  .flex_none()
                  .px(6)
                  .h(20)
                  .rounded(5)
                  .flex()
                  .items_center()
                  .text_size(11)
                  .text_color(th.accent)
                  .hover((s) => s.bg(C.chip))
                  .tooltip(lost.map((t) => t.labels.resume).join("\n"))
                  .on_click((_e, cx) => {
                    cx.stop_propagation();
                    restore(lost);
                  })
                  .child(`Restore ${lost.length}`),
              ),
            )
            .when(up, (el) =>
              el.child(
                own(div())
                  .id(`ms-new-${key}`)
                  .w(22)
                  .h(22)
                  .rounded(6)
                  .flex()
                  .items_center()
                  .justify_center()
                  .text_color(C.dim)
                  .hover((s) => s.bg(C.chip).text_color(C.text))
                  .on_click((_e, cx) => {
                    cx.stop_propagation();
                    newTab(m.name);
                  })
                  .child(svg(ICON("plus")).size(12)),
              ),
            )
            .child(div().flex_none().w(6).h(6).rounded_full().bg(up ? th.ansi2 : C.dim))
            .child(svg(ICON(folded ? "chevron-right" : "chevron-down")).size(11).flex_none()),
        )
        .when(!folded, (el) =>
          el.children(
            groups.flatMap((g) => g.rows.map((r) => row(r.t, g))),
          ),
        );
    };

    const footRow = (id, icon, text, action) =>
      own(h_flex())
        .id(id)
        .h(28)
        .px(8)
        .gap(9)
        .items_center()
        .rounded(8)
        .cursor_pointer()
        .text_size(13)
        .text_color(C.dim)
        .hover((s) => s.bg(C.hover).text_color(C.text))
        .on_click(action)
        .child(svg(ICON(icon)).size(14))
        .child(text);

    // Looks like an input; opens the dialog, where the line has room.
    const composer = own(h_flex())
      .id("ms-compose")
      .flex_none()
      .mx(8)
      .mt(8)
      .h(32)
      .px(10)
      .gap(8)
      .items_center()
      .rounded(8)
      .bg(C.chip)
      .border_1()
      .border_color("#ffffff14")
      .cursor_text()
      .text_size(12.5)
      .text_color(C.dim)
      .hover((s) => s.border_color(C.rowEdge))
      .on_click(() => compose())
      .child(div().flex_1().truncate().child(PLACEHOLDER))
      .child(div().text_size(10.5).child("ctrl+shift+d"));

    return v_flex()
      .id("ms-tree")
      // A drag let go outside any row is no move.
      .on_mouse_up("left", (_e, cx) => {
        this.pressed = null;
        cx.notify();
      })
      .size_full()
      .child(v_flex().id("ms-list").flex_1().min_h(0).pt(8).px(4).gap(10).overflow_y_scroll().children(machines().map(machine)))
      .child(composer)
      .child(
        v_flex()
          .flex_none()
          .px(4)
          .pt(4)
          .pb(8)
          .border_t_1()
          .border_color("#ffffff0d")
          .child(footRow("ms-settings", "settings", "Settings", () => run("app.settings"))),
      );
  }
}
