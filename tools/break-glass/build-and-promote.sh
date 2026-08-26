#!/usr/bin/env bash
#
# break-glass build-and-promote -- ship a seqtoid-web image dev -> staging -> prod
# WITHOUT GitHub Actions.
#
# ============================================================================
# WHAT THIS IS (and is not)
# ============================================================================
# This is the BREAK-GLASS path: use it ONLY when GitHub Actions is unavailable
# (org-wide outage) and an image still has to ship. In normal operation the CD
# workflows own this:
#   - build-docker-image.yml  : build + Trivy scan + cosign sign + push to dev ECR
#   - gitops-advance-dev.yml   : advance dev.yaml image.tag/digest (Argo deploys dev)
#   - promote-image.yml / promote-to-env.yml : skopeo copy dev->env ECR + pin the env values
#
# This script performs the SAME steps out-of-band from an engineer's laptop. It
# deliberately reuses the repo's own build entrypoint (bin/build-docker) and runs
# the identical Trivy + cosign gates -- it does NOT reimplement or weaken them.
# Argo CD (which is independent of GitHub Actions) still does the actual deploy
# from the git pin this script writes.
#
# It NEVER applies to a cluster and NEVER force-pushes a protected branch. Every
# GitOps write is a branch + PR against cypherid-web-infra; a human merges it.
#
# ============================================================================
# ENVIRONMENT / DELIVERY TOPOLOGY (verified against the Argo Application manifests)
# ============================================================================
#   env     values file    Argo cwi branch   AWS account     profile
#   ------  -------------  ----------------  --------------  --------------
#   dev     dev.yaml       main              491013321714    idseq-dev
#   staging staging.yaml   integration       030998640247    idseq-staging
#   prod    env-prod.yaml  main (PROTECTED)  283694049553    idseq-prod
#
# NOTE: the chart renders `repository@digest` whenever image.digest is set and
# IGNORES image.tag (deploy/charts/seqtoid-web/templates/_helpers.tpl). So this
# script always writes BOTH image.digest (load-bearing) and image.tag (readable).
# A tag-only bump would be a silent no-op on any digest-pinned env.
#
# "prod" here means the seqtoid overhaul prod env (env-prod.yaml / account
# 283694049553), NOT the legacy CZI prod.yaml (czid-prod namespace).
#
# ============================================================================
# SUBCOMMANDS
# ============================================================================
#   build                         Build amd64 from the current commit, push to DEV ECR
#                                 as sha-<commit8>, Trivy-scan, cosign-sign. Prints digest.
#   advance-dev                   Pin dev.yaml (digest+tag) to a dev-ECR image; branch+PR to cwi main.
#   promote --to staging|prod     skopeo copy dev-ECR -> target-account ECR (digest-verified),
#             --source sha-<8>    then pin the target env values (digest+tag); branch+PR to cwi.
#
# Global flags: --dry-run (on every subcommand), --help.
# Run `build-and-promote.sh <subcommand> --help` for per-subcommand flags.
#
# ============================================================================
# PREREQUISITES (see docs/runbooks/BREAK-GLASS-BUILD-DEPLOY.md)
# ============================================================================
#   docker (with buildx), skopeo, cosign, trivy, aws CLI v2, git, yq (v4), gh CLI.
#   AWS profiles idseq-dev / idseq-staging / idseq-prod configured for us-west-2.
#   A local checkout of cypherid-web-infra (pass --infra-dir, or set INFRA_DIR).
#
# NO secrets are hardcoded. Cross-account access uses the caller's own AWS
# profiles (the CI OIDC promote role is NOT assumable from a laptop).
#
set -euo pipefail

# ---- constants --------------------------------------------------------------
AWS_REGION="${AWS_REGION:-us-west-2}"
ECR_REPO_NAME="${ECR_REPO_NAME:-seqtoid-web}"   # go-forward repo the values pins reference (CZID-76)
DEV_ACCOUNT="491013321714"
DEV_PROFILE="${DEV_PROFILE:-idseq-dev}"
COSIGN_IDENTITY_HINT="keyless (Sigstore/Fulcio) -- opens a browser device flow to authenticate"

