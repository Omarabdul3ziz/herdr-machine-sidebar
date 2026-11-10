// A small bot above the sidebar that acts out the most urgent agent on any machine:
// asleep when nothing runs, at its laptop while agents work, standing with a red
// antenna when one needs you, a hop when one is done. Click it to jump to that agent.
// Drawn from boxes in theme colors, so it follows the theme and needs no image files.
// Its thoughts pop up in a cloud above it now and then: what needs you (often), else a
// passing thought about the fleet or nothing in particular. Made for a ~160 px strip.

import { View, div } from "gpui-kit";
import { panes, terminals, machines, spaces, run, theme } from "herdr";

const RANK = { blocked: 3, done: 2, working: 1 };
const HOME_X = 14;
const BASE = 90; // the bot's top when standing; the room above is for hops and thoughts

// Idle thoughts: a little about the fleet, a little about nothing.
function musing(working, asleep) {
  const hour = new Date().getHours();
  const pool = asleep
    ? [["all quiet", "nothing running"], ["zz…", "wake me when it matters"]]
    : [[`${working || "no"} agent${working === 1 ? "" : "s"} busy`, "I'm watching them"], ["beep boop", "all good here"]];
  if (hour >= 23 || hour < 5) pool.push(["late one?", "the agents don't sleep"]);
  if (hour >= 6 && hour < 10) pool.push(["good morning", "☕"]);
  pool.push(["♪ la la", ""], ["…", ""]);
  return pool[Math.floor(Math.random() * pool.length)];
}

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
    this.look = 0;
    this.last = null;
    this.big = false;
    this.thought = null; // [line, line] kept while it fades out
    this.shown = false;
    this.ticks = 0; // how long the cloud has been up, or down
    // Small things now and then: blink, glance, hop, stroll. Asleep, it mostly stays put;
    // with a bubble up it keeps near home so the bubble has room.
    cx.timer.every(1200, (cx) => {
      const { top } = fleet();
      const state = top?.state ?? "idle";
      const asleep = !top;
      const roll = Math.random;
      this.react(state, cx);
      if (!this.blink && roll() < 0.2) this.flash(cx, "blink", 160);
      if (!asleep && roll() < 0.25) this.look = [-2, 0, 2][Math.floor(roll() * 3)];
      if (!asleep && roll() < (state === "blocked" ? 0.25 : 0.12)) {
        this.big = roll() < 0.25;
        this.flash(cx, "hop", this.big ? 320 : 200);
        if (roll() < 0.3) cx.timer.after(500, (cx) => this.flash(cx, "hop", 200));
      }
      if (roll() < (asleep ? 0.03 : 0.22)) this.x = HOME_X + Math.round(roll() * 120);
      this.think(fleet(), roll);
      cx.notify();
    });
  }

  // Sets a flag for a moment (a blink, a hop) and redraws when it ends.
  flash(cx, flag, ms) {
    this[flag] = true;
    cx.notify();
    cx.timer.after(ms, (cx) => {
      this[flag] = false;
      cx.notify();
    });
  }

  // The cloud pops up: what needs you stays up longer and comes back sooner; otherwise a
  // passing thought shows once in a while.
  think({ top, working, offline }, roll) {
    const state = top?.state ?? "idle";
    const news =
      state === "blocked"
        ? [top.name, `needs you · ${top.machine}`]
        : state === "done"
          ? [top.name, `done ✓ · ${top.machine}`]
          : offline
            ? [offline, "is offline"]
            : null;
    this.ticks++;
    if (this.shown) {
      if (this.ticks >= (news ? 5 : 3)) [this.shown, this.ticks] = [false, 0];
      return;
    }
    if (news ? this.ticks >= 3 : roll() < 0.07) {
      this.thought = news ?? musing(working, !top);
      [this.shown, this.ticks] = [true, 0];
    }
  }

  // A hop the first time a state turns up.
  react(state, cx) {
    if (state === this.last) return;
    this.last = state;
    if (state !== "done" && state !== "blocked") return;
    this.big = true;
    this.flash(cx, "hop", 320);
    this.ticks = 99; // and say it right away
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
      div().absolute().left(left + this.look).top(eyeTop + (7 - eyeH) / 2).w(7).h(eyeH).rounded(2).bg(asleep ? th.dim : th.foreground).transition("left", 180);

    const bot = div()
      .absolute()
      .left(this.x)
      .top(this.hop ? BASE - (this.big ? 34 : 16) : BASE)
      .w(44)
      .h(58)
      .transition("left", { duration: 2400, easing: "ease-in-out" })
      .spring("top", { response: 240, damping: 0.5 })
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
          .when(!asleep, (el) => el.loop("top", { from: 9, to: 11, period: 2600 }))
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

    // The thought cloud across the top, with two puffs trailing down to the bot's head.
    const [line1, line2] = this.thought ?? ["", ""];
    const urgent = this.shown && state === "blocked";
    const up = this.shown ? 1 : 0;
    const puff = (size, left, top) =>
      div()
        .absolute()
        .left(left)
        .top(top)
        .w(size)
        .h(size)
        .rounded_full()
        .bg(th.raised)
        .border_1()
        .border_color(urgent ? th.blocked : th.border)
        .opacity(up)
        .transition("opacity", 250)
        .transition("left", { duration: 2400, easing: "ease-in-out" });
    const cloud = div()
      .absolute()
      .left(10)
      .right(10)
      .top(this.shown ? 8 : 22)
      .spring("top", { response: 300, damping: 0.6 })
      .opacity(up)
      .transition("opacity", 250)
      .px(10)
      .py(6)
      .rounded(14)
      .bg(th.raised)
      .border_1()
      .border_color(urgent ? th.blocked : th.border)
      .text_size(12)
      .child(div().truncate().text_color(th.foreground).child(line1))
      .when(Boolean(line2), (el) =>
        el.child(div().truncate().text_size(10.5).text_color(urgent ? th.blocked : th.dim).child(line2)),
      );

    // A done agent gets sparkles over the antenna.
    const sparkle = div()
      .absolute()
      .left(this.x + 30)
      .top(BASE - 18)
      .text_size(11)
      .text_color(th.done)
      .frames(["✦", "✧", " ", "✧"], 300);

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
      .when(state === "done", (el) => el.child(sparkle))
      .child(cloud)
      .child(puff(10, this.x + 32, 62))
      .child(puff(6, this.x + 26, 76))
      .child(bot);
  }
}
