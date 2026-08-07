# CZID-601 (Export-control Layer 3 / #285) -- operator diagnostic to run ONE live Descartes SearchEntity
# screen against the configured (sandbox) RPS endpoint, once real credentials exist. This is NOT part of
# any request path and does NOT persist a screening_results / holds row -- it calls the client directly
# and prints the parsed transstatus / alert / correlation ids so an operator can confirm connectivity and
# credentials during onboarding (design doc #595, Section 7).
#
# CREDS-GATED / NO-OP WHEN UNSET: reads DESCARTES_RPS_ENDPOINT / DESCARTES_RPS_SECNO /
# DESCARTES_RPS_PASSWORD from the environment (Chamber/SSM at runtime -- never the repo). With any of
# them missing it prints a clear message and exits cleanly (no network call). Nothing here runs on the
# default path; an operator invokes it by hand.
#
# SMP-1688 (gap C-118): although this task writes NO screening_results / holds row (it is a diagnostic,
# by design), a live SearchEntity call still transmits a real party's identifiers OUTSIDE the UCSF
# boundary. That transmission MUST leave durable UCSF-side evidence. So this task now:
#   (a) HONOURS the same OFF-by-default flag as ScreeningService (AppConfig::ENABLE_DESCARTES_SCREENING):
#       when it is not "1" the task REFUSES to transmit -- no client is built, no network call is made --
#       so the diagnostic cannot leak a live screen while the feature is meant to be dark.
#   (b) Requires an explicit operator confirmation (CONFIRM=1) before any live transmission, so the
#       diagnostic cannot fire by accident.
#   (c) Emits an ExportControl::ScreeningAudit.record(...) for every invocation -- IDENTIFIERS ONLY
#       (subject_ref / decision / provider / correlation ids), NEVER the screened party's name/address,
#       matching how ScreeningService audits its decisions (SMP-1253). The audit is inert-safe: a
#       ScreeningAudit failure can never be the thing that crashes the task.
#
# Usage:
#   CONFIRM=1 bundle exec rake 'export_control:vc:test_screen[Wayne Smith,,US]'
#   CONFIRM=1 NAME="Wayne Smith" COUNTRY=US bundle exec rake export_control:vc:test_screen
namespace :export_control do
  namespace :vc do
    desc 'Run one live Descartes SearchEntity screen against the configured sandbox (flag+confirm gated)'
    task :test_screen, [:name, :company, :country] => :environment do |_t, args|
      provider = ExportControl::ScreeningService::PROVIDER
      subject_ref = 'rake:test_screen'

      # Inert-safe audit: identifiers only, and a ScreeningAudit failure must never crash the task.
      # (ScreeningAudit.record already rescues internally; the extra rescue is belt-and-suspenders.)
      audit = lambda do |decision, extra = {}|
        ExportControl::ScreeningAudit.record(
          'screen.connectivity_check',
          { subject_ref: subject_ref, decision: decision, provider: provider }.merge(extra)
        )
      rescue StandardError => e
        warn "[export_control:vc:test_screen] audit emit failed (ignored): #{e.class}: #{e.message}"
      end

      # SMP-1688 (a): honour the same OFF-by-default flag as ScreeningService#enabled?. While the feature
      # is meant to be dark, REFUSE to transmit -- no client, no network call.
      unless AppConfigHelper.get_app_config(AppConfig::ENABLE_DESCARTES_SCREENING) == '1'
        puts '[export_control:vc:test_screen] REFUSED: Descartes screening is disabled ' \
             "(AppConfig #{AppConfig::ENABLE_DESCARTES_SCREENING} != \"1\")."
        puts '  This diagnostic will not transmit a live screen while the feature is dark. Enable the ' \
             'flag deliberately before running. No network call was made.'
        audit.call('refused_flag_off')
        next
      end

      config = ExportControl::Descartes::SearchEntityClient::Config.from_env
      unless config.configured?
        puts '[export_control:vc:test_screen] SKIPPED: Descartes RPS credentials are not configured.'
        puts '  Set DESCARTES_RPS_ENDPOINT, DESCARTES_RPS_SECNO, and DESCARTES_RPS_PASSWORD ' \
             '(Chamber/SSM) to run a live sandbox screen. No network call was made.'
        audit.call('skipped_unconfigured')
        next
      end

      name = args[:name].presence || ENV['NAME']
      company = args[:company].presence || ENV['COMPANY']
      country = args[:country].presence || ENV['COUNTRY']
      if name.blank? && company.blank?
        puts '[export_control:vc:test_screen] ERROR: provide a name or company to screen ' \
             '(rake args or NAME=/COMPANY= env).'
        audit.call('no_subject')
        next
      end

      # SMP-1688 (b): require an explicit operator confirmation before any live transmission, so the
      # diagnostic cannot fire by accident.
      unless ENV['CONFIRM'] == '1'
        puts '[export_control:vc:test_screen] REFUSED: live transmission not confirmed. Re-run with ' \
             'CONFIRM=1 to transmit this party outside the UCSF boundary. No network call was made.'
        audit.call('unconfirmed')
        next
      end

      subject = ExportControl::ScreeningService::Subject.new(
        subject_ref: subject_ref, subject_type: 'Diagnostic',
        name: name, company: company, country: country,
        soptionalid: '0' # diagnostic; not a table-keyed screen (no DB row is written)
      )

      puts "[export_control:vc:test_screen] screening name=#{name.inspect} company=#{company.inspect} " \
           "country=#{country.inspect} against #{config.endpoint} ..."
      # SMP-1688 (c): record that a live transmission is about to happen -- identifiers only, no PII.
      # This is the durable UCSF-side evidence that a real party's details left the boundary.
      audit.call('transmit')
      begin
        response = ExportControl::Descartes::SearchEntityClient.new(config: config)
                   .search(subject, soptionalid: '0')
      rescue ExportControl::Descartes::SearchEntityClient::Error => e
        # Fail-closed everywhere else means HOLD; here (a diagnostic) we just report the failure clearly.
        puts "[export_control:vc:test_screen] FAILED (fail-closed -> would HOLD in production): " \
             "#{e.class}: #{e.message}"
        audit.call('error', error_class: e.class.name)
        next
      end

      decision = response.transstatus == ScreeningResult::TRANSSTATUS_PASSED ? 'allowed' : 'held'
      # Identifiers only -- transstatus/alert_level/sdistributedid are opaque correlation values, no PII.
      audit.call(
        decision,
        transstatus: response.transstatus, alert_level: response.alert_level,
        sdistributedid: response.sdistributedid, errored: response.errored?
      )

      puts '[export_control:vc:test_screen] OK. Parsed response:'
      puts "  transstatus    : #{response.transstatus.inspect} " \
           "(#{decision == 'allowed' ? 'would ALLOW' : 'would HOLD'})"
      puts "  alert_level    : #{response.alert_level}"
      puts "  risk_country   : #{response.risk_country.inspect}"
      puts "  sdistributedid : #{response.sdistributedid.inspect} (poll correlation key)"
      puts "  list           : #{response.list.inspect}"
      puts "  errored?       : #{response.errored?}"
    end
  end
end
