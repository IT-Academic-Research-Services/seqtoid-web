# frozen_string_literal: true

require 'rails_helper'

# Unit coverage for the screening-callback -> export-control-clearance write-back. Proves the fail-closed
# decision mapping, the no-downgrade / no-manufacture-of-verification posture, idempotency (find-and-update
# in place, never stacking duplicate rows), and the correlation-id parsing.
RSpec.describe ExportControl::ClearanceCallback do
  let(:user) { create(:user) }

  # The in-flight clearance row the controller writes before handoff: screening still pending.
  def pending_clearance(for_user = user)
    create(:export_control_clearance, :screening_pending, user: for_user,
                                                          screening_provider: 'screening_service')
  end

  def payload(decision:, correlation: "User:#{user.id}", **extra)
    { 'correlation_id' => correlation, 'decision' => decision }.merge(extra.transform_keys(&:to_s))
  end

  describe 'approved (clean screen)' do
    it 'flips the pending clearance to CLEAR so the gate is satisfied, without a new row' do
      clearance = pending_clearance
      expect do
        described_class.apply(payload(decision: 'approved', screening_id: 'scr-1'))
      end.not_to change { ExportControlClearance.where(user_id: user.id).count }

      expect(clearance.reload.screening_result).to eq(ExportControlClearance::SCREENING_CLEAR)
      expect(ExportControlClearance.current_clearance_satisfied?(user)).to be(true)
    end

    it 'leaves verification_status untouched on update (write-back only touches screening fields)' do
      # The document-IDV verification lane is retired and no longer gates; the write-back must never write
      # or clobber verification_status, only the screening_* fields. Guard that it stays exactly as-is.
      clearance = pending_clearance
      before = clearance.verification_status
      described_class.apply(payload(decision: 'approved'))
      expect(clearance.reload.verification_status).to eq(before)
    end

    it 'records the screening evidence ref (top-level screening_id)' do
      clearance = pending_clearance
      described_class.apply(payload(decision: 'approved', screening_id: 'scr-evidence'))
      expect(clearance.reload.screening_evidence_ref).to eq('scr-evidence')
    end

    it 'accepts a nested screening_result sdistributedid as the evidence ref' do
      clearance = pending_clearance
      described_class.apply(payload(decision: 'approved', screening_result: { 'sdistributedid' => '2953953' }))
      expect(clearance.reload.screening_evidence_ref).to eq('2953953')
    end

    it 'is idempotent across repeated approved callbacks (no duplicate clear rows)' do
      pending_clearance
      expect do
        3.times { described_class.apply(payload(decision: 'approved', screening_id: 'scr-1')) }
      end.to change { ExportControlClearance.where(user_id: user.id).count }.by(0)
      expect(ExportControlClearance.current_clearance_satisfied?(user)).to be(true)
    end
  end

  describe 'fail-closed decisions' do
    it 'denied -> HIT, and the user stays blocked' do
      clearance = pending_clearance
      described_class.apply(payload(decision: 'denied'))
      expect(clearance.reload.screening_result).to eq(ExportControlClearance::SCREENING_HIT)
      expect(ExportControlClearance.current_clearance_satisfied?(user)).to be(false)
    end

    ['held', 'blocked', 'error', 'pending', 'weird', '', nil].each do |decision|
      it "#{decision.inspect} writes nothing -- the clearance stays pending (blocked)" do
        clearance = pending_clearance
        expect { described_class.apply(payload(decision: decision)) }
          .not_to change { clearance.reload.screening_result }
        expect(ExportControlClearance.current_clearance_satisfied?(user)).to be(false)
      end
    end

    it 'is a no-op when no prior clearance row exists: never manufactures a satisfying row (fail-closed)' do
      # No clearance row exists. Under the screening-only gate (passed == screening_result CLEAR), creating a
      # CLEAR row from a callback alone would admit a user who never completed the controller's attestation
      # flow -- so the write-back only UPDATEs an existing row and writes NOTHING here. User stays blocked.
      expect do
        described_class.apply(payload(decision: 'approved', screening_id: 'scr-x'))
      end.not_to change { ExportControlClearance.where(user_id: user.id).count }

      expect(ExportControlClearance.where(user_id: user.id)).to be_empty
      expect(ExportControlClearance.current_clearance_satisfied?(user)).to be(false)
    end
  end

  describe 'correlation' do
    it 'no-ops when the correlation id is malformed' do
      pending_clearance
      expect { described_class.apply(payload(decision: 'approved', correlation: 'garbage')) }
        .not_to change { ExportControlClearance.passed.where(user_id: user.id).count }
    end

    it 'no-ops when the correlated user does not exist' do
      expect { described_class.apply('correlation_id' => 'User:999999', 'decision' => 'approved') }
        .not_to change { ExportControlClearance.count }
    end

    it 'only touches the CURRENT clearance version' do
      stale = create(:export_control_clearance, :screening_pending, :stale_version, user: user)
      current = pending_clearance
      described_class.apply(payload(decision: 'approved'))

      expect(current.reload.screening_result).to eq(ExportControlClearance::SCREENING_CLEAR)
      expect(stale.reload.screening_result).to eq(ExportControlClearance::SCREENING_PENDING)
    end
  end
end
