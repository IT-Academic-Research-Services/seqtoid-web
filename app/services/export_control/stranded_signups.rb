# frozen_string_literal: true

module ExportControl
  # Recovery for signup applicants who FELL THROUGH screening (2026-10-16): a compliance officer cleared their
  # case in Descartes, but the signup had nothing on our side to provision from -- the sanctioned-jurisdiction
  # auto-deny never persisted the applicant (fixed going forward by archiving into denied_signups). Their name
  # and email exist only in Descartes (look them up by the incident id this report prints).
  #
  # report     -> officer-CLEARED signup holds with no pending signup and no reinstated denial.
  # reinstate! -> for ONE such hold, archive the applicant identity an operator copied from Descartes and post
  #               the signed APPROVED callback, so the web app provisions the account exactly as a normal
  #               clearance would (DB user, Auth0 user, activation email). Every guard fails closed.
  module StrandedSignups
    Row = Struct.new(:hold_id, :subject_ref, :reason, :country, :screened_at, :cleared_at, :resolution_status,
                     :incident_id, keyword_init: true)

    class Error < StandardError; end

    module_function

    def report
      Hold.where.not(released_at: nil).where(disposition: Hold::DISPOSITION_RELEASED)
          .where('subject_ref LIKE ?', 'Signup:%').includes(:screening_result).order(:released_at)
          .reject { |hold| handled?(hold.subject_ref) }
          .map { |hold| row_for(hold) }
    end

    def reinstate!(hold_id:, email:, name:, operator:, institution: nil, callback_url: nil)
      raise Error, 'operator is required (who is running this recovery)' if operator.to_s.strip.blank?
      raise Error, 'email is required' if email.to_s.strip.blank?

      hold = Hold.find_by(id: hold_id) || raise(Error, "hold #{hold_id} not found")
      raise Error, "hold #{hold.id} is not a signup hold" unless hold.subject_ref.to_s.start_with?('Signup:')
      unless hold.released_at.present? && hold.disposition == Hold::DISPOSITION_RELEASED
        raise Error, "hold #{hold.id} was not cleared by a compliance officer"
      end
      raise Error, "subject #{hold.subject_ref} already has a signup record" if handled?(hold.subject_ref)

      url = callback_url.presence || default_callback_url
      raise Error, 'no callback url available' if url.blank?

      account = { 'email' => email.to_s.strip.downcase, 'name' => name.to_s.strip,
                  'institution' => institution.to_s.strip.presence, }.compact
      denied = DeniedSignup.archive!(
        subject_ref: hold.subject_ref, reason: hold.reason, decided_by: DeniedSignup::DECIDED_BY_AUTO,
        account: account, callback_url: url, resolution_status: hold.resolution_status,
        screening_result_id: hold.screening_result_id, hold_id: hold.id
      )
      body = JSON.dump(
        { correlation_id: hold.subject_ref, decision: PendingSignup::DECISION_APPROVED, path: 'manual',
          account: account, }
      )
      ExportControl::ScreeningServiceClient.post_signed(url, body)
      denied.update!(reinstated_at: Time.current, reinstated_by: "recovery:#{operator.to_s.strip}")
      ExportControl::ScreeningAudit.record(
        'signup.recovered', subject_ref: hold.subject_ref, hold_id: hold.id, operator: operator.to_s.strip,
                            provider: 'descartes'
      )
      denied
    end

    # A signup is handled once it has ANY pending/resolved signup row or a REINSTATED denial. (An open,
    # un-reinstated auto-denial is exactly what the poller reinstates on its own after the archive fix.)
    def handled?(subject_ref)
      PendingSignup.for_subject(subject_ref).exists? ||
        DeniedSignup.for_subject(subject_ref).where.not(reinstated_at: nil).exists?
    end

    def default_callback_url
      ExportControl::ScreeningServiceClient.callback_url.presence ||
        PendingSignup.where.not(callback_url: [nil, '']).order(id: :desc).pick(:callback_url)
    end

    def row_for(hold)
      result = hold.screening_result
      Row.new(hold_id: hold.id, subject_ref: hold.subject_ref, reason: hold.reason, country: result&.country,
              screened_at: result&.screened_at, cleared_at: hold.released_at, resolution_status: hold.resolution_status,
              incident_id: hold.incident_id || result&.incident_id)
    end
  end
end
