# frozen_string_literal: true

# Applies the standalone screening service's signed decision callback to the correlated user's
# export-control CLEARANCE record. This is the write-back that was missing: a genuinely clean screen
# (decision=approved) reached the callback receiver, 200'd, and enqueued account provisioning -- but
# NOTHING ever flipped ExportControlClearance#screening_result from "pending" to "clear". The user's
# clearance stayed verified+pending forever, so ExportControlClearance.current_clearance_satisfied? was
# false and every screened-clean user was blocked at the Layer-3 gate on prod login.
#
# ONE write point resolves BOTH callback sources, because both POST the same signed body to the same
# /internal/v1/screening_result receiver with correlation_id "User:<id>":
#   1. the SYNC auto-approve callback ProcessScreeningJob posts the moment a screen comes back clean, and
#   2. the SAFETY-NET callback ResolveScreeningHolds posts when a compliance officer later clears a
#      previously-held screen (drive_signup_callback -> approved/denied).
# Whichever lands first satisfies the clearance; a later re-delivery is an idempotent no-op.
#
# FAIL-CLOSED (unchanged posture -- this only makes a genuine pass reach the clearance, it never broadens
# who passes):
#   - decision=approved -> screening_result=SCREENING_CLEAR (the only path that can satisfy the gate).
#   - decision=denied   -> screening_result=SCREENING_HIT (durable deny evidence; still blocked).
#   - any other/unknown/held/error decision -> writes NOTHING; the clearance stays pending (= blocked).
#   - verification_status is NEVER downgraded and NEVER manufactured -- a user with no verified identity
#     stays unsatisfied even on an approved screen.
#
# IDEMPOTENT: we find-and-update the user's CURRENT-version clearance row in place (the verified+pending
# row ExportControlClearancesController#create wrote), so at-least-once callback delivery never stacks
# duplicate clear rows.
module ExportControl
  module ClearanceCallback
    # Recorded on the clearance so the evidence row names the source of the outcome.
    PROVIDER_NAME = 'screening_service'

    module_function

    # Entry point: apply one decision callback payload to the correlated user's clearance. No-op (returns
    # nil) when the payload does not correlate to a user or the decision is not one that writes a clearance.
    def apply(payload)
      user = correlated_user(payload['correlation_id'])
      return if user.nil?

      result = screening_result_for(payload['decision'])
      return if result.nil? # held / error / pending / unknown -> leave pending (fail-closed)

      upsert_current_clearance(user, result, evidence_ref_from(payload))
    end

    # "User:<id>" -> the User, or nil for a blank / malformed correlation id or an unknown user id.
    def correlated_user(correlation_id)
      id = correlation_id.to_s[/\AUser:(\d+)\z/, 1]
      return nil if id.blank?

      User.find_by(id: id)
    end

    # Map the service's decision vocabulary onto a screening outcome. Only approved clears; denied records
    # a hit. Everything else returns nil so NOTHING is written and the pending clearance keeps blocking.
    def screening_result_for(decision)
      case decision.to_s
      when 'approved' then ExportControlClearance::SCREENING_CLEAR
      when 'denied'   then ExportControlClearance::SCREENING_HIT
      end
    end

    # The service's opaque screening id is the compliance evidence pointer. Accept a top-level screening_id
    # or a nested screening_result id / sdistributedid, whichever shape the service sent; nil is acceptable.
    def evidence_ref_from(payload)
      nested = payload['screening_result']
      nested = {} unless nested.is_a?(Hash)
      payload['screening_id'].presence ||
        nested['sdistributedid'].presence ||
        nested['id'].presence
    end

    # Find-or-update the user's CURRENT-version clearance. We update the existing in-flight row in place
    # rather than appending a second row, so repeated callbacks never stack duplicate clear rows.
    # verification_status is left exactly as-is -- we never downgrade a verified identity here.
    def upsert_current_clearance(user, screening_result, evidence_ref)
      version = ExportControlClearance::CURRENT_VERSION
      clearance = ExportControlClearance
                  .for_version(version)
                  .where(user_id: user.id)
                  .order(created_at: :desc, id: :desc)
                  .first

      if clearance
        # Idempotent: already in the target state -> no-op (do not churn the evidence row).
        return if clearance.screening_result == screening_result &&
                  (evidence_ref.blank? || clearance.screening_evidence_ref == evidence_ref)

        clearance.update!(
          screening_result: screening_result,
          screening_evidence_ref: evidence_ref.presence || clearance.screening_evidence_ref,
          screening_provider: PROVIDER_NAME
        )
      else
        # No current-version row exists yet (the callback outran, or outlived, the controller's row). Record
        # the screening outcome as evidence, but FAIL-CLOSED on verification: with no verified-identity
        # evidence here, verification_status is PENDING, so an approved screen alone does NOT satisfy the
        # gate. This never admits a user who lacks a real verification -- it only preserves the evidence.
        ExportControlClearance.create!(
          user: user,
          verification_status: ExportControlClearance::VERIFICATION_PENDING,
          screening_result: screening_result,
          screening_provider: PROVIDER_NAME,
          screening_evidence_ref: evidence_ref,
          clearance_version: version
        )
      end
    end
  end
end