# Per-env delivery topology. Fields: values-file : cwi-branch : account : default-profile : protected
env_values_file() { case "$1" in
  dev)     echo "dev.yaml" ;;
  staging) echo "staging.yaml" ;;
  prod)    echo "env-prod.yaml" ;;
  *) return 1 ;; esac; }
env_cwi_branch() { case "$1" in
  dev)     echo "main" ;;
  staging) echo "integration" ;;
  prod)    echo "main" ;;
  *) return 1 ;; esac; }
env_account() { case "$1" in
  dev)     echo "491013321714" ;;
  staging) echo "030998640247" ;;
  prod)    echo "283694049553" ;;
  *) return 1 ;; esac; }
env_default_profile() { case "$1" in
  dev)     echo "idseq-dev" ;;
  staging) echo "idseq-staging" ;;
  prod)    echo "idseq-prod" ;;
  *) return 1 ;; esac; }
env_is_protected() { case "$1" in
  prod)    echo "yes" ;;   # cwi main is branch-protected -> PR only, human merge required
  *)       echo "no" ;; esac; }

# ---- logging helpers --------------------------------------------------------
say()  { echo "[break-glass] $*"; }
warn() { echo "[break-glass] WARNING: $*" >&2; }
die()  { echo "[break-glass] ERROR: $*" >&2; exit 1; }
run()  { # echo + execute a single command STRING, or just echo under --dry-run
  if [ "${DRY_RUN:-0}" = "1" ]; then echo "DRY-RUN + $*"; else echo "+ $*"; eval "$*"; fi; }

DRY_RUN=0

need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  # Under --dry-run nothing is actually executed, so a missing tool is only a warning
  # (lets an operator preview the plan on a not-yet-provisioned laptop). A real run dies.
  if [ "${DRY_RUN:-0}" = "1" ]; then warn "tool '$1' not found -- OK for --dry-run, but install it before a real run (see runbook)"; return 0; fi
  die "required tool '$1' not found on PATH (see the runbook prerequisites)"
}

# Resolve the seqtoid-web repo root (this script lives at tools/break-glass/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# aws wrapper bound to a profile
awsp() { local profile="$1"; shift; aws --profile "$profile" --region "$AWS_REGION" "$@"; }

# Assert the given profile authenticates to the expected account (fail-closed cross-account guard).
assert_account() {
  local profile="$1" expected="$2" who
  if [ "${DRY_RUN:-0}" = "1" ]; then
    say "DRY-RUN: skipping live account check for profile '$profile' (expected account $expected)"
    return 0
  fi
  who="$(awsp "$profile" sts get-caller-identity --query Account --output text 2>/dev/null || true)"
  [ -n "$who" ] || die "AWS profile '$profile' is not usable (sts get-caller-identity failed). Run 'aws sso login --profile $profile' or configure it."
  [ "$who" = "$expected" ] || die "AWS profile '$profile' authenticates to account $who, expected $expected. Wrong profile -- refusing to continue (fail-closed)."
  say "profile '$profile' -> account $who (OK)"
}

ecr_registry() { echo "$1.dkr.ecr.${AWS_REGION}.amazonaws.com"; }

# Resolve an immutable digest for repo:tag in a given account, using that account's profile.
# Uses `aws ecr describe-images` (no docker pull needed).
ecr_digest_for_tag() {
  local account="$1" profile="$2" tag="$3" d
  d="$(awsp "$profile" ecr describe-images \
        --registry-id "$account" --repository-name "$ECR_REPO_NAME" \
        --image-ids imageTag="$tag" \
        --query 'imageDetails[0].imageDigest' --output text 2>/dev/null || true)"
  [ -n "$d" ] && [ "$d" != "None" ] && echo "$d"
}

