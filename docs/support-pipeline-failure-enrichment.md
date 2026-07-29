# Support report: pipeline-failure enrichment

The in-app "Report an issue" modal (SupportPortal) originally attached only
front-end context: the last client-side JS error, the route/task, project, and
account. This feature makes a report also carry **pipeline-failure** context when
the user is reporting a failed run, and routes the enriched report to support.

## Decisions (locked)

| # | Decision |
|---|----------|
| 1 | Trigger both ways: (a) from a failed sample/run, and (b) auto-detect the current run failed. |
| 2 | v1 captures **L1** only (DB fields). |
| 3 | L1 is **synchronous**; L2/L3 are **async**. |
| 4 | Route to the **Grafana** support inbox now, behind a router seam so **DataDog or ServiceNow** can be swapped in later. |
| 5 | The user sees a **friendly one-liner**; raw errors/logs are **support-only**. |
| 6 | Deep (L2/L3) enrichment runs in a **dedicated least-privilege lambda**, NOT the web tier. |
| 7 | **All workflows**: mNGS (`pipeline_runs`) and CG/AMR/long-read (`workflow_runs`). |

## Enrichment layers

- **L1 (v1, shipped) - DB only, no AWS.** `error_message`, `known_user_error`,
  failed stage (parsed from `job_status`), status, pipeline/WDL version,
  technology, `sfn_execution_arn`, `s3_output_prefix`, plus a friendly
  user-facing one-liner. Access-controlled via the caller's `Power` (viewable
  samples only). Best-effort: never breaks a submit.
- **L2 (planned) - Step Functions.** `DescribeExecution` for the failure cause and
  which state died.
- **L3 (planned) - CloudWatch Logs.** Tail of the failed Batch job's log stream
  (the actual stack trace), redacted.

## v1 implementation (this PR)

- **Frontend**
  - `collectDiagnostics.ts`: a module-level run-failure store
    (`recordRunFailure` / `clearRunFailure` / `getRunFailure`), mirroring the
    existing `recordClientError` pattern. When set, its `userFacing` one-liner
    takes precedence in the modal's Error row.
  - `SampleView.tsx`: records the current run's failure (mNGS pipeline-run status
    or CG/AMR/long-read workflow-run status) and clears it on unmount.
  - `api/support.ts` + `SupportPortal.tsx`: attach `run_context`
    (`{sample_id, run_id, workflow}`) to the submit when a failure is recorded.
- **Backend**
  - `SupportPipelineFailure` (service): resolves the run through the user's
    `Power`, confirms it failed, returns the L1 detail hash + `user_facing`.
    **Never** calls SFN-backed helpers (`WorkflowRun#input_error` /
    `#error_message_display`) - those are L2 and would hit AWS.
  - `support_requests_controller`: permits `run_context`, calls the service, adds
    a support-only `pipeline_failure` block to the payload.
  - `SupportRouter` (service): the routing seam. Today: the durable
    `[support_request]` log (-> Loki -> Grafana) + Sentry. DataDog / ServiceNow
    adapters register here later without touching the controller.

## Phase 2 - the enrichment lambda (tracked separately)

**Why a lambda, not web-tier IAM.** The web pods are internet-facing and already
hold DB + SSM secrets. Granting them `states:DescribeExecution` +
`logs:FilterLogEvents` means one web-pod compromise yields raw read of all
pipeline execution history and log contents. Instead:

- The web role gets only `lambda:InvokeFunction` on one function ARN.
- The lambda holds the scoped SFN/CloudWatch read role, runs isolated, and
  enforces its own guardrails: verify the caller owns the run, scope log groups,
  **redact ARNs/S3 paths/PII**, cap log volume, and emit an audit trail.
- Least privilege + separation of duties + tight blast radius.

**Flow.** After submit, a background job invokes the lambda with the run id/ARN;
the lambda returns redacted L2/L3 failure detail; the job appends it to the
support record (async, so the modal never blocks).

**Routing evolution.** Grafana today; when we cut over, add a DataDog or
ServiceNow adapter in `SupportRouter#sinks` - the payload already carries the
full failure detail.
