# frozen_string_literal: true

# SMP-1901 -- local sidecar row for a pre-account CZ ID data-transfer request from the anonymous
# export-control signup form. Written at signup (keyed by the normalized signup email), copied onto the
# User at provisioning, then deleted. It is kept entirely inside the app DB and is NEVER sent through the
# export-control screening payload. A backstop purge (DeleteUnclaimedUserAccounts) removes rows never
# claimed within 90 days.
class CzidTransferRequest < ApplicationRecord
  # Validate the CZ ID email as an email FORMAT only (same rule as the User column). It is deliberately not
  # checked against anything. Presence-when-requested is enforced at the signup form (server-side), so this
  # stays lenient.
  validates :email, presence: true, uniqueness: true
  validates :czid_account_email, format: {
    with: URI::MailTo::EMAIL_REGEXP, message: "must be a valid email address",
  }, allow_blank: true

  # The storage/lookup key: strip surrounding whitespace and downcase, so signup-time writes and
  # provisioning-time reads match regardless of casing/whitespace. (UserFactoryService downcases the email
  # it creates the User with, so the User's email normalizes to this same key.)
  def self.normalize_email(raw)
    raw.to_s.strip.downcase
  end

  # Upsert the request for a signup email; the latest submission wins. When the transfer is not requested,
  # the row is still written (wants=false) with no CZ ID email, so a later opt-out overwrites an earlier
  # opt-in rather than leaving a stale email.
  def self.record!(email:, wants:, czid_account_email:)
    row = find_or_initialize_by(email: normalize_email(email))
    row.wants_czid_data_transferred = wants
    row.czid_account_email = wants ? czid_account_email.to_s.strip.presence : nil
    row.save!
    row
  end
end