# ============================================================================
# SUBCOMMAND: build
# ============================================================================
cmd_build() {
  local cache_mode="read" repo_names="$ECR_REPO_NAME" trivy_advisory=0 profile="$DEV_PROFILE"
  while [ $# -gt 0 ]; do case "$1" in
    --dry-run)        DRY_RUN=1 ;;
    --cache-mode)     cache_mode="$2"; shift ;;
    --cache-mode=*)   cache_mode="${1#*=}" ;;
    --repo-names)     repo_names="$2"; shift ;;      # e.g. "idseq-web seqtoid-web" to reproduce the dual-push
    --repo-names=*)   repo_names="${1#*=}" ;;
    --profile)        profile="$2"; shift ;;
    --profile=*)      profile="${1#*=}" ;;
    --trivy-advisory) trivy_advisory=1 ;;            # match the CD-path advisory behavior (SMP-1638): warn, don't block
    --help|-h)        grep -E '^#( |$)' "$0" | sed 's/^# \{0,1\}//' | sed -n '1,60p'; return 0 ;;
    *) die "build: unknown flag '$1'" ;;
  esac; shift; done

  need docker; need aws; need git; need trivy; need cosign
  docker buildx version >/dev/null 2>&1 || die "docker buildx not available (see runbook prerequisites)"

  cd "$WEB_ROOT"
  # Build from the checked-out working tree: bin/build-docker derives SRC_HASH from the git
  # index, so tree + branch must agree. Require a clean tree so the sha-<commit8> tag is honest.
  [ -z "$(git status --porcelain)" ] || die "seqtoid-web working tree is dirty -- commit or stash first (the image is tagged sha-<commit>, which must match the tree)."
  local branch commit8
  branch="$(git rev-parse --abbrev-ref HEAD)"
  commit8="$(git rev-parse --short=8 HEAD)"
  local registry image_ref
  registry="$(ecr_registry "$DEV_ACCOUNT")"
  image_ref="${registry}/${ECR_REPO_NAME}:sha-${commit8}"

  say "build seqtoid-web @ ${branch} (${commit8})"
  say "  target dev ECR : ${registry}/${repo_names}"
  say "  image ref      : ${image_ref}"
  say "  cache mode     : ${cache_mode}   (default 'read' = feature build; do NOT use 'write' off main)"

  assert_account "$profile" "$DEV_ACCOUNT"

  # ECR login (dev account). bin/build-docker --push needs the daemon authed to the registry.
  say "ECR login -> ${registry}"
  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY-RUN + aws --profile $profile ecr get-login-password | docker login --username AWS --password-stdin $registry"
  else
    awsp "$profile" ecr get-login-password | docker login --username AWS --password-stdin "$registry" >/dev/null
  fi

  # Reuse the repo's own build entrypoint so break-glass and CI build byte-identically.
  # AWS_ACCOUNT_ID/AWS_REGION/ECR_REPO_NAMES/PLATFORMS/CACHE_MODE are the knobs bin/build-docker reads.
  say "build+push via bin/build-docker (this is the same script the CI build calls)"
  run "AWS_ACCOUNT_ID=$DEV_ACCOUNT AWS_REGION=$AWS_REGION ECR_REPO_NAMES='$repo_names' PLATFORMS='${PLATFORMS:-linux/amd64}' CACHE_MODE='$cache_mode' ./bin/build-docker '$branch' '$commit8'"

  # ---- GATE 1: Trivy image scan (HIGH,CRITICAL; ignore-unfixed; .trivyignore baseline) ----
  # Identical policy to build-docker-image.yml's scan. On the CD path the image scan is advisory
  # (continue-on-error, SMP-1638) because a Trivy DB refresh must not freeze dev; break-glass makes
  # it a HARD gate by default so a human sees the finding before shipping. --trivy-advisory restores
  # the CD advisory behavior (warn, continue) if you consciously accept it.
  say "GATE 1/2: Trivy scan ${image_ref} (HIGH,CRITICAL, ignore-unfixed, .trivyignore baseline)"
  local trivy_args=(image --severity "HIGH,CRITICAL" --ignore-unfixed --exit-code 1)
  [ -f "$WEB_ROOT/.trivyignore" ] && trivy_args+=(--ignorefile "$WEB_ROOT/.trivyignore")
  trivy_args+=("$image_ref")
  if [ "$DRY_RUN" = "1" ]; then
    echo "DRY-RUN + trivy ${trivy_args[*]}"
  else
    if trivy "${trivy_args[@]}"; then
      say "Trivy: clean (no new fixable HIGH/CRITICAL beyond .trivyignore baseline)"
    else
      if [ "$trivy_advisory" = "1" ]; then
        warn "Trivy found a new fixable HIGH/CRITICAL, but --trivy-advisory was set (matching the CD advisory path, SMP-1638). CONTINUING. Track + baseline it in .trivyignore."
      else
        die "Trivy gate FAILED: a new fixable HIGH/CRITICAL CVE is present that is not in .trivyignore. Forward-fix the dep or baseline it (with justification), then rebuild. (Override only with --trivy-advisory, and only if you understand the risk.)"
      fi
    fi
  fi

  # Resolve the immutable digest of what we just pushed.
  local digest
  if [ "$DRY_RUN" = "1" ]; then
    digest="sha256:0000000000000000000000000000000000000000000000000000000000000000"
    echo "DRY-RUN + docker buildx imagetools inspect --format '{{json .Manifest.Digest}}' $image_ref"
  else
    digest="$(docker buildx imagetools inspect --format '{{ json .Manifest.Digest }}' "$image_ref" | tr -d '"')"
    [ -n "$digest" ] || die "could not resolve the pushed image digest for $image_ref"
  fi

  # ---- GATE 2: cosign sign --recursive (keyless), same as build-docker-image.yml ----
  say "GATE 2/2: cosign sign --recursive (keyless) ${ECR_REPO_NAME}@${digest}"
  say "  cosign identity: ${COSIGN_IDENTITY_HINT}"
  run "COSIGN_YES=true cosign sign --recursive '${registry}/${ECR_REPO_NAME}@${digest}'"

  echo
  say "BUILD COMPLETE"
  say "  tag    : sha-${commit8}"
  say "  digest : ${digest}"
  say "  ref    : ${registry}/${ECR_REPO_NAME}@${digest}"
  say "Next: ./tools/break-glass/build-and-promote.sh advance-dev --source sha-${commit8} --infra-dir <cwi>"
}

