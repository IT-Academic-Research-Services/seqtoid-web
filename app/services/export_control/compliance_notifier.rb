# frozen_string_literal: true

# SMP-1687 (Export-control Layer 3 / #285) -- notify the compliance administrator when a screening
# HOLD is placed.
#
# SMP-1251's hold workflow required "notify compliance administrator", but nothing here ever told a
# human. A hold was SILENT: ScreeningService writes a holds row, the user is blocked fail-closed, and
# adjudication happens in the Descartes Incident Manager -- but a person had to know to go look, or the
# user stayed blocked indefinitely. This closes that gap.
#
# Triggered by Hold#after_create_commit, so every hold (hit or fail-closed error) notifies once, after
# the row is durably committed -- including future dynamic-screening (SMP-1254) holds, with no extra
# wiring.
#
# Design mirrors ExportControl::ScreeningAudit:
#   - INERT by default: no recipient configured (AppConfig::EXPORT_CONTROL_COMPLIANCE_RECIPIENT blank)
#     => no-op. The screening core ships dark; so does its notification.
#   - INERT-SAFE: NEVER raises into the caller. A mail/enqueue failure must not turn a placed hold into
#     an exception on the request path (the hold is already the fail-closed outcome; the notice is
#     best-effort on top). All errors are rescued and logged.
#   - NO screened-party PII: only identifiers cross the boundary (hold id, subject_ref, reason,
#     alert_level, screening_result id, trace id). The party's name/address live ONLY in the vendor's
#     Incident Manager and (by reference) in raw_response_ref -- never in an email.
module ExportControl
  module ComplianceNotifier
    LOG_MARKER = "[compliance_notifier]"

    module_function

    # Notify the configured compliance recipient about a newly placed hold. Best-effort; never raises.
    def notify_hold(hold)
      return unless hold.respond_to?(:reason)

      recipients = configured_recipients
      return if recipients.empty? # inert: no recipient configured

      mail = build_mail(hold, recipients)
      return if mail.nil? # unknown reason -> nothing to send

      mail.deliver_later
      Rails.logger.info(
        "#{LOG_MARKER} notified #{recipients.size} recipient(s) of hold_id=#{hold.id} reason=#{hold.reason}"
      )
    rescue StandardError => e
      # A notification failure must never break the screening/hold path.
      Rails.logger.error("#{LOG_MARKER} failed to notify for hold_id=#{hold&.id}: #{e.class}: #{e.message}")
      nil
    end

    # The configured recipient list, split on comma/semicolon/whitespace, blanks removed.
    def configured_recipients
      raw = AppConfigHelper.get_app_config(AppConfig::EXPORT_CONTROL_COMPLIANCE_RECIPIENT).to_s
      raw.split(/[,;\s]+/).map(&:strip).reject(&:blank?)
    end

    # Route by hold reason to the right ComplianceMailer action. A screening_hit is an adjudication task;
    # a screening_error is an operational incident (the fail-closed vendor path is broken). Returns nil
    # for an unrecognized reason so notify_hold sends nothing rather than guessing.
    def build_mail(hold, recipients)
      case hold.reason
      when Hold::REASON_SCREENING_HIT
        ComplianceMailer.screening_hold_placed(
          recipients: recipients,
          hold_id: hold.id,
          subject_ref: hold.subject_ref,
          screening_result_id: hold.screening_result_id,
          alert_level: hold.screening_result&.alert_level,
          trace_id: hold.trace_id
        )
      when Hold::REASON_SCREENING_ERROR
        ComplianceMailer.screening_error_alert(
          recipients: recipients,
          hold_id: hold.id,
          subject_ref: hold.subject_ref,
          trace_id: hold.trace_id
        )
      end
    end
  end
end
