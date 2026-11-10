#!/usr/bin/env bash
# Reads `bin/release rc show --json` output (seqtoid-gitops) and prints key=value lines for
# $GITHUB_OUTPUT describing the release candidate the battery should test.
#
#   rc-context.sh <rc-show.json> [<wanted-rc-id>]
#
# run=true only when the RC is in state `vetting` (and, if an id was asked for, it is that RC).
# Field names are read with fallbacks because the record format is owned by seqtoid-gitops:
#   id      .id | .rc_id | .rc
#   state   .state | .status
#   digest  .digest | .image.digest              (sha256:<64 hex>)
#   tag     .tag | .image.tag                    (sha-<commit>)
#   commit  .chart_sha | .commit | .git_sha | .source_sha | .sha, else derived from the sha-<commit> tag
#   cut_at  .cut_at | .created_at | .started_at  (ISO-8601 UTC)
#   repo    .image.repository | .repository      (optional; the caller falls back to dev's ECR)
# A vetting RC missing digest, commit or cut_at is an error: the battery cannot test it honestly.
set -euo pipefail

json="${1:?usage: rc-context.sh <rc-show.json> [<wanted-rc-id>]}"
want="${2:-}"

q() { jq -r "($1) // empty" "$json"; }
id="$(q '.id // .rc_id // .rc')"
state="$(q '.state // .status')"
digest="$(q '.digest // .image.digest')"
tag="$(q '.tag // .image.tag')"
commit="$(q '.chart_sha // .commit // .git_sha // .source_sha // .sha')"
cut_at="$(q '.cut_at // .created_at // .started_at')"
repo="$(q '.image.repository // .repository')"
if [ -z "$commit" ] && [[ "$tag" =~ ^sha-([0-9a-f]{7,40})$ ]]; then
  commit="${BASH_REMATCH[1]}"
fi

emit_skip() {
  echo "run=false"
  echo "reason=$1"
  exit 0
}

[ -n "$id" ] || emit_skip "no release candidate recorded"
if [ -n "$want" ] && [ "$id" != "$want" ]; then
  emit_skip "latest RC is ${id}, not ${want}"
fi
[ "$state" = "vetting" ] || emit_skip "RC ${id} is in state '${state:-unknown}', not vetting"

missing=()
[[ "$digest" =~ ^sha256:[0-9a-f]{64}$ ]] || missing+=("digest")
[[ "$commit" =~ ^[0-9a-f]{7,40}$ ]] || missing+=("commit")
[[ "$cut_at" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}T ]] || missing+=("cut_at")
if [ "${#missing[@]}" -gt 0 ]; then
  echo "::error::RC ${id} is vetting but its record lacks: ${missing[*]}" >&2
  exit 1
fi

echo "run=true"
echo "rc_id=${id}"
echo "digest=${digest}"
echo "tag=${tag}"
echo "commit=${commit}"
echo "cut_at=${cut_at}"
echo "repository=${repo}"
