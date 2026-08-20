# frozen_string_literal: true

# ActiveRecord::Encryption keys for the export-control screening store (PendingSignup applicant PII --
# Option A / piece 5b). This is the ONLY place the app uses application-layer encryption; it is additive
# defense on top of the screening cluster's at-rest KMS encryption + network isolation.
#
# Keys come from the environment (the screening-service role gets them from its Chamber namespace). In
# dev / test we fall back to fixed, NON-SECRET local keys so specs and a local console can round-trip the
# encrypted columns without any setup -- these are deliberately not secret and are never used in a
# deployed env (there the ENV values, seeded by chamber, are authoritative; if they are absent the columns
# simply stay unconfigured and only the screening-service role -- which has them -- writes these rows).
#
# support_unencrypted_data = true so a row written before keys were configured (the dark state) still
# reads back, and so the web-role pods -- which never WRITE pending_signups -- boot fine without keys.
Rails.application.configure do
  # Deterministic-free config: none of the encrypted columns are queried by value, so we do not enable
  # deterministic encryption for them; the deterministic key is still provided because the framework
  # requires all three to be set together.
  config.active_record.encryption.support_unencrypted_data = true

  local_fallback = !Rails.env.production? && !Rails.env.to_s.start_with?("prod", "staging", "sandbox", "env-prod")

  primary_key = ENV["ACTIVE_RECORD_ENCRYPTION_PRIMARY_KEY"].presence
  deterministic_key = ENV["ACTIVE_RECORD_ENCRYPTION_DETERMINISTIC_KEY"].presence
  key_derivation_salt = ENV["ACTIVE_RECORD_ENCRYPTION_KEY_DERIVATION_SALT"].presence

  if local_fallback
    # Fixed, non-secret local keys -- dev/test only. NOT a credential.
    primary_key ||= "screening_dev_primary_key_do_not_use_in_prod"
    deterministic_key ||= "screening_dev_deterministic_key_do_not_use"
    key_derivation_salt ||= "screening_dev_key_derivation_salt_do_not_use"
  end

  if primary_key && deterministic_key && key_derivation_salt
    config.active_record.encryption.primary_key = primary_key
    config.active_record.encryption.deterministic_key = deterministic_key
    config.active_record.encryption.key_derivation_salt = key_derivation_salt
  end
end
