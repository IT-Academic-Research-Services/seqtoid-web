#!/usr/bin/env bash
#
# verify-bundle.sh — assert the compiled frontend bundles are what the current
# source SHOULD produce, so a stale Docker asset-layer cache (the `npm run
# build-img` layer) or a stale CDN copy can't silently ship an old bundle.
#
# Two staleness points, one set of assertions:
#   bin/verify-bundle.sh --image <image-ref>            # PRE-PUSH gate (check the artifact before it ships)
#   bin/verify-bundle.sh --url   https://dev.seqtoid.org  # POST-DEPLOY check (check what the CDN actually serves)
#
# Exit code 0 = all assertions passed; non-zero = a marker is missing/forbidden,
# so callers can gate `docker push` / `bin/deploy` on it.
#
# Maintaining assertions: add a line to the ASSERTIONS block below whenever a fix
# or feature must be provably present (MUST) or provably gone (MUST_NOT) in the
# shipped bundle. Patterns are extended regex (ERE) and run against the minified
# bundle, so match on stable, minifier-proof anchors (object keys the SDK reads by
# name, class declarations, literal class/method names) — not on local variable
# names, which get renamed by minification.
#
set -uo pipefail

mode=""; target=""
case "${1:-}" in
  --image) mode=image; target="${2:?--image needs an image ref}" ;;
  --url)   mode=url;   target="${2:?--url needs a base url}" ;;
  *) echo "usage: $0 --image <image-ref> | --url <base-url>" >&2; exit 2 ;;
esac

work=$(mktemp -d); trap 'rm -rf "$work"' EXIT

# Pull the two webpack bundles (application + vendors) into $work/app.js + $work/vendors.js.
fetch_image() {
  docker run --rm --entrypoint sh "$target" \
    -c 'cat app/assets/dist/main.bundle.min.js'    > "$work/app.js"     2>/dev/null
  docker run --rm --entrypoint sh "$target" \
    -c 'cat app/assets/dist/vendors.bundle.min.js' > "$work/vendors.js" 2>/dev/null
}

fetch_url() {
  local html appf venf host
  html=$(curl -fsS --max-time 30 "$target") || { echo "ERROR: cannot fetch $target" >&2; exit 3; }
  appf=$(printf '%s' "$html" | grep -oE 'assets/application\.debug-[a-f0-9]+\.js' | head -1)
  venf=$(printf '%s' "$html" | grep -oE 'assets/vendors\.debug-[a-f0-9]+\.js'     | head -1)
  host=$(printf '%s' "$html" | grep -oE 'https://assets\.[a-z.]*seqtoid\.org'     | head -1)
  [ -n "$appf" ] && [ -n "$venf" ] && [ -n "$host" ] || {
    echo "ERROR: could not find application/vendors bundle refs in the served HTML" >&2; exit 3; }
  echo "  serving app:     ${appf##*/}"
  echo "  serving vendors: ${venf##*/}"
  curl -fsS --max-time 90 "$host/$appf" > "$work/app.js"
  curl -fsS --max-time 90 "$host/$venf" > "$work/vendors.js"
}

echo "Verifying bundles ($mode): $target"
if [ "$mode" = image ]; then fetch_image; else fetch_url; fi
[ -s "$work/app.js" ] && [ -s "$work/vendors.js" ] || {
  echo "ERROR: one or both bundles came back empty — wrong image/url or build is broken." >&2; exit 3; }

fail=0
# assert <role:app|vendors> <MUST|MUST_NOT> <ERE-pattern> <human description>
assert() {
  local role="$1" want="$2" pat="$3" desc="$4" n
  n=$(grep -Ec -- "$pat" "$work/$role.js" 2>/dev/null || true); n=${n:-0}
  if { [ "$want" = MUST ] && [ "$n" -gt 0 ]; } || { [ "$want" = MUST_NOT ] && [ "$n" -eq 0 ]; }; then
    printf "  \033[32mPASS\033[0m  [%-7s] %s\n" "$role" "$desc"
  else
    printf "  \033[31mFAIL\033[0m  [%-7s] %s\n           want=%s  pattern=/%s/  hits=%s\n" \
      "$role" "$desc" "$want" "$pat" "$n"
    fail=1
  fi
}

# ===================== ASSERTIONS (the bundle contract) =====================
# Upload fix — stock AWS SDK + app-owned resumable uploader, no ES5 fork.
assert app     MUST     'expiration:[A-Za-z0-9_$]+\?new Date\(' "STS credential expiration converted to Date (AWS SDK v3 requires it)"
# NOTE: `toBytes` is async, so babel transpiles `new Uint8Array(await blob.arrayBuffer())` into a
# regenerator state machine (`X=Uint8Array, ...next..., Y.arrayBuffer()`) — match THAT, not source.
assert app     MUST     'Uint8Array,[A-Za-z0-9_$]+\.next'       "upload parts read into memory bytes (avoids aws-chunked .getReader() on a Blob)"
assert app     MUST     'ResumableUpload'                       "app-owned ResumableUpload present (replaces the vendored lib-storage fork)"
assert app     MUST     'onCreatedMultipartUpload'              "resumable-upload resume hook present"
assert vendors MUST     'class S3Client extends'                "native ES6 S3Client from stock @aws-sdk/client-s3"
assert vendors MUST_NOT 'S3Client,_super'                       "no ES5-fork class inheritance (the original 'Class constructor Client...' crash)"
# Add new assertions here as fixes/features land.
# ============================================================================

if [ "$fail" -ne 0 ]; then
  echo "RESULT: FAILED — the bundle does NOT match the expected contract. Do NOT push/deploy."
  exit 1
fi
echo "RESULT: PASSED — bundle matches the expected contract."
