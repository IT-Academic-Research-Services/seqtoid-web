# frozen_string_literal: true

require 'rails_helper'

# Denied applicants are archived (not dropped) so the denial is a durable compliance record.
RSpec.describe DeniedSignup, type: :model do
  describe 'validations' do
    it 'requires a subject_ref, a reason, a known decider and a denial time' do
      expect(build(:denied_signup)).to be_valid
      expect(build(:denied_signup, subject_ref: nil)).not_to be_valid
      expect(build(:denied_signup, reason: nil)).not_to be_valid
      expect(build(:denied_signup, decided_by: 'robot')).not_to be_valid
      expect(build(:denied_signup, denied_at: nil)).not_to be_valid
    end
  end

  it 'encrypts the applicant identity at the application layer and round-trips it' do
    row = create(:denied_signup, account_email: 'x@example.org', account_name: 'X Y', account_institution: 'Inst')
    raw = described_class.connection.select_one("SELECT account_email FROM denied_signups WHERE id = #{row.id}")
    expect(raw['account_email']).not_to include('x@example.org')
    expect(described_class.find(row.id).account_payload)
      .to eq('email' => 'x@example.org', 'name' => 'X Y', 'institution' => 'Inst')
  end

  describe '.archive!' do
    it 'creates a denial with the account and evidence links' do
      row = described_class.archive!(
        subject_ref: 'Signup:a', reason: Hold::REASON_SANCTIONED_JURISDICTION, decided_by: 'auto',
        account: { 'email' => 'a@example.org', 'name' => 'A' }, screening_id: 'scr-a', screening_result_id: 7, hold_id: 9
      )
      expect(row).to be_persisted
      expect(row.account_email).to eq('a@example.org')
      expect([row.screening_result_id, row.hold_id]).to eq([7, 9])
      expect(row.denied_at).to be_present
    end

    it 'is idempotent per subject: a replayed deny updates the open row instead of stacking duplicates' do
      described_class.archive!(subject_ref: 'Signup:b', reason: 'screening_hit', decided_by: 'officer',
                               account: { 'email' => 'b@example.org' })
      expect do
        described_class.archive!(subject_ref: 'Signup:b', reason: 'screening_hit', decided_by: 'officer',
                                 resolution_status: 'True Hit')
      end.not_to change(described_class, :count)
      row = described_class.for_subject('Signup:b').sole
      expect(row.resolution_status).to eq('True Hit')
      expect(row.account_email).to eq('b@example.org') # not wiped by a replay without an account
    end

    it 'starts a new row once the earlier denial was reinstated (history is kept)' do
      first = create(:denied_signup, subject_ref: 'Signup:c', reinstated_at: Time.current, reinstated_by: 'officer')
      expect do
        described_class.archive!(subject_ref: 'Signup:c', reason: 'screening_hit', decided_by: 'officer')
      end.to change(described_class, :count).by(1)
      expect(first.reload).to be_reinstated
    end
  end
end
