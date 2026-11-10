#!/usr/bin/env bash
# error_budget leg of the RC battery: has dev, running the RC, stayed inside its error budget since
# the RC was cut? Prints `status=pass|fail` and `reason=...` (for $GITHUB_OUTPUT); details go to
# stderr. Never exits non-zero for a budget breach -- the caller records the result.
#
# 1. Sentry: issue groups FIRST SEEN since the cut, at or above MIN_LEVEL, with at least MIN_EVENTS
#    events, across SENTRY_PROJECTS (the dev projects). More than MAX_NEW_ISSUES of them -> fail.
# 2. 5xx rate: (HTTPCode_Target_5XX_Count + HTTPCode_ELB_5XX_Count) / RequestCount on dev's ALB
#    (AWS/ApplicationELB, dimension LoadBalancer=ALB_LB) since the cut. Above MAX_5XX_RATE -> fail.
#
# Missing configuration is a FAIL ("not configured: ..."), never a skip: an RC must not go green on
# a check that did not run.
#
# env: CUT_AT SENTRY_URL SENTRY_ORG SENTRY_PROJECTS(comma) SENTRY_TOKEN MIN_LEVEL MIN_EVENTS
#      MAX_NEW_ISSUES ALB_LB MAX_5XX_RATE AWS_REGION
#      FIXTURE_DIR  tests only: read sentry-<project>.json / cw-<metric>.json instead of calling out
set -uo pipefail

: "${CUT_AT:?CUT_AT is required}"
SENTRY_URL="${SENTRY_URL:-https://sentry.io}"
MIN_LEVEL="${MIN_LEVEL:-error}"
MIN_EVENTS="${MIN_EVENTS:-1}"
MAX_NEW_ISSUES="${MAX_NEW_ISSUES:-0}"
MAX_5XX_RATE="${MAX_5XX_RATE:-0.01}"
FIXTURE_DIR="${FIXTURE_DIR:-}"

fails=()
log() { echo "$*" >&2; }

cut_epoch="$(jq -rn --arg t "$CUT_AT" '$t | sub("\\.[0-9]+"; "") | sub("\\+00:00$"; "Z") | fromdateiso8601' 2>/dev/null)" \
  || { echo "status=fail"; echo "reason=cannot parse RC cut time '${CUT_AT}'"; exit 0; }
now_epoch="$(date -u +%s)"
start_iso="$(jq -rn --argjson e "$cut_epoch" '$e | todateiso8601')"
end_iso="$(jq -rn --argjson e "$now_epoch" '$e | todateiso8601')"

# ---- 1. Sentry new issue groups -------------------------------------------------------------
levels="$(jq -rn --arg m "$MIN_LEVEL" '["debug","info","warning","error","fatal"] as $l
  | ($l | index($m)) as $i | if $i == null then empty else $l[$i:] | join(",") end')"
if [ -z "$levels" ]; then
  fails+=("bad MIN_LEVEL '${MIN_LEVEL}'")
elif [ -z "${SENTRY_ORG:-}" ] || [ -z "${SENTRY_PROJECTS:-}" ] || { [ -z "${SENTRY_TOKEN:-}" ] && [ -z "$FIXTURE_DIR" ]; }; then
  fails+=("not configured: Sentry (need SENTRY_ORG, RC_SENTRY_PROJECTS and a token with event:read)")
