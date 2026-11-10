#!/usr/bin/env bash
# Builds a forward-port branch: the hotfix commits that are not yet in the target (by patch-id, so
# commits already cherry-picked over are skipped), cherry-picked with -x onto the target in order.
#
#   forward-port.sh <source-ref> <target-ref> <label>
#
# Leaves the branch `forward-port/<label>` checked out and prints key=value lines:
#   status=clean|conflict|nothing  branch=...  body=<path to a markdown PR body>
# On a conflict it stops at the first commit that does not apply, keeps the commits before it, and
# lists the conflicting commit, its files and the commits still to port, so the PR can open as a
# draft for a human to finish. If nothing applied cleanly it adds one empty commit so the draft PR
# can exist at all.
set -euo pipefail

src="${1:?source ref}"; target="${2:?target ref}"; label="${3:?label}"
branch="forward-port/${label}"
body="$(mktemp)"

mapfile -t commits < <(git rev-list --reverse --no-merges --right-only --cherry-pick "${target}...${src}")
if [ "${#commits[@]}" -eq 0 ]; then
  echo "status=nothing"; echo "branch=${branch}"; echo "body=${body}"
  exit 0
fi

git checkout -q -B "$branch" "$target"
applied=(); remaining=(); conflict=""; files=""
for c in "${commits[@]}"; do
  if [ -n "$conflict" ]; then remaining+=("$c"); continue; fi
  if git cherry-pick -x "$c" >/dev/null 2>&1; then
    applied+=("$c")
    continue
  fi
  files="$(git diff --name-only --diff-filter=U)"
  if [ -z "$files" ]; then
    # Empty after picking (its change is already in the target under a different patch): skip it.
    git cherry-pick --skip >/dev/null 2>&1 || git cherry-pick --abort
    continue
  fi
  conflict="$c"
  git cherry-pick --abort
done

# shellcheck disable=SC2016  # backticks are markdown
line() { git log -1 --format='- `%h` %s (%an)' "$1"; }
{
  echo "Forward-port of \`${label}\` into \`${target#origin/}\`, cherry-picked with \`-x\` in original order."
  echo
  if [ "${#applied[@]}" -gt 0 ]; then
    echo "**Applied cleanly (${#applied[@]}):**"
    for c in "${applied[@]}"; do line "$c"; done
    echo
  fi
  if [ -n "$conflict" ]; then
    echo "**Conflict** -- this PR is a draft until a human finishes it."
    echo
    echo "Stopped at:"
    line "$conflict"
    echo
    echo "Conflicting files:"
    while IFS= read -r f; do echo "- \`${f}\`"; done <<<"$files"
    echo
    if [ "${#remaining[@]}" -gt 0 ]; then
      echo "Not yet ported (${#remaining[@]}):"
      for c in "${remaining[@]}"; do line "$c"; done
      echo
    fi
    todo="${conflict:0:12}"
    for c in "${remaining[@]}"; do todo+=" ${c:0:12}"; done
    echo "To finish: \`git fetch && git checkout ${branch} && git cherry-pick -x ${todo}\`, resolve each conflict, push, then mark the PR ready."
  fi
} > "$body"

if [ -n "$conflict" ] && [ "${#applied[@]}" -eq 0 ]; then
  git commit -q --allow-empty -m "forward-port ${label}: blocked on a conflict, see the PR"
fi
if [ -n "$conflict" ]; then echo "status=conflict"; else echo "status=clean"; fi
echo "branch=${branch}"
echo "body=${body}"
