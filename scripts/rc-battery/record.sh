#!/usr/bin/env bash
# Records one battery result on the release candidate through seqtoid-gitops' release CLI:
#
#   record.sh <check> <pass|fail|pending> <url> [<note>]
#
# env: RELEASE  path to bin/release   RC_ID  the RC being vetted
#
# `rc record-check` is the contract (--rc --check --status --url). A note is passed only when the
# CLI advertises a flag for it (--note or --reason), and `pending` only when its help lists it: a
# CLI that does not know `pending` gets nothing recorded for that check (the RC stays not-green),
# never a guessed pass. Every result is also written to the run summary.
set -euo pipefail

check="${1:?check}"; status="${2:?status}"; url="${3:?url}"; note="${4:-}"
: "${RELEASE:?RELEASE (path to bin/release) is required}"
: "${RC_ID:?RC_ID is required}"

case "$status" in pass|fail|pending) ;; *) echo "::error::bad status '$status'" >&2; exit 2 ;; esac

help="$("$RELEASE" rc record-check --help 2>&1 || true)"
args=(rc record-check --rc "$RC_ID" --check "$check" --status "$status" --url "$url")
if [ -n "$note" ]; then
  if grep -q -- '--note' <<<"$help"; then args+=(--note "$note")
  elif grep -q -- '--reason' <<<"$help"; then args+=(--reason "$note")
  fi
fi

row() { [ -n "${GITHUB_STEP_SUMMARY:-}" ] && echo "| \`$check\` | $1 | ${note:-} |" >> "$GITHUB_STEP_SUMMARY"; return 0; }

if [ "$status" = "pending" ] && ! grep -qw 'pending' <<<"$help"; then
  echo "::warning::release CLI has no 'pending' status; ${check} left unrecorded (${note})"
  row "pending (not recorded: CLI has no pending)"
  exit 0
fi

echo "recording ${check}=${status} on ${RC_ID}${note:+ (${note})}"
"$RELEASE" "${args[@]}"
row "$status"