# ============================================================================
# SUBCOMMAND: advance-dev
# ============================================================================
cmd_advance_dev() {
  local source_tag="" infra_dir="${INFRA_DIR:-}" profile="$DEV_PROFILE" do_merge=0
  while [ $# -gt 0 ]; do case "$1" in
    --dry-run)     DRY_RUN=1 ;;
    --source)      source_tag="$2"; shift ;;
    --source=*)    source_tag="${1#*=}" ;;
    --infra-dir)   infra_dir="$2"; shift ;;
    --infra-dir=*) infra_dir="${1#*=}" ;;
    --profile)     profile="$2"; shift ;;
    --profile=*)   profile="${1#*=}" ;;
    --merge)       do_merge=1 ;;      # dev is low-risk: optionally gh pr merge --squash after opening
    --help|-h)     echo "advance-dev --source sha-<8> --infra-dir <cwi> [--merge] [--dry-run]"; return 0 ;;
    *) die "advance-dev: unknown flag '$1'" ;;
  esac; shift; done

  # Default source = the current web checkout's commit.
  if [ -z "$source_tag" ]; then
    source_tag="sha-$(cd "$WEB_ROOT" && git rev-parse --short=8 HEAD)"
    say "no --source given; defaulting to current web commit: $source_tag"
  fi
  [ -n "$infra_dir" ] || die "advance-dev needs --infra-dir <path-to-cypherid-web-infra> (or set INFRA_DIR)"
  advance_env "dev" "$source_tag" "$infra_dir" "$profile" "$do_merge"
}

