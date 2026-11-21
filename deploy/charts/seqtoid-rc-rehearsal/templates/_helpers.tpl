{{- define "seqtoid-rc-rehearsal.name" -}}
seqtoid-rc-rehearsal
{{- end -}}

{{- define "seqtoid-rc-rehearsal.labels" -}}
app.kubernetes.io/name: {{ include "seqtoid-rc-rehearsal.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{/* Settings every enabled render needs; fail the render rather than run half-configured. */}}
{{- define "seqtoid-rc-rehearsal.require" -}}
{{- $v := .Values -}}
{{- range $k := list "sourceCluster" "clonePrefix" "ssmPrefix" -}}
{{- if not (index $v $k) -}}{{- fail (printf "%s must be set when enabled" $k) -}}{{- end -}}
{{- end -}}
{{- if not $v.results.bucket -}}{{- fail "results.bucket must be set when enabled" -}}{{- end -}}
{{- if not $v.serviceAccount.roleArn -}}{{- fail "serviceAccount.roleArn must be set when enabled" -}}{{- end -}}
{{- if or (eq $v.clonePrefix $v.sourceCluster) (not (contains "rc-rehearsal" $v.clonePrefix)) -}}
{{- fail "clonePrefix must contain rc-rehearsal and differ from sourceCluster" -}}
{{- end -}}
{{- if and $v.networkPolicy.enabled (not $v.networkPolicy.vpcCidr) -}}{{- fail "networkPolicy.vpcCidr must be set when networkPolicy.enabled" -}}{{- end -}}
{{- end -}}

{{/* True while dev is pinned to an RC with a digest: the only time the rehearsal renders. */}}
{{- define "seqtoid-rc-rehearsal.pinned" -}}
{{- $pin := .Values.pin | default dict -}}
{{- if and .Values.enabled (eq (toString $pin.kind) "rc") $pin.rc .Values.image.digest -}}true{{- end -}}
{{- end -}}
