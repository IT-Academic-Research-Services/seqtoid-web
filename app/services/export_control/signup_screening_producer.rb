# frozen_string_literal: true

# SMP-1854 -- the PRE-ACCOUNT screening producer. Builds a screening payload from the signup form fields
# (there is no User yet) and hands it to the standalone screening service's ASYNC ingest
# (Internal::ScreeningsController, POST /internal/v1/screenings) via ScreeningServiceClient. The ingest
# returns 202 immediately; the real verdict arrives later by signed callback, which provisions the account
# (approved) or emails a denial (denied). This producer therefore NEVER provisions and NEVER blocks on the
# vendor -- provisioning happens only in the callback path.
#
# It mirrors Providers::ScreeningServiceHttp.submit (same payload shape, same post_signed call, same
# configured? guard). The only fields that change source -- because there is no User -- are:
#   correlation_id  "Signup:<uuid>"   (was "User:#{id}")
#   subject.name    first + last      (was user.name)
#   account.name    first + last      (was user.name)
#   account.email   form email        (was user.email)
#   soptionalid     "0"               (was user.id.to_s; Descartes wants "0" or a table-keyed id, and there
#                                       is no row pre-account -- verdicts correlate on sdistributedid anyway)
# subject.company/address1/city/state/zip/country and account.institution come straight from the form,
# exactly as the existing method takes them from its caller's ctx.
#
# FAIL-CLOSED in every branch -- the caller lands the applicant on the pending page regardless:
#   :skipped_unconfigured  client not configured (dev/unset) -> nothing sent, nobody provisioned
#   :failed                transport/post error              -> nothing sent, nobody provisioned
#   :submitted             202 accepted                      -> verdict + provisioning arrive by callback
module ExportControl
  module SignupScreeningProducer
    module_function

    def submit(fields)
      return :skipped_unconfigured unless ExportControl::ScreeningServiceClient.configured?

      ExportControl::ScreeningServiceClient.post_signed(
        ExportControl::ScreeningServiceClient.screenings_url,
        payload_json(fields)
      )
      :submitted
    rescue StandardError => e
      # Never raise into the request. Log the CLASS only -- an HTTP error can echo request-body fragments
      # (the applicant's name). Fail-closed: nothing was screened, nobody is provisioned, caller -> pending.
      Rails.logger.error("[SignupScreeningProducer] submit failed: #{e.class}")
      :failed
    end

    def payload_json(fields)
      name = full_name(fields)
      JSON.dump(
        correlation_id: "Signup:#{SecureRandom.uuid}",
        subject: {
          name: name,
          company: fields[:institution],
          address1: fields[:address1],
          city: fields[:city],
          state: fields[:state],
          zip: fields[:zip],
          country: fields[:country],
        },
        account: {
          email: fields[:email],
          name: name,
          institution: fields[:institution],
        },
        soptionalid: "0",
        callback_url: ExportControl::ScreeningServiceClient.callback_url
      )
    end

    def full_name(fields)
      [fields[:name_first], fields[:name_last]].map { |part| part.to_s.strip }.reject(&:blank?).join(" ")
    end
  end
end
