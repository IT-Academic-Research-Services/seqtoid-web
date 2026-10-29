# frozen_string_literal: true

# Recovery for applicants who fell through signup screening (see ExportControl::StrandedSignups).
#
#   rake export_control:stranded_report
#     Lists officer-CLEARED signup holds that have no signup record. Look each applicant up in Descartes
#     Incident Manager by the printed incident id to get their name / email / institution.
#
#   OPERATOR=<you> rake "export_control:reinstate_cleared[<hold_id>,<email>,<name>,<institution>]"
#     Provisions ONE such applicant's account through the normal approval callback (DB user, Auth0 user,
#     activation email) and records the recovery. Run on the screening-service role (screening DB + signing).
namespace :export_control do
  desc 'List officer-cleared signup holds with no signup record (stranded applicants)'
  task stranded_report: :environment do
    rows = ExportControl::StrandedSignups.report
    puts 'hold_id,screened_utc,country,cleared_utc,status,incident_id,subject_ref'
    rows.each do |r|
      puts [r.hold_id, r.screened_at&.utc&.strftime('%F %R'), r.country, r.cleared_at&.utc&.strftime('%F %R'),
            r.resolution_status, r.incident_id, r.subject_ref,].join(',')
    end
    warn "#{rows.size} stranded applicant(s)"
  end

  desc 'Provision ONE officer-cleared stranded applicant. ' \
       'Usage: OPERATOR=<you> rake "export_control:reinstate_cleared[<hold_id>,<email>,<name>,<institution>]"'
  task :reinstate_cleared, [:hold_id, :email, :name, :institution] => :environment do |_t, args|
    denied = ExportControl::StrandedSignups.reinstate!(
      hold_id: args[:hold_id], email: args[:email], name: args[:name], institution: args[:institution],
      operator: ENV.fetch('OPERATOR', nil)
    )
    puts "Reinstated #{denied.subject_ref} (hold #{denied.hold_id}); approval callback posted."
  rescue ExportControl::StrandedSignups::Error => e
    abort("Not reinstated: #{e.message}")
  end
end
