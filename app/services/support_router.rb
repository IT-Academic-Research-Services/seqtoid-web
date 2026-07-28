# frozen_string_literal: true

# Routes a fully-built support payload to its destination sink(s).
#
# Today there is exactly one sink: the durable structured log line
# ("[support_request] ..." -> Loki -> the Grafana Support Inbox) plus a Sentry
# message via LogUtil so the report lands next to the user's client-side errors.
#
# This class exists as a SEAM: the destination is expected to move to DataDog or
# ServiceNow later. When it does, those become additional adapters registered here
# -- the controller keeps calling SupportRouter.call and never changes. Each sink is
# best-effort and isolated: a sink that raises is logged and skipped so one bad sink
# can never break the submission or starve the others.
class SupportRouter
  include Callable

  def initialize(payload:, user:)
    @payload = payload
    @user = user
  end

  def call
    sinks.each do |name, sink|
      sink.call
    rescue StandardError => e
      # A sink failure must never break the submit or the other sinks.
      LogUtil.log_error("Support router sink '#{name}' failed", exception: e)
    end
    nil
  end

  private

  # name => callable. Add DataDog / ServiceNow adapters here on cutover (they read
  # the same @payload); the Grafana log sink stays until then.
  def sinks
    {
      grafana_log: -> { grafana_log_sink },
    }
  end

  # The current durable + greppable record (Loki -> Grafana) and the Sentry mirror.
  def grafana_log_sink
    Rails.logger.info("[support_request] #{@payload.to_json}")
    LogUtil.log_message(
      "Support request from user #{@user.id} (#{@payload[:correlation_id]})",
      **@payload
    )
  end
end
