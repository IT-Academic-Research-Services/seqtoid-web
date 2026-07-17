# Sink for in-app self-help "Report an issue" submissions (Forgejo #440).
#
# Two layers, by design:
#   (A) The END USER only ever sees a minimal quick report (error / task / project
#       / account) in the popup. That arrives here as params[:quick_report].
#   (B) SUPPORT SIDE (this controller) enriches the submission into a RICH,
#       operator-only payload that the user never sees: a session/trace
#       correlation id, a best-effort "what happened and why" summary, a matched
#       runbook, and deep-links into CloudWatch Logs + the OTel dashboard filtered
#       to this user/session and time window.
#
# The enriched payload is recorded via the structured log (durable, greppable) and
# LogUtil.log_message (Sentry), "to a point" -- no external ticketing yet.
class SupportRequestsController < ApplicationController
  include ErrorHelper

  # Starter runbook catalog: known error/route patterns -> a runbook doc path and
  # a short label. Seeded with the common beta failure modes. These are
  # placeholder paths; the real runbooks are tracked as a TODO.
  # TODO(#440): replace placeholder paths with the real runbook URLs once the
  # support runbook docs land.
  RUNBOOK_CATALOG = [
    {
      id: "bulk_download_failure",
      match: /bulk[\s_-]?download/i,
      label: "Bulk download failure",
      runbook: "https://runbooks.seqtoid.internal/bulk-download-failure", # TODO(#440): real path
    },
    {
      id: "upload_failure",
      match: /upload|s3|resumable/i,
      label: "Upload failure",
      runbook: "https://runbooks.seqtoid.internal/upload-failure", # TODO(#440): real path
    },
    {
      id: "auth_login_failure",
      match: /auth|login|sign[\s_-]?in|token|401|403|unauthorized/i,
      label: "Auth / login failure",
      runbook: "https://runbooks.seqtoid.internal/auth-login-failure", # TODO(#440): real path
    },
  ].freeze

  # authenticate_user! is already applied globally via ApplicationController, so this
  # endpoint is only reachable by a signed-in user. current_user is therefore present.
  def create
    request_params = support_request_params.to_h.deep_symbolize_keys
    quick_report = (request_params[:quick_report] || {}).to_h
    diagnostics = sanitized_diagnostics(request_params[:diagnostics])

    # A correlation id so OTel/CloudWatch logs for this exact session can be found.
    # Rails' per-request id is our best available session/trace handle today; fall
    # back to a generated UUID when the request id isn't populated.
    correlation_id = request.request_id.presence || SecureRandom.uuid

    now = Time.now.utc
    # Time window around the report, used to scope the log deep-links.
    window_start = (now - 30.minutes).iso8601
    window_end = now.iso8601

    error_text = quick_report[:errorName].to_s
    route_text = diagnostics[:route].to_s.presence || quick_report[:task].to_s

    # (CZID-472) Pull this user's recent OTel action-log trail from the backend so
    # the operator gets a step-by-step of what the user did. Gated + best-effort:
    # nil when SUPPORT_LOG_GROUP is unset or the query fails (never breaks submit).
    action_log_steps = query_action_log_steps(
      correlation_id: correlation_id,
      user_id: current_user.id,
      window_start: window_start,
      window_end: window_end
    )

    # (B) The rich, operator-only support payload. NEVER rendered back to the user.
    support_payload = {
      event: "support_request",
      correlation_id: correlation_id,
      # Who
      user_id: current_user.id,
      user_email: current_user.email,
      user_role: current_user.role_name,
      account_name: quick_report[:accountName],
      # What the user saw (the minimal, user-facing quick report)
      error: quick_report[:errorName],
      task: quick_report[:task],
      project: quick_report[:project],
      description: request_params[:description].to_s.truncate(5000),
      # Best-effort narrative for the agent (folds in the action-log trail if any).
      summary: build_summary(quick_report, diagnostics, action_log_steps),
      # Matched runbook (nil-safe; falls back to a generic entry).
      runbook: match_runbook(error_text, route_text),
      # Deep-links into the logs, filtered to this user/session + time window.
      log_links: build_log_links(
        correlation_id: correlation_id,
        user_id: current_user.id,
        window_start: window_start,
        window_end: window_end
      ),
      # (CZID-472) The parsed, per-user OTel action-log step-by-step. Populated by
      # SupportActionLogQuery from the always-on [user_action] log lines; nil when
      # the log group is not configured (e.g. local/test) or the query fails, so an
      # operator can still pull the trail manually via the deep-links above.
      action_log_steps: action_log_steps,
      # (CZID-722) The same trail, structured into a customer journey: sessions,
      # per-step dwell time, the step that errored, and how far the user got through
      # known funnels before dropping. Pure transform over action_log_steps -- no
      # extra query, nil when there is no trail. Operator-only, like the rest of B.
      journey: build_journey(action_log_steps),
      # Full browser/session diagnostics (support-only).
      diagnostics: diagnostics,
      environment: Rails.env,
      git_release_sha: ENV["GIT_RELEASE_SHA"],
      submitted_at: now.iso8601,
    }

    # Structured log line is the durable, greppable record for operators, and
    # LogUtil.log_message forwards it to Sentry so it lands next to the user's
    # client-side errors.
    Rails.logger.info("[support_request] #{support_payload.to_json}")
    LogUtil.log_message(
      "Support request from user #{current_user.id} (#{correlation_id})",
      **support_payload
    )

    render json: { status: "ok", correlation_id: correlation_id }, status: :created
  rescue StandardError => e
    LogUtil.log_error("Failed to record support request", exception: e)
    render json: { error: "Unable to record support request" }, status: :internal_server_error
  end

  private

  def support_request_params
    # quick_report and diagnostics are free-form client-collected objects; permit
    # them as open hashes.
    params.permit(
      :description,
      quick_report: {},
      diagnostics: {}
    )
  end

  # Guard against unbounded/huge diagnostics payloads being logged verbatim.
  def sanitized_diagnostics(diagnostics)
    return {} if diagnostics.blank?

    diagnostics.to_h.deep_symbolize_keys.transform_values do |value|
      value.is_a?(String) ? value.truncate(2000) : value
    end
  end

  # A best-effort, human-readable "what happened and why" line for the support
  # agent, assembled from the error + route + user-facing context. Not a guarantee
  # of root cause -- a starting hypothesis. When an action-log trail is available
  # (CZID-472) it appends a short "recent steps" tail for extra context.
  def build_summary(quick_report, diagnostics, action_log_steps = nil)
    account = quick_report[:accountName].presence || "A user"
    task = quick_report[:task].presence || "the app"
    project = quick_report[:project].presence
    error = quick_report[:errorName].presence || "an unspecified problem"
    route = diagnostics[:route].presence

    parts = ["#{account} hit \"#{error}\" while on \"#{task}\""]
    parts << "in #{project}" if project && project != "Not in a project"
    parts << "(route: #{route})" if route
    summary = "#{parts.join(' ')}."

    trail = summarize_action_trail(action_log_steps)
    trail ? "#{summary} #{trail}" : summary
  end

  # Condense the last few action-log steps into a one-line "a -> b -> c" trail,
  # flagging any step that errored. Returns nil when there is no usable trail.
  def summarize_action_trail(action_log_steps)
    return nil if action_log_steps.blank?

    recent = action_log_steps.last(5).filter_map do |step|
      action = step[:action].presence
      next if action.nil?

      step[:outcome].to_s == "error" ? "#{action} (error)" : action
    end
    return nil if recent.empty?

    "Recent steps: #{recent.join(' -> ')}."
  end

  # (CZID-472) Best-effort fetch of this user's recent action-log trail. Delegates
  # to SupportActionLogQuery, which is itself gated + inert-safe; this wrapper adds
  # one more guard so a query failure can never break the support submission.
  def query_action_log_steps(correlation_id:, user_id:, window_start:, window_end:)
    SupportActionLogQuery.recent_steps(
      user_id: user_id,
      correlation_id: correlation_id,
      window_start: window_start,
      window_end: window_end
    )
  rescue StandardError => e
    LogUtil.log_error("Support action-log query failed", exception: e)
    nil
  end

  # (CZID-722) Build the operator-only customer-journey view from the action-log
  # trail already fetched above. Best-effort and defensive: SupportJourney is a pure
  # transform, but this wrapper still swallows any failure so structuring the journey
  # can never break a support submission (same contract as query_action_log_steps).
  # Returns nil when there is no usable trail, so the payload simply omits the block.
  def build_journey(action_log_steps)
    SupportJourney.from_steps(action_log_steps)
  rescue StandardError => e
    LogUtil.log_error("Support journey build failed", exception: e)
    nil
  end

  # Matches the error/route against the starter runbook catalog. Falls back to a
  # generic "triage" entry so the agent always has a next step.
  def match_runbook(error_text, route_text)
    haystack = "#{error_text} #{route_text}"
    entry = RUNBOOK_CATALOG.find { |rb| haystack.match?(rb[:match]) }
    return entry.slice(:id, :label, :runbook) if entry

    {
      id: "generic_triage",
      label: "No specific runbook matched -- general triage",
      # TODO(#440): point at the general support triage runbook once it exists.
      runbook: "https://runbooks.seqtoid.internal/general-triage",
    }
  end

  # Constructs deep-links into CloudWatch Logs (Insights) and the OTel dashboard,
  # pre-filtered to this user/session and time window, so an operator can jump
  # straight to the relevant logs.
  #
  # The log-group and OTel base are read from ENV/config. When they're not set we
  # still emit the URL SHAPE with a clear TODO placeholder so the intent is
  # obvious in the recorded payload.
  def build_log_links(correlation_id:, user_id:, window_start:, window_end:)
    region = ENV["AWS_REGION"].presence || AwsUtil::AWS_REGION
    # TODO(#440): set SUPPORT_LOG_GROUP / OTEL_DASHBOARD_BASE_URL in the app config
    # for each environment so these links resolve to real destinations.
    log_group = ENV["SUPPORT_LOG_GROUP"].presence || "TODO-set-SUPPORT_LOG_GROUP"
    otel_base = ENV["OTEL_DASHBOARD_BASE_URL"].presence || "TODO-set-OTEL_DASHBOARD_BASE_URL"

    # CloudWatch Logs Insights query scoped to this correlation id / user.
    insights_query = <<~QUERY.squish
      fields @timestamp, @message
      | filter @message like /#{correlation_id}/ or @message like /"user_id":#{user_id}/
      | sort @timestamp desc
      | limit 200
    QUERY

    cloudwatch_insights_url =
      "https://#{region}.console.aws.amazon.com/cloudwatch/home?region=#{region}" \
      "#logsV2:logs-insights$3FqueryDetail$3D" \
      "~(source~(~'#{log_group})" \
      "~start~'#{window_start}~end~'#{window_end}" \
      "~query~'#{CGI.escape(insights_query)})"

    otel_dashboard_url =
      "#{otel_base}?correlationId=#{correlation_id}&userId=#{user_id}" \
      "&from=#{window_start}&to=#{window_end}"

    # (CZID-472) A CloudWatch Logs Insights link scoped to just this user's
    # [user_action] action-log lines -- the same signal SupportActionLogQuery reads
    # programmatically, so an operator can open the raw trail in one click.
    action_log_query = <<~QUERY.squish
      fields @timestamp, @message
      | filter @message like "#{SupportActionLogQuery::ACTION_LOG_MARKER}"
      | filter @message like /"czid.user_action.user_id":#{user_id}/ or @message like /#{correlation_id}/
      | sort @timestamp asc
      | limit 200
    QUERY

    otel_action_log_url =
      "https://#{region}.console.aws.amazon.com/cloudwatch/home?region=#{region}" \
      "#logsV2:logs-insights$3FqueryDetail$3D" \
      "~(source~(~'#{log_group})" \
      "~start~'#{window_start}~end~'#{window_end}" \
      "~query~'#{CGI.escape(action_log_query)})"

    {
      cloudwatch_logs_insights: cloudwatch_insights_url,
      otel_dashboard: otel_dashboard_url,
      # (CZID-472) One-click link to the raw per-user action-log trail.
      otel_action_log: otel_action_log_url,
      window: { start: window_start, end: window_end },
    }
  end
end
