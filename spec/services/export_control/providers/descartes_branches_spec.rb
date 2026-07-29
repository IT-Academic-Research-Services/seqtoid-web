require 'rails_helper'

# Branch coverage for the Descartes provider-contract adapter: the enabled? -> delegate path (the OFF
# path is covered by descartes_spec.rb) and the safe-navigation arms of subject_for. No network: the
# ScreeningService is always a double here.
RSpec.describe ExportControl::Providers::Descartes, type: :service do
  let(:user) { create(:user, name: "Ada Lovelace") }

  describe '.screen when Descartes screening is ENABLED' do
    let(:service) { instance_double(ExportControl::ScreeningService, enabled?: true) }

    before do
      allow(ExportControl::ScreeningService).to receive(:new).and_return(service)
    end

    it 'delegates to the screening service and maps a clear outcome onto the contract result' do
      outcome = ExportControl::ScreeningService::Outcome.new(decision: :allowed, screening_result: nil, hold: nil)
      expect(service).to receive(:screen) do |subject|
        expect(subject.subject_ref).to eq("User:#{user.id}")
        outcome
      end

      result = described_class.screen(user, company: 'Analytical Engines Ltd')

      expect(result.result).to eq(ExportControlClearance::SCREENING_CLEAR)
      expect(result.provider).to eq('descartes')
    end

    it 'maps a held outcome onto SCREENING_HIT (never clear)' do
      outcome = ExportControl::ScreeningService::Outcome.new(decision: :held, screening_result: nil, hold: nil)
      allow(service).to receive(:screen).and_return(outcome)

      result = described_class.screen(user)

      expect(result.result).to eq(ExportControlClearance::SCREENING_HIT)
      expect(result.result).not_to eq(ExportControlClearance::SCREENING_CLEAR)
    end
  end

  describe '.subject_for' do
    it 'builds a table-keyed subject from a real user plus the context fields' do
      subject_struct = described_class.subject_for(
        user,
        company: 'Analytical Engines Ltd', address1: '1 Bridge St', city: 'London',
        state: 'LDN', zip: 'EC1', country: 'GB'
      )

      expect(subject_struct.subject_ref).to eq("User:#{user.id}")
      expect(subject_struct.subject_type).to eq('User')
      expect(subject_struct.name).to eq('Ada Lovelace')
      expect(subject_struct.soptionalid).to eq(user.id.to_s)
      expect(subject_struct.company).to eq('Analytical Engines Ltd')
      expect(subject_struct.city).to eq('London')
      expect(subject_struct.country).to eq('GB')
    end

    it 'never raises on a nil user -- every user-derived field degrades to nil' do
      subject_struct = described_class.subject_for(nil, {})

      expect(subject_struct.subject_ref).to eq('User:')
      expect(subject_struct.name).to be_nil
      expect(subject_struct.soptionalid).to be_nil
      expect(subject_struct.company).to be_nil
    end

    it 'leaves soptionalid nil when the user has no persisted id' do
      subject_struct = described_class.subject_for(User.new(name: 'Unsaved'), {})

      expect(subject_struct.subject_ref).to eq('User:')
      expect(subject_struct.name).to eq('Unsaved')
      expect(subject_struct.soptionalid).to be_nil
    end
  end

  describe '.pending_result' do
    it 'is PENDING and attributed to the descartes provider with no evidence' do
      result = described_class.pending_result

      expect(result.result).to eq(ExportControlClearance::SCREENING_PENDING)
      expect(result.provider).to eq(ExportControl::ScreeningService::PROVIDER)
      expect(result.evidence_ref).to be_nil
    end
  end
end
