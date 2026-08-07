require 'rails_helper'

# SMP-1687 -- the compliance-administrator emails. Proves recipients/subject routing and that the body
# carries IDENTIFIERS ONLY (no screened-party PII -- that lives in the Descartes Incident Manager).
RSpec.describe ComplianceMailer, type: :mailer do
  describe '#screening_hold_placed' do
    subject(:mail) do
      described_class.screening_hold_placed(
        recipients: ["compliance@ucsf.edu", "ops@ucsf.edu"],
        hold_id: 7, subject_ref: "User:42", screening_result_id: 5, alert_level: "red", trace_id: "abc123"
      )
    end

    it 'addresses all recipients with an adjudication subject naming the hold' do
      expect(mail.to).to eq(["compliance@ucsf.edu", "ops@ucsf.edu"])
      expect(mail.subject).to eq("[Export Control] Screening hold requires adjudication (hold #7)")
    end

    it 'includes the identifiers and points to the Incident Manager' do
      body = mail.body.encoded
      expect(body).to include("7", "User:42", "red", "5", "abc123")
      expect(body).to match(/Incident Manager/i)
    end

    it 'omits the trace line when there is no trace id' do
      m = described_class.screening_hold_placed(
        recipients: ["c@ucsf.edu"], hold_id: 1, subject_ref: "User:1",
        screening_result_id: nil, alert_level: nil, trace_id: nil
      )
      expect(m.body.encoded).not_to match(/Trace ID/)
    end
  end

  describe '#screening_error_alert' do
    subject(:mail) do
      described_class.screening_error_alert(
        recipients: ["compliance@ucsf.edu"], hold_id: 9, subject_ref: "User:99", trace_id: "zzz"
      )
    end

    it 'flags it as an operational action item naming the hold' do
      expect(mail.to).to eq(["compliance@ucsf.edu"])
      expect(mail.subject).to eq("[Export Control][ACTION] Screening fail-closed error -- vendor path may be down (hold #9)")
    end

    it 'frames it as an operational incident with identifiers only' do
      body = mail.body.encoded
      expect(body).to include("9", "User:99", "zzz")
      expect(body).to match(/ACTION REQUIRED/i)
    end
  end
end