else
  query="is:unresolved firstSeen:>=${start_iso} level:[${levels}]"
  new_total=0
  IFS=',' read -r -a projects <<<"$SENTRY_PROJECTS"
  for p in "${projects[@]}"; do
    p="$(echo "$p" | tr -d '[:space:]')"; [ -n "$p" ] || continue
    body="$(mktemp)"
    if [ -n "$FIXTURE_DIR" ]; then
      cp "${FIXTURE_DIR}/sentry-${p}.json" "$body" 2>/dev/null && code=200 || code=404
    else
      url="${SENTRY_URL%/}/api/0/projects/${SENTRY_ORG}/${p}/issues/?limit=100&query=$(jq -rn --arg q "$query" '$q|@uri')&start=$(jq -rn --arg s "$start_iso" '$s|@uri')&end=$(jq -rn --arg s "$end_iso" '$s|@uri')"
      code="$(curl -sS -o "$body" -w '%{http_code}' --max-time 30 -H "Authorization: Bearer ${SENTRY_TOKEN}" "$url" || echo 000)"
    fi
    case "$code" in
      200) ;;
      401|403) fails+=("not configured: Sentry token cannot read issues in ${p} (HTTP ${code}; needs event:read)"); continue ;;
      *) fails+=("Sentry query for ${p} failed (HTTP ${code})"); continue ;;
    esac
    hits="$(jq --argjson min "$MIN_EVENTS" '[.[] | select((.count | tonumber) >= $min)]' "$body")"
    n="$(jq 'length' <<<"$hits")"
    new_total=$(( new_total + n ))
    log "Sentry ${p}: ${n} new issue group(s) since ${start_iso} at level>=${MIN_LEVEL} with >=${MIN_EVENTS} event(s)"
    jq -r '.[] | "  - [\(.level)] \(.count)x \(.title) \(.permalink // "")"' <<<"$hits" >&2
  done
  if [ "$new_total" -gt "$MAX_NEW_ISSUES" ]; then
    fails+=("${new_total} new Sentry issue group(s) since the cut (budget ${MAX_NEW_ISSUES})")
  fi
fi

# ---- 2. dev 5xx rate ------------------------------------------------------------------------
cw_sum() {
  if [ -n "$FIXTURE_DIR" ]; then
    jq '[.Datapoints[].Sum] | add // 0' "${FIXTURE_DIR}/cw-$1.json"
    return
  fi
  local span=$(( now_epoch - cut_epoch )) period
  period=$(( (span / 1440 / 60 + 1) * 60 ))
  aws cloudwatch get-metric-statistics --region "${AWS_REGION:-us-west-2}" \
    --namespace AWS/ApplicationELB --metric-name "$1" \
    --dimensions "Name=LoadBalancer,Value=${ALB_LB}" \
    --start-time "$start_iso" --end-time "$end_iso" --period "$period" --statistics Sum \
    --output json | jq '[.Datapoints[].Sum] | add // 0'
}
if [ -z "${ALB_LB:-}" ]; then
  fails+=("not configured: 5xx rate (need RC_DEV_ALB_LB, the dev ALB's LoadBalancer dimension, and RC_METRICS_ROLE)")
elif ! t5="$(cw_sum HTTPCode_Target_5XX_Count)" || ! e5="$(cw_sum HTTPCode_ELB_5XX_Count)" || ! req="$(cw_sum RequestCount)"; then
  fails+=("CloudWatch query for the dev ALB failed")
else
  verdict="$(jq -rn --argjson t "$t5" --argjson e "$e5" --argjson r "$req" --argjson max "$MAX_5XX_RATE" '
    if $r == 0 then "none" else (($t + $e) / $r) as $x | "\($x) \(if $x > $max then "over" else "ok" end)" end')"
  log "dev 5xx since cut: target=${t5} elb=${e5} requests=${req} -> ${verdict}"
  case "$verdict" in
    none) fails+=("no requests reached dev's ALB since the cut; 5xx rate is unmeasured") ;;
    *over) fails+=("dev 5xx rate ${verdict% *} above ${MAX_5XX_RATE}") ;;
  esac
fi

if [ "${#fails[@]}" -eq 0 ]; then
  echo "status=pass"
  echo "reason=no new Sentry issues over budget; 5xx within ${MAX_5XX_RATE}"
else
  echo "status=fail"
  joined="$(printf '%s; ' "${fails[@]}")"
  echo "reason=${joined%; }"
fi
