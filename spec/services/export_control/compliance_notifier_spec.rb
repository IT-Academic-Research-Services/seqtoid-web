require 'rails_helper'

# SMP-1687 -- compliance-administrator notification when a screening hold is placed. Proves the routing
# (hit vs error), the INERT default (no recipient => no-op), and INERT-SAFETY (a mail/enqueue failure
# never raises back into the screening path).
RSpec.describe ExportControl::ComplianceNotifier do
  let(:mail) { instance_double(ActionMailer::MessageDelivery, deliver_later: true) }

  def configure_recipient(value)
    allow(AppConfigHelper).to receive(:get_app_config)
      .with(AppConfig::EXPORT_CONTROL_COMPLIANCE_RECIPIENT).and_return(value)
  end

  describe '.configured_recipients' do
    it 'splits on comma / semicolon / whitespace and trims blanks' do
      configure_recipient("a@ucsf.edu, b@ucsf.edu; c@ucsf.edu\n  d@ucsf.edu ")
      expect(described_class.configured_recipients)
        .to eq(%w[a@ucsf.edu b@ucsf.edu c@ucsf.edu d@ucsf.edu])
    end

    it 'is empty when unset (inert default)' do
      configure_recipient("")
      expect(described_class.configured_recipients).to eq([])
      configure_recipient(nil)
      expect(described_class.configured_recipients).to eq([])
    end
  end

  describe '.notify_hold' do
    context 'with no recipient configured' do
      before { configure_recipient("") }

      it 'sends nothing and does not raise' do
        expect(ComplianceMailer).not_to receive(:screening_hold_placed)
        expect(ComplianceMailer).not_to receive(:screening_error_alert)
        expect { described_class.notify_hold(build_stubbed(:hold)) }.not_to raise_error
      end
    end

    context 'with a recipient configured' do
      before { configure_recipient("compliance@ucsf.edu") }

      it 'routes a screening_hit to screening_hold_placed with identifiers only and enqueues it' do
        hold = build_stubbed(:hold) # default reason = screening_hit, with a :red screening_result
        allow(ComplianceMailer).to receive(:screening_hold_placed).and_return(mail)

        described_class.notify_hold(hold)

        expect(ComplianceMailer).to have_received(:screening_hold_placed).with(
          recipients: ["compliance@ucsf.edu"],
          hold_id: hold.id,
          subject_ref: hold.subject_ref,
          screening_result_id: hold.screening_result_id,
          alert_level: hold.screening_result.alert_level,
          trace_id: hold.trace_id
        )
        expect(mail).to have_received(:deliver_later)
      end

      it 'routes a screening_error to screening_error_alert' do
        hold = build_stubbed(:hold, :error)
        allow(ComplianceMailer).to receive(:screening_error_alert).and_return(mail)

        described_class.notify_hold(hold)

        expect(ComplianceMailer).to have_received(:screening_error_alert).with(
          recipients: ["compliance@ucsf.edu"], hold_id: hold.id, subject_ref: hold.subject_ref, trace_id: hold.trace_id
        )
        expect(mail).to have_received(:deliver_later)
      end

      it 'sends nothing for an unrecognized reason' do
        hold = build_stubbed(:hold)
        allow(hold).to receive(:reason).and_return("something_else")
        expect(ComplianceMailer).not_to receive(:screening_hold_placed)
        expect(ComplianceMailer).not_to receive(:screening_error_alert)
        described_class.notify_hold(hold)
      end

      it 'never raises into the caller when the mailer blows up (inert-safe)' do
        hold = build_stubbed(:hold)
        allow(ComplianceMailer).to receive(:screening_hold_placed).and_raise(StandardError, "smtp down")
        allow(Rails.logger).to receive(:error)

        expect { described_class.notify_hold(hold) }.not_to raise_error
        expect(Rails.logger).to have_received(:error).with(/compliance_notifier.*smtp down/)
      end
    end
  end

  describe 'Hold after_create_commit wiring' do
    it 'invokes the notifier when a hold is committed' do
      configure_recipient("compliance@ucsf.edu")
      allow(described_class).to receive(:notify_hold)
      hold = create(:hold)
      expect(described_class).to have_received(:notify_hold).with(hold)
    end
  end
end
