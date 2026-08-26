# frozen_string_literal: true

# SMP-1687 -- emails to the export-control compliance administrator when a restricted-party screening
# HOLD is placed. Recipient(s) come from AppConfig::EXPORT_CONTROL_COMPLIANCE_RECIPIENT via
# ExportControl::ComplianceNotifier (which no-ops when unset). Bodies carry IDENTIFIERS ONLY -- never the
# screened party's name/address (that lives in the Descartes Incident Manager). See ComplianceNotifier.
class ComplianceMailer < ApplicationMailer
  # A screening hit placed a hold: a compliance officer must adjudicate it in the Descartes Incident
  # Manager, then ResolveScreeningHolds (SMP CZID-598) polls the verdict back and releases/keeps the hold.
  def screening_hold_placed(recipients:, hold_id:, subject_ref:, screening_result_id:, alert_level:, trace_id:)
    @hold_id = hold_id
    @subject_ref = subject_ref
    @screening_result_id = screening_result_id
    @alert_level = alert_level
    @trace_id = trace_id
    mail(to: recipients, subject: "[Export Control] Screening hold requires adjudication (hold ##{hold_id})")
  end

  # A fail-closed ERROR hold: the vendor screening path errored/timed out, so the user was blocked with
  # NO screening evidence row. This is an OPERATIONAL incident (the Descartes path may be down), not a
  # normal adjudication -- flagged as [ACTION] so it is triaged, not just adjudicated.
  def screening_error_alert(recipients:, hold_id:, subject_ref:, trace_id:)
    @hold_id = hold_id
    @subject_ref = subject_ref
    @trace_id = trace_id
    mail(to: recipients, subject: "[Export Control][ACTION] Screening fail-closed error -- vendor path may be down (hold ##{hold_id})")
  end
end
