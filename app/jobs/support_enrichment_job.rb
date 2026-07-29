# frozen_string_literal: true

# Async (Resque) L2/L3 enrichment of a support request (Phase 2 of the support
# pipeline-failure enrichment).
#
# The support submit records L1 (DB-only) synchronously and returns immediately. This
# job then invokes the least-privilege enrichment lambda to pull the DEEP failure
# detail -- Step Functions failure cause + the failed Batch job's CloudWatch log tail
# -- already redacted lambda-side, and routes it to the support sink correlated to the
# original report by correlation_id. Async so the modal never blocks on it.
#
# Retry + dead-letter (ResqueRetryWithDeadLetter): lambda invocation fails
# transiently (throttling, cold-start timeouts). A retryable failure is retried with
# backoff and dead-lettered on exhaustion, so a dropped enrichment is visible rather
# than silent -- the L1 report is already recorded regardless.
#
# Inert until deployed: no-op when the enrichment lambda ARN is unset. The controller
# also guards the enqueue, so this is belt-and-suspenders.
class SupportEnrichmentJob
  extend InstrumentedJob
  extend ResqueRetryWithDeadLetter

  @queue = :support_enrichment

  def self.perform(correlation_id, sfn_execution_arn, run_type, run_id)
    return unless SupportEnrichmentLambda.enabled?

    detail = SupportEnrichmentLambda.enrich(
      correlation_id: correlation_id,
      sfn_execution_arn: sfn_execution_arn,
      run_type: run_type,
      run_id: run_id
    )
    return if detail.blank?

    SupportRouter.route_enrichment(correlation_id: correlation_id, detail: detail)
  end
end
