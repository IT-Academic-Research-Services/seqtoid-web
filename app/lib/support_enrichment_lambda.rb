# frozen_string_literal: true

# Thin client for the support-enrichment Lambda (Phase 2 / L2+L3 of the support
# pipeline-failure enrichment).
#
# WHY a lambda (and why the web tier only invokes it): reading Step Functions
# execution history and CloudWatch Batch-job logs is the sensitive capability. It
# lives in a dedicated, least-privilege function -- the web tier gets ONLY
# lambda:InvokeFunction on this one ARN, never raw states:/logs: access. The lambda
# also does the REDACTION (ARNs / S3 paths / PII) and its own audit trail, so nothing
# unredacted ever crosses back into the app. See
# docs/support-pipeline-failure-enrichment.md.
#
# Inert until deployed: when SUPPORT_ENRICHMENT_LAMBDA_ARN is unset (local/test, or
# before the infra lands) #enabled? is false and callers no-op. This lets the app
# side ship ahead of the lambda.
module SupportEnrichmentLambda
  module_function

  ENV_ARN_KEY = "SUPPORT_ENRICHMENT_LAMBDA_ARN"

  def function_arn
    ENV[ENV_ARN_KEY].presence
  end

  def enabled?
    function_arn.present?
  end

  # Invokes the enrichment lambda synchronously (the caller is already the async
  # Resque job) and returns the parsed, ALREADY-REDACTED failure detail hash, or nil
  # when disabled. Raises on AWS/transport errors so the job's retry+dead-letter can
  # handle transient throttling; raises on a lambda-reported functionError so a real
  # bug surfaces rather than being silently swallowed.
  def enrich(correlation_id:, sfn_execution_arn:, run_type:, run_id:)
    return nil unless enabled?

    request = {
      correlation_id: correlation_id,
      sfn_execution_arn: sfn_execution_arn,
      run_type: run_type,
      run_id: run_id,
    }

    resp = client.invoke(
      function_name: function_arn,
      invocation_type: "RequestResponse",
      payload: request.to_json
    )

    # A lambda-side error (unhandled exception in the function) comes back as
    # function_error; surface it so the job retries / dead-letters.
    raise "support-enrichment lambda error: #{resp.function_error} #{resp.payload&.read}" if resp.function_error.present?

    body = resp.payload&.read
    body.blank? ? nil : JSON.parse(body)
  end

  def client
    # Region + credentials come from the pod's IRSA role (which will hold only
    # lambda:InvokeFunction on the enrichment function ARN).
    @client ||= Aws::Lambda::Client.new(
      http_read_timeout: 120, # enrichment is a quick SFN describe + bounded log tail
      retry_limit: 0 # the Resque job owns retry/backoff + dead-letter
    )
  end
end
