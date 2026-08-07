require 'rails_helper'

# SMP-1253 -- the diagnostic/correlation audit layer for Descartes screening. Proves the no-PII
# discipline and inert-safety WITHOUT any live tracing (OTLP is off in test, so current_trace_id is
# nil and spans are no-ops); the durable compliance record is tested elsewhere (screening_result_spec).
RSpec.describe ExportControl::ScreeningAudit do
  describe '.sanitize' do
    it 'keeps identifiers and drops PII-ish keys' do
      out = described_class.sanitize(
        subject_ref: 'User:42', decision: 'held', alert_level: 'red', hold_id: 7,
        name: 'Wayne Smith', company: 'ACME', address1: '1 Main St', city: 'Baghdad',
        state: 'NA', zip: '00000', country: 'IQ', email: 'x@y.z', phone: '555'
      )
      expect(out).to eq('subject_ref' => 'User:42', 'decision' => 'held', 'alert_level' => 'red', 'hold_id' => 7)
      %w[name company address1 city state zip country email phone].each { |k| expect(out).not_to have_key(k) }
    end

    it 'drops the Descartes credential keys ssecno / spassword (SMP-1690 / gap C-121)' do
      out = described_class.sanitize(subject_ref: 'User:42', ssecno: '12345', spassword: 'secretpw')
      expect(out).to eq('subject_ref' => 'User:42')
      expect(out).not_to have_key('ssecno')
      expect(out).not_to have_key('spassword')
    end

    it 'drops nil values and stringifies keys' do
      expect(described_class.sanitize(subject_ref: 'User:1', trace_id: nil)).to eq('subject_ref' => 'User:1')
    end

    it 'returns an empty hash for a non-hash argument' do
      expect(described_class.sanitize(nil)).to eq({})
      expect(described_class.sanitize('oops')).to eq({})
    end
  end

  describe '.current_trace_id' do
    it 'is nil when no span is recording (OTLP off in test)' do
      expect(described_class.current_trace_id).to be_nil
    end
  end

  describe '.record' do
    it 'emits an always-on [screening_audit] structured log line carrying the event' do
      allow(Rails.logger).to receive(:info).and_call_original
      described_class.record('screen.held', subject_ref: 'User:42', decision: 'held', hold_id: 7)
      # Order-independent: JSON key order is not part of the contract.
      expect(Rails.logger).to have_received(:info).with(
        satisfy do |s|
          s.include?('[screening_audit]') &&
            s.include?('"screening_event":"screen.held"') &&
            s.include?('"subject_ref":"User:42"')
        end
      )
    end

    it 'never lets a denylisted key reach the log payload' do
      allow(Rails.logger).to receive(:info).and_call_original
      described_class.record('screen.allowed', subject_ref: 'User:42', name: 'Wayne Smith', address1: '1 Main St')
      expect(Rails.logger).not_to have_received(:info).with(a_string_matching(/Wayne|Main St/))
    end

    it 'never raises, even on a malformed attribute payload' do
      expect { described_class.record('screen.error', nil) }.not_to raise_error
      expect { described_class.record('screen.error', 'not-a-hash') }.not_to raise_error
    end
  end
end
