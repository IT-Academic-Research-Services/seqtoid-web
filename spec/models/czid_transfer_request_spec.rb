# frozen_string_literal: true

require 'rails_helper'

# SMP-1901 -- the local sidecar that holds a pre-account CZ ID data-transfer request between the anonymous
# signup form and provisioning. These specs pin the two behaviors provisioning relies on: a stable
# normalized key, and latest-submission-wins upsert semantics.
RSpec.describe CzidTransferRequest do
  describe '.normalize_email' do
    it 'strips surrounding whitespace and downcases' do
      expect(described_class.normalize_email("  Ada@Example.ORG  ")).to eq("ada@example.org")
    end

    it 'is nil-safe' do
      expect(described_class.normalize_email(nil)).to eq("")
    end
  end

  describe '.record!' do
    it 'writes the request and CZ ID email, keyed by the normalized email' do
      row = described_class.record!(email: "  Ada@Example.ORG ", wants: true, czid_account_email: " ada@czid.org ")
      expect(row.email).to eq("ada@example.org")
      expect(row.wants_czid_data_transferred).to be(true)
      expect(row.czid_account_email).to eq("ada@czid.org")
    end

    it 'writes false with NO CZ ID email when the transfer is not requested' do
      row = described_class.record!(email: "ada@example.org", wants: false, czid_account_email: "ignored@czid.org")
      expect(row.wants_czid_data_transferred).to be(false)
      expect(row.czid_account_email).to be_nil
    end

    it 'upserts (latest submission wins) rather than stacking rows for the same email' do
      described_class.record!(email: "ada@example.org", wants: true, czid_account_email: "old@czid.org")
      expect do
        described_class.record!(email: "ADA@example.org", wants: true, czid_account_email: "new@czid.org")
      end.not_to change(described_class, :count)

      expect(described_class.find_by(email: "ada@example.org").czid_account_email).to eq("new@czid.org")
    end

    it 'lets a later opt-out clear an earlier opt-in email' do
      described_class.record!(email: "ada@example.org", wants: true, czid_account_email: "ada@czid.org")
      described_class.record!(email: "ada@example.org", wants: false, czid_account_email: nil)

      row = described_class.find_by(email: "ada@example.org")
      expect(row.wants_czid_data_transferred).to be(false)
      expect(row.czid_account_email).to be_nil
    end
  end

  describe 'validations' do
    it 'rejects a malformed CZ ID email (format only)' do
      row = described_class.new(email: "ada@example.org", wants_czid_data_transferred: true,
                                czid_account_email: "not-an-email")
      expect(row).not_to be_valid
      expect(row.errors[:czid_account_email]).to be_present
    end

    it 'enforces one row per email' do
      described_class.create!(email: "ada@example.org")
      dup = described_class.new(email: "ada@example.org")
      expect(dup).not_to be_valid
    end
  end
end