# ============================================================================
# SUBCOMMAND: promote
# ============================================================================
cmd_promote() {
  local to="" source_tag="" infra_dir="${INFRA_DIR:-}" src_profile="$DEV_PROFILE" dst_profile="" do_merge=0
  while [ $# -gt 0 ]; do case "$1" in
    --dry-run)      DRY_RUN=1 ;;
    --to)           to="$2"; shift ;;
    --to=*)         to="${1#*=}" ;;
    --source)       source_tag="$2"; shift ;;
    --source=*)     source_tag="${1#*=}" ;;
    --infra-dir)    infra_dir="$2"; shift ;;
    --infra-dir=*)  infra_dir="${1#*=}" ;;
    --src-profile)  src_profile="$2"; shift ;;   # dev-account read (default idseq-dev)
    --src-profile=*) src_profile="${1#*=}" ;;
    --dst-profile)  dst_profile="$2"; shift ;;   # target-account write (default idseq-<env>)
    --dst-profile=*) dst_profile="${1#*=}" ;;
    --merge)        do_merge=1 ;;
    --help|-h)      echo "promote --to staging|prod --source sha-<8> --infra-dir <cwi> [--src-profile p] [--dst-profile p] [--merge] [--dry-run]"; return 0 ;;
    *) die "promote: unknown flag '$1'" ;;
  esac; shift; done

  [ -n "$to" ] || die "promote needs --to staging|prod"
  case "$to" in staging|prod) : ;; *) die "promote --to must be 'staging' or 'prod' (got '$to'); dev uses advance-dev";; esac
  [ -n "$source_tag" ] || die "promote needs --source sha-<8> (the dev-ECR image to promote)"
  [ -n "$infra_dir" ] || die "promote needs --infra-dir <path-to-cypherid-web-infra> (or set INFRA_DIR)"
  [ -n "$dst_profile" ] || dst_profile="$(env_default_profile "$to")"

  need aws; need skopeo; need git; need yq
  local dst_account
  dst_account="$(env_account "$to")"

  say "promote ${source_tag}: dev(${DEV_ACCOUNT}) -> ${to}(${dst_account})"
  # Fail-closed cross-account guards.
  assert_account "$src_profile" "$DEV_ACCOUNT"
  assert_account "$dst_profile" "$dst_account"

  # ---- resolve the exact source digest from dev ECR --------------------------
  local src_digest
  if [ "$DRY_RUN" = "1" ]; then
    src_digest="sha256:1111111111111111111111111111111111111111111111111111111111111111"
    say "DRY-RUN: would resolve digest of dev ${ECR_REPO_NAME}:${source_tag}"
  else
    src_digest="$(ecr_digest_for_tag "$DEV_ACCOUNT" "$src_profile" "$source_tag")"
    [ -n "$src_digest" ] || die "source image dev ${ECR_REPO_NAME}:${source_tag} not found in dev ECR (build it first, or check the tag)"
  fi
  say "source digest: ${src_digest}"

  # ---- skopeo copy dev ECR -> target-account ECR (digest-preserving, --all) --
  # Mirrors promote-to-env.yml / promote-to-staging.sh: mint one ECR token per account
  # (get-login-password is scoped to the creds' account -- NO --registry-id), hand both
  # to skopeo. Copy is idempotent: if the digest already exists in the target, skip.
  local src_ecr dst_ecr
  src_ecr="$(ecr_registry "$DEV_ACCOUNT")"
  dst_ecr="$(ecr_registry "$dst_account")"

  local already=""
  if [ "$DRY_RUN" != "1" ]; then
    already="$(ecr_digest_for_tag "$dst_account" "$dst_profile" "$source_tag" || true)"
  fi
  if [ -n "$already" ] && [ "$already" = "$src_digest" ]; then
    say "target ${to} ECR already has ${source_tag} at ${src_digest} -- skipping copy (idempotent)"
  else
    say "skopeo copy --all  docker://${src_ecr}/${ECR_REPO_NAME}@${src_digest}  ->  docker://${dst_ecr}/${ECR_REPO_NAME}:${source_tag}"
    # Ensure the destination repo exists (idempotent).
    if [ "$DRY_RUN" = "1" ]; then
      echo "DRY-RUN + aws --profile $dst_profile ecr describe-repositories --repository-names $ECR_REPO_NAME (create if missing)"
      echo "DRY-RUN + skopeo copy --all --src-creds AWS:<dev-token> --dest-creds AWS:<${to}-token> docker://${src_ecr}/${ECR_REPO_NAME}@${src_digest} docker://${dst_ecr}/${ECR_REPO_NAME}:${source_tag}"
    else
      awsp "$dst_profile" ecr describe-repositories --repository-names "$ECR_REPO_NAME" >/dev/null 2>&1 \
        || awsp "$dst_profile" ecr create-repository --repository-name "$ECR_REPO_NAME" \
             --image-tag-mutability IMMUTABLE --image-scanning-configuration scanOnPush=true >/dev/null \
        || die "could not create/verify destination ECR repo ${ECR_REPO_NAME} in ${to}"
      local src_pass dst_pass
      src_pass="$(awsp "$src_profile" ecr get-login-password)"
      dst_pass="$(awsp "$dst_profile" ecr get-login-password)"
      # Copy by digest (source) and land BOTH the sha tag and the digest in the target.
      skopeo copy --all \
        --src-creds "AWS:${src_pass}" \
        --dest-creds "AWS:${dst_pass}" \
        "docker://${src_ecr}/${ECR_REPO_NAME}@${src_digest}" \
        "docker://${dst_ecr}/${ECR_REPO_NAME}:${source_tag}" \
        || die "skopeo copy failed"
    fi
  fi

  # ---- verify the digest survived the copy (fail-closed before pinning) ------
  local dst_digest
  if [ "$DRY_RUN" = "1" ]; then
    dst_digest="$src_digest"
    say "DRY-RUN: would verify target digest == source digest"
  else
    dst_digest="$(ecr_digest_for_tag "$dst_account" "$dst_profile" "$source_tag")"
    [ -n "$dst_digest" ] || die "post-copy: could not read the target digest for ${to} ${ECR_REPO_NAME}:${source_tag}"
    [ "$dst_digest" = "$src_digest" ] || die "DIGEST MISMATCH after copy (${dst_digest} != ${src_digest}). Refusing to pin an unverified image."
  fi
  say "digest verified in ${to} ECR: ${dst_digest}"

  # ---- pin the env values (digest + tag) + branch/PR ------------------------
  advance_env "$to" "$source_tag" "$infra_dir" "$dst_profile" "$do_merge" "$dst_digest"
}

