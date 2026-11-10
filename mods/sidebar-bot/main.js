// A small bot above the sidebar that acts out the most urgent agent on any machine:
// asleep when nothing runs, at its laptop while agents work, standing with a red
// antenna when one needs you, a hop when one is done. Click it to jump to that agent.
// Drawn from boxes in theme colors, so it follows the theme and needs no image files.

import { View, div } from "gpui-kit";
import { panes, terminals, machines, spaces, run, theme } from "herdr";

const RANK = { blocked: 3, done: 2, working: 1 };
const HOME_X = 14;
const BASE = 30; // the bot's top when standing

const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : null);

// Claude Code puts a braille spinner first in its title while it works, and the
// `claude agents` dashboard reports no state but says "3 awaiting input".
function stateOf(t, pane) {
  const title = pane?.title ?? "";
  if (/\d+ awaiting input/.test(title)) return "blocked";
  const s = pane?.status ?? t.status;
  if (s && s !== "idle") return s;
  if (/^[⠀-⣿]/.test(title)) return "working";
  return null;
}

// The most urgent terminal on any machine, with what the bubble says about it.
function fleet() {
  const byPane = panes().filter((p) => p.terminal);
  const tabs = spaces().flatMap((s) => s.tabs);
  let top = null;
  let working = 0;
  for (const t of terminals()) {
    if (t.state !== "live") continue;
    const pane = byPane.find((p) => p.terminal === t.address);
    const state = stateOf(t, pane);
    if (!state) continue;
    if (state === "working") working++;
    if (top && RANK[top.state] >= RANK[state]) continue;
    const tab = tabs.find((c) => c.id === pane?.tab);
    const name = (tab?.named ? tab.name : pane?.title) || t.address;
    top = { state, address: t.address, pane, name, machine: machineOf(t.address) ?? "local" };
  }
  const offline = machines().find((m) => m.name && m.layout === "unavailable")?.name ?? null;
  return { top, working, offline };
}

export default class Bot extends View {
  init(_props, cx) {
    this.x = HOME_X;
    this.blink = false;
    this.hop = false;
    this.last = null;
    // Blink now and then, and wander when nothing needs saying.
    cx.timer.every(1500, (cx) => {
      const { top } = fleet();
      this.react(top?.state ?? "idle", cx);
      if (!this.blink && Math.random() < 0.18) {
        this.blink = true;
        cx.timer.after(160, (cx) => {
          this.blink = false;
          cx.notify();
        });
      }
      if (!top && Math.random() < 0.2) this.x = HOME_X + Math.round(Math.random() * 110);
      if (top) this.x = HOME_X;
      cx.notify();
    });
  }

  // A hop the first time a state turns up.
  react(state, cx) {
    if (state === this.last) return;
    this.last = state;
    if (state !== "done" && state !== "blocked") return;
    this.hop = true;
    cx.timer.after(220, (cx) => {
      this.hop = false;
      cx.notify();
    });
  }

  render() {
    const th = theme();
    const { top, working, offline } = fleet();
    const state = top?.state ?? "idle";
    const asleep = !top;
    const light = { blocked: th.blocked, done: th.done, working: th.working }[state] ?? th.dim;
    const eyeH = asleep || this.blink ? 2 : 7;
    const eyeTop = state === "working" ? 13 : 10;

    const eye = (left) =>
      div().absolute().left(left).top(eyeTop + (7 - eyeH) / 2).w(7).h(eyeH).rounded(2).bg(asleep ? th.dim : th.foreground);

    const bot = div()
      .absolute()
      .left(this.x)
      .top(this.hop ? BASE - 10 : BASE)
      .w(44)
      .h(58)
      .transition("left", { duration: 2400, easing: "ease-in-out" })
      .spring("top", { response: 260, damping: 0.55 })
      .opacity(asleep ? 0.6 : 1)
      // antenna: a stick and a light that pulses unless asleep
      .child(div().absolute().left(21).top(0).w(2).h(9).bg(th.border))
      .child(
        div()
          .absolute()
          .left(18)
          .top(-4)
          .w(8)
          .h(8)
          .rounded_full()
          .bg(light)
          .when(!asleep, (el) => el.loop("opacity", { from: 0.35, to: 1, period: state === "blocked" ? 700 : 1600 })),
      )
      // head
      .child(
        div()
          .absolute()
          .left(0)
          .top(9)
          .w(44)
          .h(30)
          .rounded(10)
          .bg(th.raised)
          .border_1()
          .border_color(th.border)
          .child(eye(11))
          .child(eye(26)),
      )
      // body and feet
      .child(div().absolute().left(11).top(41).w(22).h(10).rounded(4).bg(th.raised).border_1().border_color(th.border))
      .child(div().absolute().left(13).top(52).w(6).h(4).rounded(1).bg(th.border))
      .child(div().absolute().left(25).top(52).w(6).h(4).rounded(1).bg(th.border));

    const laptop = div()
      .absolute()
      .left(this.x + 46)
      .top(BASE + 40)
      .w(26)
      .h(14)
      .rounded(3)
      .bg(th.surface)
      .border_1()
      .border_color(th.border)
      .child(div().absolute().left(4).top(4).w(16).h(2).rounded(1).bg(th.working).loop("width", { from: 4, to: 16, period: Math.max(500, 1400 - working * 150) }));

    const zz = div()
      .absolute()
      .left(this.x + 46)
      .top(BASE - 2)
      .text_size(12)
      .text_color(th.dim)
      .frames(["z", "z z", "z z z", ""], 900);

    // Two short lines: who, then what and where.
    const say =
      state === "blocked"
        ? [top.name, `needs you · ${top.machine}`]
        : state === "done"
          ? [top.name, `done ✓ · ${top.machine}`]
          : offline && asleep
            ? [offline, "offline"]
            : null;
    const bubble = div()
      .absolute()
      .left(HOME_X + 54)
      .right(10)
      .top(BASE + 4)
      .px(8)
      .py(5)
      .rounded(8)
      .bg(th.raised)
      .border_1()
      .border_color(state === "blocked" ? th.blocked : th.border)
      .text_size(11.5)
      .when(Boolean(say), (el) =>
        el
          .child(div().truncate().text_color(th.foreground).child(say[0]))
          .child(div().truncate().text_size(10.5).text_color(state === "blocked" ? th.blocked : th.dim).child(say[1])),
      );

    return div()
      .id("bot")
      .relative()
      .size_full()
      .overflow_hidden()
      .cursor_pointer()
      .on_click(() => {
        if (!top) return;
        if (top.pane) run("pane.focus", { terminal: top.address });
        else run("agent.focus", { terminal: top.address });
      })
      // floor
      .child(div().absolute().left(10).right(10).bottom(14).h(1).bg(th.border))
      .when(state === "working", (el) => el.child(laptop))
      .when(asleep, (el) => el.child(zz))
      .child(bot)
      .when(Boolean(say), (el) => el.child(bubble));
  }
}
