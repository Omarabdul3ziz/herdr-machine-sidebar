# machine-sidebar

A [herdr-app](https://herdr.dev) sidebar mod for working across several
machines. Each machine (this computer and every `hc machine`) is a foldable
header; under it, every terminal on that machine is one flat row: the program's
icon with its agent state, then the tab's name, the shell's folder or the
program's title. Sub-agents are marked `↳`.

- Click a row to show it; hover for × to close; drag onto another row of the
  same machine to move its tab.
- A folded machine shows its row count and its most urgent agent state.
- `ctrl+tab` / `ctrl+shift+tab` step through every row (see `keys.json`).
- When a machine has agents asking or working, its rows group into Asking,
  Working and Done (done, idle and shells).
- The line at the bottom starts an agent, parsed without AI:
  `@machine #agent ~/folder what to do` — `@` a machine (`local` or any
  `hc machine`), `#` one of `claude`, `pi`, `omp`, a path, in any order; the
  rest is the first message. Defaults: local, claude, home. 🎙 dictates with
  voxtype. A script can send the same line:
  `herdr-app do "machine-sidebar.send @devbox #pi fix it"`.
- Each agent it starts gets its resume command as an hc label (`resume=`);
  claude and pi get a session id picked at start, omp resumes the folder's
  latest session. After a reboot the terminal comes back as a shell and its
  machine shows **Restore N**, which types the command in again
  (`herdr-app do machine-sidebar.restore` does every machine).
- Settings and Add machine sit at the bottom.

Install: link or copy `mods/machine-sidebar` into `~/.config/herdr-app/mods/`,
merge `keys.json`, and use it as a layout's sidebar block
(`"content": { "mod": "machine-sidebar" }`).

## sidebar-bot

A small bot drawn from theme-coloured boxes, meant as a 110 px block above the
sidebar. It acts out the most urgent agent on any machine: asleep when nothing
runs, at a laptop while agents work, antenna pulsing red with a bubble when one
needs you, a hop and a ✓ when one is done. Click it to jump to that agent;
`ctrl+shift+y` hides it (`layout.toggle:bot`). In the layout, the sidebar is a
column: `{ "id": "bot", "size": { "px": 110 }, "content": { "mod": "sidebar-bot" } }`
above the `machine-sidebar` block.
