# frozen_string_literal: true

# Routes a fully-built support payload to its destination sink(s).
#
# Today there is exactly one sink: the durable structured log line
# ("[support_request] ..." -> Loki -> the Grafana Support Inbox) plus a Sentry
# message via LogUtil so the report lands next to the user's client-side errors.
#
# This class exists as a SEAM: the destination is expected to move to DataDog or
# ServiceNow later. When it does, those become additional adapters here -- the
# controller keeps calling SupportRouter.call and never changes.
#
# Failure contract: the PRIMARY sink (the durable Grafana/Loki record) must NOT be
# swallowed. If it raises, the failure propagates so the controller renders a clean
# 500 -- we never tell the user "recorded" when the report was not actually recorded.
# FUTURE secondary sinks (DataDog/ServiceNow) will each be wrapped best-effort so a
# secondary outage can never fail the submit; only the primary record is load-bearing.
class SupportRouter
  include Callable

  def initialize(payload:, user:)
    @payload = payload
    @user = user
  end

  def call
    # Primary, load-bearing sink -- raises on failure (controller turns it into 500).
    grafana_log_sink

    # Secondary sinks go here, each best-effort (own rescue), on the DataDog/ServiceNow
    # cutover so one cannot fail the submit. None yet.
    nil
  end

  private

  # The current durable + greppable record (Loki -> Grafana Support Inbox) and the
  # Sentry mirror so the report lands next to the user's client-side errors.
  def grafana_log_sink
    Rails.logger.info("[support_request] #{@payload.to_json}")
    LogUtil.log_message(
      "Support request from user #{@user.id} (#{@payload[:correlation_id]})",
      **@payload
    )
  end
end
