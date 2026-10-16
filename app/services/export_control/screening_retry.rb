# frozen_string_literal: true

# Automatic re-screen of signups whose Descartes screen ERRORED (timeout, transport failure, vendor-side
# error, missing config). A fail-closed error hold means Visual Compliance never screened the applicant, so
# there is no Incident Manager case and no officer will ever decide it; before this, such a signup sat held
# until an operator released it by hand (2026-10-12: Descartes timeouts left applicants stuck for days).
#
# Run by ResolveScreeningHolds every 15 minutes (so it inherits that job's enable flag, queue and per-env
# schedule exclusion). For each PENDING signup with an active error hold and a stored screened party, it
# re-runs the original screen through ProcessScreeningJob once the backoff has elapsed:
#   - Descartes clean      -> approved callback (account provisioned), signup resolved, error hold released.
#   - Descartes match      -> screening_hit hold for an officer; the error hold is superseded.
#   - another error        -> stays held (same error hold); the next attempt waits longer.
# Backoff: 15m, 30m, 1h, 2h, 4h, then every 6h, for MAX_ATTEMPTS attempts (~1.5 days). When the last
# attempt still errors it alerts once (screen.retry_exhausted) and stops; the operator backstop is
# `rake export_control:release_error_holds`. Never makes a decision itself: every outcome is Descartes'.
module ExportControl
  module ScreeningRetry
    module_function

    MAX_ATTEMPTS = 10
    BASE_DELAY = 15.minutes
    MAX_DELAY = 6.hours

    # Retry every due signup. Returns the number re-screened. Never raises (it runs ahead of the verdict
    # poll), but a sweep failure alerts.
    def run(now: Time.current)
      due_signups(now).count { |signup| retry_signup(signup, now) }
    rescue StandardError => e
      ExportControl::ScreeningAudit.report_failure('screen.retry_sweep_failed', error: e)
      0
    end

    # Pending signups with an active fail-closed error hold, a stored screened party, attempts left, and
    # the backoff for their next attempt elapsed.
    def due_signups(now)
      refs = Hold.active.where(reason: Hold::REASON_SCREENING_ERROR)
                 .where('subject_ref LIKE ?', 'Signup:%').distinct.pluck(:subject_ref)
      return [] if refs.empty?

      PendingSignup.pending.where(subject_ref: refs).where('screen_attempts < ?', MAX_ATTEMPTS)
                   .order(:id).select { |signup| signup.subject_payload.present? && due?(signup, now) }
    end

    def due?(signup, now)
      last = signup.last_screen_attempt_at || signup.created_at
      now >= last + delay_for(signup.screen_attempts)
    end

    # Delay before attempt n+1, given n attempts already made: 15m, 30m, 1h, 2h, 4h, 6h, 6h, ...
    def delay_for(attempts)
      [BASE_DELAY * (2**attempts), MAX_DELAY].min
    end

    # One re-screen. The attempt is stamped BEFORE screening so a crash mid-screen still backs off instead
    # of hammering the vendor every run.
    def retry_signup(signup, now)
      signup.update!(screen_attempts: signup.screen_attempts + 1, last_screen_attempt_at: now)
      ProcessScreeningJob.new.run(signup.retry_payload)
      ExportControl::ScreeningAudit.record(
        'screen.retried', subject_ref: signup.subject_ref, attempt: signup.screen_attempts
      )
      alert_if_exhausted(signup)
      true
    rescue StandardError => e
      # PII-safe alert (class only, never the message -- it could carry the screened party's name).
      ExportControl::ScreeningAudit.report_failure('screen.retry_failed', error: e, subject_ref: signup.subject_ref)
      false
    end

    # After the last allowed attempt, if Visual Compliance still could not screen the applicant, alert once
    # (later runs skip the signup because it has no attempts left).
    def alert_if_exhausted(signup)
      return if signup.screen_attempts < MAX_ATTEMPTS
      return unless Hold.active.exists?(subject_ref: signup.subject_ref, reason: Hold::REASON_SCREENING_ERROR)

      ExportControl::ScreeningAudit.report_failure(
        'screen.retry_exhausted', subject_ref: signup.subject_ref, attempts: signup.screen_attempts
      )
    end
  end
end
