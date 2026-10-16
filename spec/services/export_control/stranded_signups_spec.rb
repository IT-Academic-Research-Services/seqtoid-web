# frozen_string_literal: true

require 'rails_helper'

# Recovery for applicants who fell through signup screening: officer-cleared, but nothing to provision from.
RSpec.describe ExportControl::StrandedSignups do
  def cleared_hold(subject_ref, reason: Hold::REASON_SANCTIONED_JURISDICTION)
    create(:hold, subject_ref: subject_ref, reason: reason, released_at: Time.current,
                  disposition: Hold::DISPOSITION_RELEASED, resolution_status: 'Cleared', incident_id: '555')
  end

  describe '.report' do
    it 'lists officer-cleared signup holds that have no signup record' do
      stranded = cleared_hold('Signup:stranded')
      cleared_hold('Signup:ok').tap { |h| create(:pending_signup, :resolved, subject_ref: h.subject_ref) }
      cleared_hold('Signup:recovered').tap do |h|
        create(:denied_signup, subject_ref: h.subject_ref, reinstated_at: Time.current, reinstated_by: 'officer')
      end
      create(:hold, subject_ref: 'Signup:active') # still active, not cleared
      cleared_hold('User:9') # not a signup

      rows = described_class.report
      expect(rows.map(&:hold_id)).to eq([stranded.id])
      expect(rows.first.incident_id).to eq('555')
    end
  end

  describe '.reinstate!' do
    let(:url) { 'http://web/internal/v1/screening_result' }

    it 'archives the applicant, posts the signed approval callback, and records the recovery' do
      hold = cleared_hold('Signup:r1')
      captured = nil
      allow(ExportControl::ScreeningServiceClient).to receive(:post_signed) { |_u, body| captured = JSON.parse(body) }

      denied = described_class.reinstate!(hold_id: hold.id, email: 'Person@Example.org', name: 'Some Person',
                                          institution: 'Inst', operator: 'tom', callback_url: url)

      expect(captured).to include('decision' => 'approved', 'correlation_id' => 'Signup:r1', 'path' => 'manual')
      expect(captured['account']).to eq('email' => 'person@example.org', 'name' => 'Some Person', 'institution' => 'Inst')
      expect(denied).to be_reinstated
      expect(denied.reinstated_by).to eq('recovery:tom')
      expect(denied.hold_id).to eq(hold.id)
      expect(described_class.report).to be_empty
    end

    it 'refuses a hold that was not cleared by an officer' do
      hold = create(:hold, subject_ref: 'Signup:r2')
      expect do
        described_class.reinstate!(hold_id: hold.id, email: 'a@b.org', name: 'A', operator: 'tom', callback_url: url)
      end.to raise_error(described_class::Error, /not cleared/)
    end

    it 'refuses a subject that already has a signup record (never double-provision)' do
      hold = cleared_hold('Signup:r3')
      create(:pending_signup, :resolved, subject_ref: 'Signup:r3')
      expect do
        described_class.reinstate!(hold_id: hold.id, email: 'a@b.org', name: 'A', operator: 'tom', callback_url: url)
      end.to raise_error(described_class::Error, /already has a signup record/)
    end

    it 'refuses without an operator or an email' do
      hold = cleared_hold('Signup:r4')
      expect { described_class.reinstate!(hold_id: hold.id, email: 'a@b.org', name: 'A', operator: '', callback_url: url) }
        .to raise_error(described_class::Error, /operator/)
      expect { described_class.reinstate!(hold_id: hold.id, email: '', name: 'A', operator: 'tom', callback_url: url) }
        .to raise_error(described_class::Error, /email/)
    end

    it 'refuses a non-signup hold' do
      hold = cleared_hold('User:5')
      expect do
        described_class.reinstate!(hold_id: hold.id, email: 'a@b.org', name: 'A', operator: 'tom', callback_url: url)
      end.to raise_error(described_class::Error, /not a signup hold/)
    end
  end
end
