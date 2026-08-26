# Runbook: CodeBuild standby image build (GitHub-independent break-glass)

## What this is

`seqtoid-web-standby-build` is an AWS CodeBuild project in the **dev account
(491013321714), us-west-2** that builds, scans, signs, and pushes the seqtoid-web
image to dev ECR **entirely in-account** -- no GitHub Actions runners involved. It
exists so a full `github.com` / Actions outage never blocks a build (and therefore
never blocks a dev deploy, which is gated on the Actions build succeeding).

It runs the SAME steps as `.github/workflows/build-docker-image.yml`, reusing
`bin/build-docker` verbatim, so the produced image is **identical** to the
Actions-built one: same `sha-<commit8>` + SemVer tags, same build cache repo, same
digest semantics. Gate parity is enforced: **Trivy** (HIGH,CRITICAL, ignore-unfixed,
`.trivyignore`) then **cosign sign**.

- Buildspec: `buildspec.yml` (this repo).
- Terraform: `cypherid-web-infra` ->
  `terraform/envs/dev/access-management/codebuild-standby-build.tf`.
- Trigger: **MANUAL only. No webhook, no auto-trigger.**
- Cost: CodeBuild is **pay-per-build -- zero idle cost**. The only standing cost is the
  cosign KMS signing key (~$1/month).

## Prerequisites (one-time, done out of band)

1. **Terraform applied.** The project + service role + cosign KMS key are authored but
   NOT applied. Apply the `dev/access-management` component (via the normal tf-apply
   channel, or break-glass with admin creds -- note that standing this up itself needs
   Actions or break-glass, since it is what you are trying to make independent).
2. **GitHub source credential** (for the common "Actions down, github.com up" case, where
   CodeBuild still clones from GitHub):
   ```
   aws codebuild import-source-credentials --server-type GITHUB \
     --auth-type PERSONAL_ACCESS_TOKEN --token <read-only PAT> --region us-west-2
   ```
   or wire a CodeStar Connections connection. This is an account/region-level credential,
   set once.
3. **Verify-side trust for the standby cosign key.** The standby signs with an in-account
   KMS key, NOT the keyless Fulcio identity the Actions build uses. Before a standby-built
   image can pass the cluster "signed images only" admission policy (#77), that policy must
   ALSO accept this key's public key as a trusted signer:
   ```
   cosign public-key --key awskms:///alias/seqtoid-web-standby-build-cosign
   ```
   Add the printed public key to the admission/verification policy as an additional signer.
   (Do this once, ahead of time, so break-glass is actually ready.)

## Kick a build

Build a specific commit (recommended -- deterministic, and it will NOT move the `latest`
tag):

```
aws codebuild start-build \
  --project-name seqtoid-web-standby-build \
  --source-version <full-or-short-commit-sha> \
  --region us-west-2
```

`--source-version` also accepts a branch or tag. Passing `main` (or any ref whose
basename is `main`) WILL move the `latest` tag, exactly as the Actions main build does --
so pass a commit SHA unless you specifically intend to rebuild main.

Break-glass Trivy bypass (ONLY if a genuinely new, non-baselined HIGH/CRITICAL is blocking
an emergency build and you have accepted the risk):

```
aws codebuild start-build \
  --project-name seqtoid-web-standby-build \
  --source-version <sha> \
  --environment-variables-override name=TRIVY_EXIT_CODE,value=0,type=PLAINTEXT \
  --region us-west-2
```

## Watch it

```
# Grab the build id printed by start-build, then tail its log group:
aws logs tail /aws/codebuild/seqtoid-web-standby-build --follow --region us-west-2

# Or poll build status:
aws codebuild batch-get-builds --ids <build-id> --region us-west-2 \
  --query 'builds[0].{phase:currentPhase,status:buildStatus}'
```

## Get the digest

The final log lines emit the handoff block:

```
==================== STANDBY BUILD RESULT ====================
IMAGE_TAG=sha-<commit8>
IMAGE_REF=491013321714.dkr.ecr.us-west-2.amazonaws.com/idseq-web:sha-<commit8>
IMAGE_DIGEST=sha256:...
PINNED_REF=491013321714.dkr.ecr.us-west-2.amazonaws.com/idseq-web@sha256:...
=============================================================
```

You can also confirm the pushed image directly:

```
aws ecr describe-images --repository-name idseq-web \
  --image-ids imageTag=sha-<commit8> --region us-west-2 \
  --query 'imageDetails[0].imageDigest'
```

## Hand off to promote / deploy (SEPARATE step -- Actions-independent)

The standby only BUILDS. Promotion + deploy is a distinct break-glass step; Argo CD is
already independent of Actions, so it keeps working during a GitHub outage.

**Deploy to dev** (image is already in dev ECR): pin the dev GitOps value and let Argo
(dev, autoPromotionEnabled) sync it.

- Repo: `cypherid-web-infra`, file `deploy/argocd/values/seqtoid-web/dev.yaml`.
- Set `image.tag: sha-<commit8>` (the chart renders `{{ .repository }}:{{ .tag }}`
  verbatim, so it must be the full `sha-<8>` tag the standby pushed).
- Commit/PR that change as usual (or hand-apply the values if the GitOps PR path is also
  Actions-blocked, then let selfHeal reconcile once Actions returns).

**Promote to staging / prod**: skopeo-copy the exact digest cross-account into the target
ECR, then pin that env's values:

```
skopeo copy --all \
  docker://491013321714.dkr.ecr.us-west-2.amazonaws.com/idseq-web@sha256:<digest> \
  docker://<target-acct>.dkr.ecr.us-west-2.amazonaws.com/idseq-web:sha-<commit8>
```

Then pin `deploy/argocd/values/seqtoid-web/<env>.yaml` `image.tag` and let Argo sync.
(Verify the target env's admission policy trusts the standby cosign key -- see
Prerequisite 3.)

## Gate parity & cost -- confirmation

- **Trivy**: same policy as the Actions build (HIGH,CRITICAL, ignore-unfixed,
  `.trivyignore`). The standby ENFORCES it as a hard gate (`TRIVY_EXIT_CODE=1`) because
  the break-glass path has no separate advisory-issue channel or shift-left PR gate.
- **cosign**: every standby image is cosign-signed (KMS key, in-account). A build that
  skips scan or sign is not possible via this buildspec.
- **Idle cost**: zero for CodeBuild (pay-per-build); ~$1/month for the cosign KMS key.

## What needs applying to stand this up

Apply the `cypherid-web-infra` `terraform/envs/dev/access-management` component
(the new `codebuild-standby-build.tf`). It creates: the CodeBuild project, its
least-privilege service role (ECR push + own log group + cosign KMS sign + scoped build-
secret read -- and nothing else), the cosign KMS key + alias, and the CloudWatch log
group. Then complete Prerequisites 2 and 3 above.
