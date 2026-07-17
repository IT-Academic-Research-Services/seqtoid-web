# CZID-722 (Phase 1) - Customer-journey view for support triage, in-house.
#
# Mirrors the shape of an Adobe-CJA "customer journey" (sessions, path, timing,
# funnel/drop-off) WITHOUT any third-party SDK: it is a pure transform over the
# per-user action-log steps that SupportActionLogQuery#recent_steps already returns
# from the #472 [user_action] log lines. No new capture, no new data, no PII beyond
# the identifiers the capture side already recorded.
#
# It answers, structurally, "what did this user do that led to the ticket": their
# actions grouped into sessions, the time spent between steps, where a flow errored,
# and how far they got through a known funnel before dropping.
#
# Design constraints (carried from #472, non-negotiable):
#   - Pure + inert-safe: given nil/empty steps it returns nil; it touches no network
#     and no DB, so local/test/CI produce a deterministic result and behavior is
#     unchanged where no action logs exist.
#   - Never raises into the request path: the caller (SupportRequestsController)
#     wraps this, but the service is also defensive on its own -- unparseable
#     timestamps degrade to nil dwell rather than blowing up sessionization.
#   - No PII by construction: consumes only {at, action, outcome, error_class, ...}
#     identifiers; it never reads or emits emails/names/free text.
#
# Input: the array of step hashes from SupportActionLogQuery#recent_steps, oldest
# first, each shaped:
#   { at:, action:, outcome:, error_class:, controller:, request_id:, trace_id: }
class SupportJourney
  # A new session starts when this much idle time passes between two consecutive
  # steps. 30 min mirrors the common web-analytics session-timeout default.
  DEFAULT_IDLE_GAP_SECONDS = 30 * 60

  # Named funnels, evaluated over the ordered step trail. Each is a sequence of the
  # ACTUAL instrumented action names (OtelActionLogging call sites today:
  # sample.bulk_upload, project.create, project.mutate, bulk_download.create). Add a
  # stage here only once the action is genuinely emitted -- a funnel stage that is
  # never instrumented would read as a permanent drop-off and mislead triage. As
  # more of the pipeline is instrumented (host-filter, results, report), extend the
  # stages list; nothing else changes.
  DEFAULT_FUNNELS = [
    {
      name: "sample_to_download",
      label: "Upload a sample through to downloading its results",
      stages: %w[sample.bulk_upload bulk_download.create],
    },
    {
      name: "project_setup",
      label: "Create and configure a project",
      stages: %w[project.create project.mutate],
    },
  ].freeze

  # Build the journey from a step trail. Returns nil when there is nothing usable,
  # so the caller can simply omit the block (same contract as recent_steps).
  def self.from_steps(steps, idle_gap_seconds: DEFAULT_IDLE_GAP_SECONDS, funnels: DEFAULT_FUNNELS)
    new(steps, idle_gap_seconds: idle_gap_seconds, funnels: funnels).build
  end

  def initialize(steps, idle_gap_seconds: DEFAULT_IDLE_GAP_SECONDS, funnels: DEFAULT_FUNNELS)
    @steps = Array(steps)
    @idle_gap_seconds = idle_gap_seconds
    @funnels = funnels
  end

  def build
    usable = @steps.select { |s| s.is_a?(Hash) && s[:action].present? }
    return nil if usable.empty?

    sessions = sessionize(usable)
    {
      step_count: usable.length,
      session_count: sessions.length,
      sessions: sessions,
      funnels: build_funnels(usable),
    }
  end

  private

  # Split the ordered steps into sessions on an idle-gap boundary. A step whose
  # timestamp cannot be parsed does NOT start a new session (conservative: keep it
  # with the current session) and carries a nil dwell.
  def sessionize(steps)
    sessions = []
    current = nil
    previous_time = nil

    steps.each do |step|
      t = coerce_time(step[:at])
      gap = t && previous_time ? (t - previous_time) : nil

      if current.nil? || (gap && gap > @idle_gap_seconds)
        current = new_session
        sessions << current
      end

      current[:steps] << {
        action: step[:action],
        outcome: step[:outcome],
        error_class: step[:error_class],
        at: step[:at],
        since_previous_seconds: gap&.round,
      }.compact

      previous_time = t || previous_time
    end

    sessions.map.with_index { |s, i| finalize_session(s, i) }
  end

  def new_session
    { steps: [] }
  end

  # Derive a session's summary fields from its ordered steps: entry/exit action,
  # wall-clock span, and the first step that errored (the likely triage anchor).
  def finalize_session(session, index)
    steps = session[:steps]
    first = steps.first
    last = steps.last
    start_t = coerce_time(first[:at])
    end_t = coerce_time(last[:at])
    error = steps.find { |s| s[:outcome].to_s == "error" }

    {
      index: index,
      started_at: first[:at],
      ended_at: last[:at],
      duration_seconds: start_t && end_t ? (end_t - start_t).round : nil,
      entry_action: first[:action],
      exit_action: last[:action],
      step_count: steps.length,
      error_step: error && { action: error[:action], error_class: error[:error_class], at: error[:at] }.compact,
      steps: steps,
    }.compact
  end

  # For each named funnel, walk the ordered actions and record how far the user got.
  # Stages must be reached IN ORDER (a later stage only counts once its predecessor
  # has been seen), so an out-of-order action does not falsely "complete" the funnel.
  # A funnel the user never entered (no first stage) is omitted -- it is noise for
  # triage, not signal.
  def build_funnels(steps)
    @funnels.filter_map { |funnel| evaluate_funnel(funnel, steps) }
  end

  def evaluate_funnel(funnel, steps)
    stages = funnel[:stages]
    reached = []
    errored_at = nil
    next_index = 0

    steps.each do |step|
      stage = stages[next_index]
      next if stage.nil?
      next unless step[:action] == stage

      reached << stage
      errored_at ||= stage if step[:outcome].to_s == "error"
      next_index += 1
    end

    return nil if reached.empty?

    completed = reached.length == stages.length
    {
      name: funnel[:name],
      label: funnel[:label],
      stages: stages,
      reached: reached,
      furthest_stage: reached.last,
      completed: completed,
      dropped_after: completed ? nil : reached.last,
      errored_at: errored_at,
    }.compact
  end

  # Parse a step timestamp into a Time. Accepts a Time, epoch Integer, ISO8601, or
  # the CloudWatch Logs Insights "@timestamp" form ("YYYY-MM-DD HH:MM:SS.mmm", UTC,
  # no zone). Returns nil on anything unparseable so timing degrades gracefully.
  def coerce_time(value)
    case value
    when Time then value
    when Integer then Time.at(value).utc
    when String then parse_time_string(value)
    end
  end

  def parse_time_string(str)
    s = str.strip
    return nil if s.empty?

    Time.iso8601(s)
  rescue ArgumentError
    begin
      # CloudWatch Insights renders @timestamp without a zone; it is UTC.
      Time.strptime("#{s} +0000", "%Y-%m-%d %H:%M:%S.%L %z")
    rescue ArgumentError
      # Last resort for any other valid form; nil on junk (the common case here).
      Time.zone.parse(s)
    rescue StandardError
      nil
    end
  end
end
