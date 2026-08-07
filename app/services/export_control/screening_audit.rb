# frozen_string_literal: true

# SMP-1253 (Export-control Layer 3 -- audit trail / diagnostic logging).
#
# The DIAGNOSTIC + CORRELATION half of the screening audit requirements. The compliance
# system-of-record stays in the DB (append-only screening_results + holds); this module
# only adds the OpenTelemetry/structured-log layer on top of those durable rows:
#   - current_trace_id: the active OTel trace id, stamped into each screening_results /
#     holds row so a compliance record cross-links to its distributed trace.
#   - record: an OTel span-attribute set + an ALWAYS-ON structured [screening_audit] log
#     line for each screening decision (allowed / held / error), so the signal exists even
#     where OTLP export is off (it lands in CloudWatch Logs, queryable for triage).
#
# Builds ON the existing OTel SDK (config/initializers/opentelemetry.rb, #426); it does NOT
# configure OTel -- when OTLP is unset the tracer is a no-op and current_trace_id is nil, so
# local/test/CI stay silent. Modeled on OtelActionLogging (CZID-472).
#
# NO-PII BY DESIGN: a screened party's name / company / address MUST NEVER reach a span or a
# log line -- only opaque identifiers (subject_ref, decision, alert_level, ids). SENSITIVE_KEYS
# is a defensive denylist so a careless future call site cannot leak PII into the audit signal.
#
# INERT-SAFE: nothing here ever raises into the screening path -- a logging failure must not
# turn an ALLOW into an error or vice-versa. The whole thing is dead code until the Descartes
# ScreeningService is enabled behind its OFF-by-default flag.
module ExportControl
  module ScreeningAudit
    TRACER_NAME = "czid.export_control.screening"
    ATTR_PREFIX = "czid.screening"
    LOG_MARKER = "[screening_audit]"

    # Defensive PII denylist: any attribute whose key contains one of these is dropped before it
    # reaches a span or log line. Screened-party identity details live only in the vendor's system
    # and (by reference) in raw_response_ref -- never in observability signals.
    #
    # ssecno / spassword are the Descartes REQUEST-BODY credentials (search_entity_client.rb). They are
    # latent here today -- no call site passes them -- but the credential rides in the same body as the
    # screened party's identity, which is exactly the payload most likely to get attached to a diagnostic
    # or error path later (SMP-1690 / gap C-121). Denylisting them now keeps a careless future call site
    # from leaking a live credential into a span or log line.
    SENSITIVE_KEYS = %w[
      name company address address1 city state zip country email phone
      ssecno spassword
    ].freeze

    module_function

    # The active OTel trace id (hex) if a span is recording, else nil. This is the correlation id
    # stamped into the durable screening_results / holds rows so each audit record points at its
    # trace. Never raises (returns nil if OTel is absent/unconfigured).
    def current_trace_id
      span = OpenTelemetry::Trace.current_span
      return nil unless span&.context&.valid?

      span.context.hex_trace_id
    rescue StandardError
      nil
    end

    # Record one screening decision: set attributes on the current span (best-effort) and emit an
    # always-on structured log line. `event` is e.g. "screen.allowed" / "screen.held" / "screen.error".
    # attributes are IDENTIFIERS ONLY -- sanitized against SENSITIVE_KEYS. Never raises.
    def record(event, attributes = {})
      attrs = sanitize(attributes)
      set_span_attributes(event, attrs)
      emit_log(event, attrs)
    rescue StandardError => e
      Rails.logger.error("#{LOG_MARKER} failed to record #{event}: #{e.class}: #{e.message}")
    end

    # Drop any sensitive keys and stringify -- belt-and-suspenders so the audit signal only ever
    # carries identifiers, even if a call site passes a whole Subject by mistake.
    def sanitize(attributes)
      return {} unless attributes.is_a?(Hash)

      attributes.each_with_object({}) do |(key, value), acc|
        key_s = key.to_s
        next if value.nil?
        next if SENSITIVE_KEYS.any? { |bad| key_s.downcase.include?(bad) }

        acc[key_s] = value
      end
    end

    # Tag the current span with the decision + identifiers, so a trace is filterable by
    # "czid.screening.event". No-op when no span is recording. Never raises.
    def set_span_attributes(event, attrs)
      span = OpenTelemetry::Trace.current_span
      return unless span&.context&.valid?

      span_attrs = { "#{ATTR_PREFIX}.event" => event }
      attrs.each { |k, v| span_attrs["#{ATTR_PREFIX}.#{k}"] = v }
      span.add_attributes(span_attrs)
    rescue StandardError
      nil
    end

    # Structured log line, independent of trace export, so the signal survives where OTLP is off.
    # JSON payload = easy to grep / index for compliance triage.
    def emit_log(event, attrs)
      payload = attrs.merge(
        "event" => "screening_audit",
        "screening_event" => event
      ).compact
      Rails.logger.info("#{LOG_MARKER} #{payload.to_json}")
    end
  end
end
