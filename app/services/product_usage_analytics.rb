# CZID-722 (Phase 2a) - Aggregate, privacy-first product-usage analytics, in-house.
#
# Mirrors what Plausible gives you (cookieless, no-PII usage stats) over the SAME
# always-on [user_action] log stream that #472 already emits -- no third-party SDK,
# no cookies, no new capture, and no per-user rows in the OUTPUT.
#
# Where SupportActionLogQuery answers "what did THIS user do" (per-user, operator-
# gated, PII-adjacent by access), this answers "how is the product being used" in
# AGGREGATE: event volume, distinct active users, and per-action counts + error
# rates over a window. The two are the deliberate #722 privacy split -- this side is
# safe for a broader admin/PM surface because its result carries no user identifiers.
#
# PRIVACY NOTE (load-bearing): user ids are read from the log lines ONLY to compute a
# distinct COUNT (active_users). They are never retained past aggregation and never
# appear in the returned hash. The output is counts only. That is what makes this the
# "Plausible" tier rather than the "Adobe CJA" tier.
#
# Design constraints (identical to #472's query side, non-negotiable):
#   - Inert + gated: returns nil unless SUPPORT_LOG_GROUP is set, so local/test/CI
#     and any unconfigured env stay silent and behavior is unchanged.
#   - Never raises into the caller: any AWS / parse failure is swallowed -> nil.
#   - No PII in the output, by construction (see PRIVACY NOTE).
#
# SCALE FOLLOW-UP: this fetches the window's [user_action] lines and aggregates in
# Ruby, bounded by line_limit. That is correct + fully testable now and fine for dev
# volume. At higher volume, push the aggregation server-side with a CloudWatch Logs
# Insights `stats ... by` query so we never pull raw rows. Deferred deliberately: the
# dotted JSON keys ("czid.user_action.user_id") make the Insights stats/parse syntax
# fragile, and it cannot be verified without a live log group -- so the verifiable
# Ruby rollup ships first.
class ProductUsageAnalytics
  # Same marker the capture side writes and SupportActionLogQuery reads; reuse it so
  # the two query services cannot drift on what an action-log line looks like.
  ACTION_LOG_MARKER = SupportActionLogQuery::ACTION_LOG_MARKER

  DEFAULT_MAX_POLLS = 10
  DEFAULT_POLL_INTERVAL = 0.5
  # Upper bound on lines pulled per window. Aggregation is in Ruby, so this caps both
  # cost and memory; a truncated window is flagged in the result (see #aggregate).
  DEFAULT_LINE_LIMIT = 10_000

  def self.overview(window_start:, window_end:, **opts)
    new(window_start: window_start, window_end: window_end, **opts).overview
  end

  def initialize(window_start:, window_end:, log_group: nil, max_polls: DEFAULT_MAX_POLLS,
                 poll_interval: DEFAULT_POLL_INTERVAL, line_limit: DEFAULT_LINE_LIMIT)
    @window_start = coerce_epoch(window_start)
    @window_end = coerce_epoch(window_end)
    @log_group = (log_group || ENV["SUPPORT_LOG_GROUP"]).presence
    @max_polls = max_polls
    @poll_interval = poll_interval
    @line_limit = line_limit
  end

  # Aggregate usage overview for the window, or nil when unavailable / not configured.
  # Never raises.
  def overview
    return nil if @log_group.nil?
    return nil if @window_start.nil? || @window_end.nil?

    rows = run_query
    return nil if rows.nil?

    events = rows.filter_map { |row| parse_row(row) }
    aggregate(events)
  rescue StandardError => e
    Rails.logger.error("[product_usage_analytics] failed: #{e.class}: #{e.message}")
    nil
  end

  private

  # Roll the parsed events up to AGGREGATE, no-PII metrics. user ids are counted for
  # distinctness here and then dropped -- they never leave this method.
  def aggregate(events)
    by_action = events.group_by { |e| e[:action] }.map do |action, group|
      error_count = group.count { |e| e[:outcome].to_s == "error" }
      {
        action: action,
        count: group.length,
        error_count: error_count,
        error_rate: group.empty? ? 0.0 : (error_count.to_f / group.length).round(4),
      }
    end.sort_by { |a| -a[:count] }

    {
      window: { start: @window_start, end: @window_end },
      event_count: events.length,
      active_users: events.filter_map { |e| e[:user_id] }.uniq.length,
      # True when we hit the line cap, so a consumer knows the numbers are a lower
      # bound for this window rather than complete.
      truncated: events.length >= @line_limit,
      actions: by_action,
    }
  end

  def run_query
    client = AwsClient[:cloudwatchlogs]
    query_id = client.start_query(
      log_group_name: @log_group,
      start_time: @window_start,
      end_time: @window_end,
      query_string: insights_query,
      limit: @line_limit
    ).query_id

    poll_results(client, query_id)
  end

  def poll_results(client, query_id)
    @max_polls.times do |attempt|
      resp = client.get_query_results(query_id: query_id)
      case resp.status
      when "Complete"
        return resp.results
      when "Failed", "Cancelled", "Timeout"
        Rails.logger.warn("[product_usage_analytics] query #{query_id} ended #{resp.status}")
        return nil
      end
      sleep(@poll_interval) if attempt < @max_polls - 1
    end
    Rails.logger.warn("[product_usage_analytics] query #{query_id} did not complete in #{@max_polls} polls")
    nil
  end

  # Every [user_action] line in the window, across ALL users (no user filter -- this
  # is the aggregate tier). Raw lines; the rollup happens in Ruby.
  def insights_query
    <<~QUERY.squish
      fields @timestamp, @message
      | filter @message like "#{ACTION_LOG_MARKER}"
      | sort @timestamp asc
      | limit #{@line_limit}
    QUERY
  end

  # Turn one Insights row into {action, outcome, user_id}, or nil for a non-parseable
  # line. Only the three fields the aggregation needs are extracted.
  def parse_row(row)
    fields = row.each_with_object({}) { |f, acc| acc[f.field] = f.value }
    message = fields["@message"].to_s
    return nil unless message.include?(ACTION_LOG_MARKER)

    payload = extract_payload(message)
    return nil if payload.nil?

    action = payload["action"]
    return nil if action.nil?

    {
      action: action,
      outcome: payload["outcome"],
      user_id: payload["czid.user_action.user_id"],
    }
  end

  def extract_payload(message)
    json_part = message.split(ACTION_LOG_MARKER, 2).last.to_s.strip
    return nil if json_part.empty?

    parsed = JSON.parse(json_part)
    parsed.is_a?(Hash) ? parsed : nil
  rescue JSON::ParserError
    nil
  end

  # CloudWatch Logs Insights expects epoch seconds. Accept a Time, ISO8601 string, or
  # integer and normalize; nil on anything else so the caller stays inert.
  def coerce_epoch(value)
    case value
    when Integer then value
    when Time then value.to_i
    when String then Time.iso8601(value).to_i
    end
  rescue ArgumentError
    nil
  end
end
