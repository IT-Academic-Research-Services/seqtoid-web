# CZID-472 - OTel per-user *action logs* for support-ticket triage.
#
# Emits an enriched span + a structured log line for key user actions (upload,
# bulk-download, project ops), so a support agent can reconstruct "what this user
# just did" from the OTel/CloudWatch backend when a ticket comes in (feeds #440).
#
# Builds ON the existing OTel SDK/initializer (config/initializers/opentelemetry.rb,
# #426). It does NOT configure OTel; it only records spans/attributes on the
# tracer provider that initializer set up (a no-op NoopTracer when
# OTEL_EXPORTER_OTLP_ENDPOINT is unset - local/test/CI stay silent). Independently,
# it always writes a structured log line, so the signal exists even where traces
# are not exported.
#
# Inert-safe + no-PII by design:
#   - never raises into the request path (a logging failure must not break the user action);
#   - enriches with IDENTIFIERS only (user id / role, project id, sample count, request +
#     trace id) - never emails, names, or free-text - so nothing sensitive leaks to the
#     observability backend or logs. See ACTION_LOG_SENSITIVE_KEYS.
#
# Usage (in a controller):
#   include OtelActionLogging
#   log_user_actions :create, action: "bulk_download.create",
#                    context: ->(c) { { "czid.project.id" => c.params[:project_id] } }
#
# or imperatively inside an action:
#   log_user_action("project.create", { "czid.project.id" => project.id })
module OtelActionLogging
  extend ActiveSupport::Concern

  # Namespace for the action-log spans/attributes, so they are trivially filterable
  # in the backend (e.g. attribute key prefix "czid.user_action").
  ACTION_LOG_TRACER = "czid.user_action"
  ACTION_LOG_ATTR_PREFIX = "czid.user_action"

  # Defensive denylist: if a caller ever passes one of these keys we drop it, so a
  # future careless call site cannot leak PII into the action log.
  ACTION_LOG_SENSITIVE_KEYS = %w[
    email name first_name last_name password token authorization
    phone address ip remote_ip
  ].freeze

  class_methods do
    # Declaratively instrument one or more actions. Installs an around_action that
    # wraps just those actions and emits the action log around them.
    #
    #   log_user_actions :create, :destroy, action: "project.create"
    #   log_user_actions :create, action: "bulk_download.create",
    #                    context: ->(controller) { { "czid.project.id" => controller.params[:project_id] } }
    def log_user_actions(*action_names, action:, context: nil)
      names = action_names.map(&:to_sym)
      around_action(only: names) do |controller, block|
        controller.send(:with_user_action_log, action, context, &block)
      end
    end
  end

  private

  # Wrap a block in an action-log span; records outcome. Re-raises the wrapped
  # action's own exceptions (after tagging the span) so controller behavior is
  # UNCHANGED. Any failure in the logging machinery itself is swallowed so it can
  # never break the user action — and the action is only ever executed ONCE.
  def with_user_action_log(action_name, context_proc, &action)
    span = start_user_action_span(action_name, context_proc)

    outcome = "ok"
    error_class = nil
    begin
      result = action.call
    rescue StandardError => e
      outcome = "error"
      error_class = e.class.name
      tag_span_error(span, e)
      raise
    ensure
      finish_user_action(span, action_name, outcome, error_class)
    end
    result
  end

  # Acquire the span. Returns nil (never raises) if tracing setup fails, so the
  # caller still runs the action exactly once with plain logging.
  def start_user_action_span(action_name, context_proc)
    attributes = base_action_attributes
    attributes.merge!(sanitize_action_attributes(resolve_context(context_proc))) if context_proc
    @user_action_attributes = attributes

    tracer = OpenTelemetry.tracer_provider.tracer(ACTION_LOG_TRACER)
    span_attributes = { "#{ACTION_LOG_ATTR_PREFIX}.name" => action_name }.merge(attributes)
    tracer.start_span("user_action.#{action_name}", attributes: span_attributes, kind: :internal)
  rescue StandardError => e
    LogUtil.log_error(
      "[user_action] start_user_action_span: tracing setup failed for #{action_name}: #{e.class}: #{e.message}",
      exception: e,
      action_name: action_name,
      attributes: attributes
    )
    nil
  end

  def tag_span_error(span, error)
    return if span.nil?

    span.record_exception(error)
    span.status = OpenTelemetry::Trace::Status.error(error.class.name)
  rescue StandardError # rubocop:disable Lint/SuppressedException
    # span tagging must never mask the real error
  end

  def finish_user_action(span, action_name, outcome, error_class)
    emit_action_log(action_name, @user_action_attributes || {}, outcome: outcome, error_class: error_class)
    span&.finish
  rescue StandardError => e
    LogUtil.log_error(
      "[user_action] finish_user_action: finish failed for #{action_name}: #{e.class}: #{e.message}",
      exception: e,
      action_name: action_name,
      outcome: outcome,
      error_class: error_class
    )
  end

  # Imperative entry point: record a one-shot action log (no span nesting around a
  # block). Useful when the interesting identifiers only exist mid-action.
  def log_user_action(action_name, attributes = {})
    merged = base_action_attributes.merge(sanitize_action_attributes(attributes))
    tracer = OpenTelemetry.tracer_provider.tracer(ACTION_LOG_TRACER)
    span_attributes = { "#{ACTION_LOG_ATTR_PREFIX}.name" => action_name }.merge(merged)
    tracer.in_span("user_action.#{action_name}", attributes: span_attributes, kind: :internal) do
      # empty: the span itself is the record
    end
    emit_action_log(action_name, merged, outcome: "ok", error_class: nil)
  rescue StandardError => e
    LogUtil.log_error(
      "[user_action] log_user_action: failed to log #{action_name}: #{e.class}: #{e.message}",
      exception: e,
      action_name: action_name,
      attributes: attributes
    )
  end

  # Identifiers common to every action log. IDs only - no PII.
  def base_action_attributes
    attrs = {
      "#{ACTION_LOG_ATTR_PREFIX}.controller" => controller_name,
      "#{ACTION_LOG_ATTR_PREFIX}.action"     => action_name,
      "#{ACTION_LOG_ATTR_PREFIX}.request_id" => request.request_id,
    }
    if respond_to?(:current_user, true) && current_user
      attrs["#{ACTION_LOG_ATTR_PREFIX}.user_id"] = current_user.id
      attrs["#{ACTION_LOG_ATTR_PREFIX}.user_role"] = current_user.role
    end
    trace_id = current_otel_trace_id
    attrs["#{ACTION_LOG_ATTR_PREFIX}.trace_id"] = trace_id if trace_id
    attrs
  end

  # The active OTel trace id (hex) if a span is recording - the correlation id a
  # support agent uses to pull this user's recent activity from the backend.
  def current_otel_trace_id
    span = OpenTelemetry::Trace.current_span
    return nil unless span&.context&.valid?

    span.context.hex_trace_id
  rescue StandardError
    nil
  end

  def resolve_context(context_proc)
    context_proc.call(self)
  rescue StandardError => e
    LogUtil.log_error(
      "[user_action] resolve_context: context resolver raised: #{e.class}: #{e.message}",
      exception: e
    )
    {}
  end

  # Drop any sensitive keys and stringify - belt-and-suspenders so the action log
  # only ever carries identifiers.
  def sanitize_action_attributes(attributes)
    return {} unless attributes.is_a?(Hash)

    attributes.each_with_object({}) do |(key, value), acc|
      key_s = key.to_s
      next if value.nil?
      next if ACTION_LOG_SENSITIVE_KEYS.any? { |bad| key_s.downcase.include?(bad) }

      acc[key_s] = value
    end
  end

  # Structured log line, independent of trace export, so the signal survives even
  # where OTLP is not configured. JSON payload = easy to grep / index for triage.
  def emit_action_log(action_name, attributes, outcome:, error_class:)
    payload = attributes.merge(
      "event"       => "user_action",
      "action"      => action_name,
      "outcome"     => outcome,
      "error_class" => error_class,
    ).compact
    Rails.logger.info("[user_action] emit_action_log: #{action_name}", **payload)
  rescue StandardError => e
    LogUtil.log_error(
      "[user_action] emit_action_log: failed to emit log for #{action_name}: #{e.class}: #{e.message}",
      exception: e,
      action_name: action_name,
      outcome: outcome,
      error_class: error_class,
      attributes: attributes
    )
  end
end
