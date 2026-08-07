# frozen_string_literal: true

# SMP-1692 -- operator backstop for fail-closed screening ERROR holds.
#
# A screening_error hold (screening_result_id NULL) is placed when the Descartes screen fails closed
# (transport/timeout/misconfig). It CANNOT be adjudicated by the Incident-Manager poller -- there is no
# incident. Normally it is released automatically the next time the subject is re-screened clean
# (ExportControl::ScreeningService#release_error_holds). This task is the manual escape hatch for a hold
# that stays stuck (e.g. a subject who never comes back, or a persistently failing vendor path that has
# since been fixed out-of-band). It releases ONLY error holds, never a real screening_hit hold.
namespace :export_control do
  desc 'Release fail-closed screening ERROR holds for a subject (SMP-1692). ' \
       'Usage: rake "export_control:release_error_holds[User:42]"'
  task :release_error_holds, [:subject_ref] => :environment do |_t, args|
    ref = args[:subject_ref].to_s.strip
    abort('subject_ref required, e.g. rake "export_control:release_error_holds[User:42]"') if ref.blank?

    holds = Hold.for_subject(ref).active.where(reason: Hold::REASON_SCREENING_ERROR).to_a
    if holds.empty?
      puts "No active screening_error holds for #{ref}."
      next
    end

    holds.each { |hold| hold.release!(resolution_status: 'operator-released') }
    ExportControl::ScreeningAudit.record(
      'screen.error_hold_released_by_operator',
      subject_ref: ref, decision: 'error_hold_released', count: holds.size,
      operator: ENV.fetch('USER', 'unknown'), provider: 'descartes'
    )
    puts "Released #{holds.size} screening_error hold(s) for #{ref}."
  end
end
