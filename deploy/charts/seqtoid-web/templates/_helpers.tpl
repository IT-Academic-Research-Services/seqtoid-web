{{/*
Chart name / fullname. fullname = <project>-<environment>-seqtoid-web
(e.g. czid-dev-seqtoid-web) to match the ECS family + the RUNBOOK's
ROLLOUT=czid-prod-seqtoid-web / NS=czid-<env> convention.
*/}}
{{- define "seqtoid-web.name" -}}
seqtoid-web
{{- end -}}

{{- define "seqtoid-web.fullname" -}}
{{- printf "%s-%s-%s" .Values.project .Values.environment (include "seqtoid-web.name" .) | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Image reference. Prefer the immutable DIGEST when set, else the tag.

The promotion pipeline (CZID-464, promote-to-env.yml) writes BOTH image.digest and
image.tag: the digest is the artifact that passed the test gate, the tag is the
human-readable sha-<commit> alongside it. Rendering repository@sha256:... is what makes
"the tier runs the byte-identical artifact that was tested" true rather than aspirational
-- a tag can be repointed after the test, a digest cannot.

Falls back to :tag so every environment that has not been onboarded to digest promotion
(and local/dev rendering) is unaffected.
*/}}
{{- define "seqtoid-web.image" -}}
{{- if .Values.image.digest -}}
{{- printf "%s@%s" .Values.image.repository .Values.image.digest -}}
{{- else -}}
{{- printf "%s:%s" .Values.image.repository (.Values.image.tag | toString) -}}
{{- end -}}
{{- end -}}

{{/* Rails env derived from the logical environment, unless explicitly set. */}}
{{- define "seqtoid-web.railsEnv" -}}
{{- if .Values.railsEnv -}}
{{- .Values.railsEnv -}}
{{- else if eq .Values.environment "dev" -}}
development
{{- else if eq .Values.environment "prod" -}}
production
{{- else -}}
{{- .Values.environment -}}
{{- end -}}
{{- end -}}

{{/* Chamber service name (idseq-<env>-web) unless overridden. */}}
{{- define "seqtoid-web.chamberService" -}}
{{- default (printf "idseq-%s-web" .Values.environment) .Values.secrets.chamber.service -}}
{{- end -}}

{{/* Samples bucket: explicit override, else the czecs pattern, else empty. */}}
{{- define "seqtoid-web.samplesBucket" -}}
{{- if .Values.aws.samplesBucketName -}}
{{- .Values.aws.samplesBucketName -}}
{{- else if .Values.aws.accountId -}}
{{- printf "idseq-samples-%s-%s" .Values.environment (.Values.aws.accountId | toString) -}}
{{- end -}}
{{- end -}}

{{/* ServiceAccount name. */}}
{{- define "seqtoid-web.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "seqtoid-web.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* Common labels. */}}
{{- define "seqtoid-web.labels" -}}
app.kubernetes.io/name: {{ include "seqtoid-web.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: seqtoid
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" }}
seqtoid.io/environment: {{ .Values.environment }}
{{- end -}}

{{/* Web selector labels (Rollout injects rollouts-pod-template-hash on top). */}}
{{- define "seqtoid-web.selectorLabels" -}}
app.kubernetes.io/name: {{ include "seqtoid-web.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/component: web
{{- end -}}

{{/*
Shared pod env (web + workers + migrate). Mirrors the czecs task-def env:
RAILS_ENV, ENVIRONMENT, RAILS_LOG_TO_STDOUT (K8s captures stdout -> no awslogs),
AWS_REGION/AWS_DEFAULT_REGION, plus any extraEnv. Secrets come from Chamber at
runtime (image ENTRYPOINT), so they are not enumerated here.
*/}}
{{- define "seqtoid-web.commonEnv" -}}
- name: RAILS_ENV
  value: {{ include "seqtoid-web.railsEnv" . | quote }}
- name: ENVIRONMENT
  value: {{ .Values.environment | quote }}
- name: RAILS_LOG_TO_STDOUT
  value: "yes"
- name: AWS_REGION
  value: {{ .Values.aws.region | quote }}
- name: AWS_DEFAULT_REGION
  value: {{ .Values.aws.region | quote }}
{{- with .Values.aws.accountId }}
- name: AWS_ACCOUNT_ID
  value: {{ . | quote }}
{{- end }}
{{- with .Values.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/*
Preview SFN notification model (preview.notifications.mode): "poll" (default) or "sqs".
Validated here so a typo fails the render instead of meaning poll in one template and sqs in another.
*/}}
{{- define "seqtoid-web.previewNotificationsMode" -}}
{{- $mode := .Values.preview.notifications.mode | default "poll" -}}
{{- if not (has $mode (list "poll" "sqs")) -}}
{{- fail (printf "preview.notifications.mode must be poll or sqs (got %q)" $mode) -}}
{{- end -}}
{{- $mode -}}
{{- end -}}

{{/*
The SNS topic dev's Step Functions status events arrive on. Defaults to the swipe naming
(idseq-swipe-<environment>-sfn-notifications-topic) in aws.accountId/aws.region.
*/}}
{{- define "seqtoid-web.previewSfnTopicArn" -}}
{{- if .Values.preview.notifications.topicArn -}}
{{- .Values.preview.notifications.topicArn -}}
{{- else if .Values.aws.accountId -}}
{{- printf "arn:aws:sns:%s:%s:idseq-swipe-%s-sfn-notifications-topic" .Values.aws.region (toString .Values.aws.accountId) .Values.environment -}}
{{- else -}}
{{- fail "preview.notifications.mode=sqs needs preview.notifications.topicArn or aws.accountId to locate the SFN notification topic" -}}
{{- end -}}
{{- end -}}

{{/*
The execution-name prefix a preview dispatches with, which its queue's filter matches. One source
of truth: preview.notifications.executionNamePrefix, else the SFN_EXECUTION_NAME_PREFIX the
ApplicationSet puts in extraEnv, else idseq-pr-<prNumber>.
*/}}
{{- define "seqtoid-web.previewExecutionNamePrefix" -}}
{{- $prefix := .Values.preview.notifications.executionNamePrefix -}}
{{- if not $prefix -}}
{{- range .Values.extraEnv -}}
{{- if eq .name "SFN_EXECUTION_NAME_PREFIX" -}}{{- $prefix = .value -}}{{- end -}}
{{- end -}}
{{- end -}}
{{- $prefix | default (printf "idseq-pr-%v" .Values.preview.prNumber) -}}
{{- end -}}

{{/*
Dev pin env (web container only). Renders only when .Values.pin.kind is lease or rc; absent pin or
kind none renders nothing. Read by app/helpers/dev_pin_helper.rb for the app-wide banner.
*/}}
{{- define "seqtoid-web.pinEnv" -}}
{{- $pin := .Values.pin | default dict -}}
{{- if has ($pin.kind | default "none" | toString) (list "lease" "rc") -}}
- name: DEV_PIN_KIND
  value: {{ $pin.kind | quote }}
{{- with $pin.holder }}
- name: DEV_PIN_HOLDER
  value: {{ . | toString | quote }}
{{- end }}
{{- with $pin.expires_at }}
- name: DEV_PIN_EXPIRES_AT
  value: {{ . | toString | quote }}
{{- end }}
{{- with $pin.rc }}
- name: DEV_PIN_RC
  value: {{ . | toString | quote }}
{{- end }}
{{- end }}
{{- end -}}
