# frozen_string_literal: true

require 'rails_helper'

# Option A / piece 5b -- the held applicant record the resolution poller drives account provisioning from.
RSpec.describe PendingSignup, type: :model do
  describe 'validations' do
    it 'requires a subject_ref' do
      expect(build(:pending_signup, subject_ref: nil)).not_to be_valid
    end

    it 'requires a known status' do
      expect(build(:pending_signup, status: 'weird')).not_to be_valid
    end
  end

  describe 'application-layer encryption of the applicant identity' do
    it 'round-trips the encrypted columns' do
      row = create(:pending_signup, account_email: 'a@ucsf.edu', account_name: 'A B', account_institution: 'UCSF')
      reloaded = described_class.find(row.id)
      expect(reloaded.account_email).to eq('a@ucsf.edu')
      expect(reloaded.account_name).to eq('A B')
      expect(reloaded.account_institution).to eq('UCSF')
    end

    it 'does not store the plaintext identity in the column' do
      row = create(:pending_signup, account_email: 'secret-applicant@ucsf.edu')
      raw = described_class.connection.select_value(
        described_class.sanitize_sql(["SELECT account_email FROM pending_signups WHERE id = ?", row.id])
      )
      expect(raw).not_to include('secret-applicant@ucsf.edu')
    end
  end

  describe '.hold!' do
    it 'creates a pending signup for the subject' do
      expect do
        described_class.hold!(subject_ref: 'User:1', screening_id: 'scr-1',
                              callback_url: 'http://web/cb', account: { 'email' => 'x@ucsf.edu', 'name' => 'X', 'institution' => 'UCSF' })
      end.to change(described_class, :count).by(1)

      row = described_class.pending_for('User:1')
      expect(row.callback_url).to eq('http://web/cb')
      expect(row.account_payload).to eq('email' => 'x@ucsf.edu', 'name' => 'X', 'institution' => 'UCSF')
    end

    it 'is idempotent: a replay updates the existing pending row, not a duplicate' do
      described_class.hold!(subject_ref: 'User:2', screening_id: 'scr-2', callback_url: 'http://web/cb', account: { 'email' => 'a@ucsf.edu' })
      expect do
        described_class.hold!(subject_ref: 'User:2', screening_id: 'scr-2b', callback_url: 'http://web/cb2', account: { 'email' => 'a@ucsf.edu' })
      end.not_to change(described_class, :count)
      expect(described_class.pending_for('User:2').screening_id).to eq('scr-2b')
    end

    it 'accepts a blank account (holds nothing to seed but records the pending state)' do
      row = described_class.hold!(subject_ref: 'User:3', screening_id: 'scr-3', callback_url: 'http://web/cb', account: nil)
      expect(row).to be_persisted
      expect(row.account_payload).to eq({})
    end
  end

  describe '#resolve!' do
    it 'marks the signup resolved with the decision, and is idempotent' do
      row = create(:pending_signup, subject_ref: 'User:4')
      expect(row.resolve!(decision: described_class::DECISION_APPROVED)).to be_truthy
      expect(row.reload.status).to eq(described_class::STATUS_RESOLVED)
      expect(row.decision).to eq(described_class::DECISION_APPROVED)
      expect(described_class.pending_for('User:4')).to be_nil

      # A second resolve! is a no-op (keeps the first decision).
      row.resolve!(decision: described_class::DECISION_DENIED)
      expect(row.reload.decision).to eq(described_class::DECISION_APPROVED)
    end
  end

  describe '.pending_for' do
    it 'returns only the still-pending signup for the subject' do
      create(:pending_signup, :resolved, subject_ref: 'User:5')
      expect(described_class.pending_for('User:5')).to be_nil
      live = create(:pending_signup, subject_ref: 'User:5')
      expect(described_class.pending_for('User:5')).to eq(live)
    end
  end
end
