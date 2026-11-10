#!/bin/sh
# Claude Code hook: keeps "how to get this Claude back" on its herdr-core terminal,
# so machine-sidebar's Restore covers every Claude, not only the ones it started.
# SessionStart sets the label; quitting on purpose (/exit, ctrl-d) clears it, so
# only a session lost to a reboot or crash keeps it.
#
#   "hooks": {
#     "SessionStart": [{ "hooks": [{ "type": "command", "command": "sh ~/.claude/hooks/claude-hc-resume.sh start" }] }],
#     "SessionEnd":   [{ "hooks": [{ "type": "command", "command": "sh ~/.claude/hooks/claude-hc-resume.sh end" }] }]
#   }
[ -n "$HC_TERMINAL_ID" ] || exit 0
command -v hc >/dev/null 2>&1 || PATH="$HOME/.local/bin:$PATH"
input=$(cat)
id=$(printf '%s' "$input" | jq -r '.session_id // empty')
reason=$(printf '%s' "$input" | jq -r '.reason // empty')
case "$1" in
  start) [ -n "$id" ] && hc label "$HC_TERMINAL_ID" "resume=claude --resume $id" >/dev/null 2>&1 ;;
  end) [ "$reason" = prompt_input_exit ] && hc label "$HC_TERMINAL_ID" "resume=" >/dev/null 2>&1 ;;
esac
exit 0
