// Terminals layout's sidebar: each machine with every terminal under it, flat.
// One space per machine, so the list never shows spaces. A row is one terminal:
// its program's icon, then the tab's name if someone named it, else the shell's
// folder or the program's title. ↳ marks a sub-agent (a terminal another one started).
// Hover shows × to close; drag a row onto another of the same machine to move its tab there.
// A machine's header folds it; folded, it shows its most urgent agent state.

import { View, div, svg, image } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, terminals, machines, focused, run, theme, openOverlay, nextCommand } from "herdr";

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

const home = (cwd) => (cwd ?? "").replace(/^\/home\/[^/]+/, "~");

function label(t, pane, tab) {
  if (tab?.named && tab.panes === 1) return tab.name;
  const g = pane?.program ?? t.program;
  if (g?.shell && pane?.cwd) return home(pane.cwd);
  return pane?.title || t.name || t.address;
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

export default class Sidebar extends View {
  init(_props, cx) {
    this.folded = loadFolded();
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        const step = c === "next" ? 1 : c === "prev" ? -1 : 0;
        if (step) this.step(step);
        // Touching cx ends this loop once a newer build of the mod replaces it.
        cx.notify();
      }
    });
  }

  // Ctrl+Tab: the next row as the sidebar shows them (folded machines skipped), any program.
  step(by) {
    const all = terminals();
    const byPane = panes().filter((p) => p.terminal);
    const order = machines()
      .filter((m) => !this.folded.has(m.name ?? "here"))
      .flatMap((m) => rowsOf(m.name, all, byPane));
    if (!order.length) return;
    const here = order.findIndex((t) => t.address === focused()?.terminal);
    const next = order[(here + by + order.length) % order.length];
    open(next, byPane.find((p) => p.terminal === next.address));
  }

  render() {
    const th = theme();
    const tabs = spaces().flatMap((s) => s.tabs);
    const all = terminals();
    const byPane = panes().filter((p) => p.terminal);
    const shown = focused()?.terminal ?? null;
    const here = spaces().find((p) => p.active)?.machine ?? null;

    const row = (term) => {
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
        .when(on, (el) => el.bg(C.row).border_color(C.rowEdge))
        .when(!on, (el) => el.border_color("#00000000").hover((s) => s.bg(C.hover)))
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
        .child(tile(th, program(term, pane), pane?.status ?? term.status))
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
      const folded = this.folded.has(key);
      const up = m.layout !== "unavailable";
      const states = rows.map((r) => byPane.find((p) => p.terminal === r.address)?.status ?? r.status);
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
        .when(!folded, (el) => el.children(rows.map(row)));
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

    return v_flex()
      .id("ms-tree")
      // A drag let go outside any row is no move.
      .on_mouse_up("left", (_e, cx) => {
        this.pressed = null;
        cx.notify();
      })
      .size_full()
      .child(v_flex().id("ms-list").flex_1().min_h(0).pt(8).px(4).gap(10).overflow_y_scroll().children(machines().map(machine)))
      .child(
        v_flex()
          .flex_none()
          .px(4)
          .pt(4)
          .pb(8)
          .border_t_1()
          .border_color("#ffffff0d")
          .child(footRow("ms-settings", "settings", "Settings", () => run("app.settings")))
          .child(footRow("ms-add-machine", "server", "Add machine", () => run("mod.open", { name: "machine-add" }))),
      );
  }
}