# ============================================================================
# Shared: write the pin into the env values file and open a branch + PR.
#   $1 env  $2 sha-tag  $3 infra_dir  $4 profile(for digest lookup if needed)  $5 do_merge  [$6 digest]
# ============================================================================
advance_env() {
  local env="$1" sha_tag="$2" infra_dir="$3" profile="$4" do_merge="$5" digest="${6:-}"
  need git; need yq; need gh

  local values_file cwi_branch account protected
  values_file="$(env_values_file "$env")" || die "unknown env '$env'"
  cwi_branch="$(env_cwi_branch "$env")"
  account="$(env_account "$env")"
  protected="$(env_is_protected "$env")"

  [ -d "$infra_dir/.git" ] || die "--infra-dir '$infra_dir' is not a git checkout of cypherid-web-infra"
  local rel="deploy/argocd/values/seqtoid-web/${values_file}"
  [ -f "$infra_dir/$rel" ] || die "values file not found: $infra_dir/$rel"

  # For dev (no skopeo step) resolve the digest now, from the env's own account.
  if [ -z "$digest" ]; then
    if [ "$DRY_RUN" = "1" ]; then
      digest="sha256:2222222222222222222222222222222222222222222222222222222222222222"
    else
      digest="$(ecr_digest_for_tag "$account" "$profile" "$sha_tag")" \
        || die "could not resolve digest for ${env} ${ECR_REPO_NAME}:${sha_tag} (build/copy it first)"
    fi
  fi

  say "pin ${env}: ${rel}  ->  tag=${sha_tag}  digest=${digest}"
  local protnote=""
  [ "$protected" = "yes" ] && protnote="  (branch-protected: PR only, human merge)"
  say "  Argo tracks cwi branch: ${cwi_branch}${protnote}"

  # Refresh the infra checkout's view of the tracked branch, branch off it.
  local short="${digest#sha256:}"; short="${short:0:12}"
  local work_branch="breakglass/pin-${env}-${short}"

  (
    cd "$infra_dir"
    run "git fetch origin '$cwi_branch'"
    run "git checkout -B '$work_branch' 'origin/${cwi_branch}'"
    # Idempotency: is it already pinned to this digest?
    local cur
    if [ "$DRY_RUN" != "1" ]; then
      cur="$(yq '.image.digest // ""' "$rel")"
      if [ "$cur" = "$digest" ]; then
        say "${env} already pinned to ${digest} -- nothing to do."
        return 0
      fi
    fi
    run "yq -i '.image.digest = \"$digest\"' '$rel'"
    run "yq -i '.image.tag = \"$sha_tag\"' '$rel'"
    # Commit as thorvath-slower (repo doctrine), no hooks, ASCII-only message.
    run "git -c user.name='thorvath-slower' -c user.email='thomash@slower.ai' commit --no-verify -m 'gitops(${env}): pin seqtoid-web -> ${sha_tag} (${digest})' -- '$rel'"
    run "git push --force-with-lease -u origin '$work_branch'"

    # Open the PR. base = the branch Argo tracks for this env.
    local title body
    title="break-glass gitops(${env}): pin seqtoid-web -> ${sha_tag}"
    body="Out-of-band (GitHub Actions down) digest pin of the exact built+scanned+signed artifact.

- env: ${env}   (Argo tracks cwi \`${cwi_branch}\`)
- image tag: \`${sha_tag}\`
- digest: \`${digest}\`
- account: ${account}

Built via tools/break-glass/build-and-promote.sh (Trivy + cosign gates run, image copied+digest-verified). Merging this pin lets Argo CD sync ${env}."
    if [ "$protected" = "yes" ]; then
      body="${body}

NOTE: cwi \`${cwi_branch}\` is BRANCH-PROTECTED. This PR requires a human approval + merge; it will NOT auto-merge. After merge, Argo syncs and (env-prod blueGreen.autoPromotionEnabled=false) the rollout PAUSES for a manual \`kubectl argo rollouts promote\` -- see the runbook."
    fi
    run "gh pr create --repo IT-Academic-Research-Services/cypherid-web-infra --base '$cwi_branch' --head '$work_branch' --title '$title' --body \"\$(printf '%s' \"$body\")\" || echo 'PR may already exist for $work_branch'"

    if [ "$do_merge" = "1" ]; then
      if [ "$protected" = "yes" ]; then
        warn "--merge ignored for ${env}: cwi ${cwi_branch} is protected; a human must approve+merge."
      else
        run "gh pr merge --repo IT-Academic-Research-Services/cypherid-web-infra --squash --delete-branch '$work_branch'"
      fi
    fi
  )
  say "${env} pin PR prepared. After merge, Argo CD syncs. Hard-refresh + rollout checks: see the runbook."
}

# ============================================================================
# dispatch
# ============================================================================
usage() {
  sed -n '2,60p' "$0" | sed 's/^#\{0,1\} \{0,1\}//'
}
main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    build)        cmd_build "$@" ;;
    advance-dev)  cmd_advance_dev "$@" ;;
    promote)      cmd_promote "$@" ;;
    ""|--help|-h|help) usage ;;
    *) die "unknown subcommand '$sub' (expected: build | advance-dev | promote). Try --help." ;;
  esac
}
main "$@"
