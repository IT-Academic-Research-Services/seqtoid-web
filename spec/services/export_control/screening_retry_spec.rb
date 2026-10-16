# frozen_string_literal: true

require 'rails_helper'

# Automatic re-screen of signups held on a fail-closed vendor ERROR, so every applicant reaches Visual
# Compliance instead of sitting held until someone releases it by hand.
RSpec.describe ExportControl::ScreeningRetry do
  let(:svc) { instance_double(ExportControl::ScreeningService) }
  let(:subject_hash) { { 'name' => 'Jane Doe', 'country' => 'KE', 'address1' => '1 Main St' } }

  before { allow(ExportControl::ScreeningService).to receive(:new).and_return(svc) }

  def errored_signup(ref = 'Signup:abc', attempts: 0, last: 1.day.ago, subject: subject_hash)
    create(:hold, :error, subject_ref: ref)
    signup = PendingSignup.hold!(subject_ref: ref, screening_id: 'scr-9', callback_url: 'http://web/cb',
                                 account: { 'email' => 'jane@example.edu', 'name' => 'Jane Doe' },
                                 subject: subject, soptionalid: '0')
    signup.update!(screen_attempts: attempts, last_screen_attempt_at: last)
    signup
  end

  def outcome(decision)
    ExportControl::ScreeningService::Outcome.new(decision: decision, screening_result: nil, hold: nil)
  end

  describe '.delay_for' do
    it 'backs off 15m, 30m, 1h, 2h, 4h, then caps at 6h' do
      expect((0..6).map { |n| described_class.delay_for(n) / 60 }).to eq([15, 30, 60, 120, 240, 360, 360])
    end
  end

  describe '.due_signups' do
    it 'picks a pending signup with an active error hold, a stored subject, attempts left and backoff elapsed' do
      due = errored_signup
      errored_signup('Signup:recent', last: 1.minute.ago)
      errored_signup('Signup:no-subject', subject: nil)
      errored_signup('Signup:spent', attempts: described_class::MAX_ATTEMPTS)
      create(:pending_signup, subject_ref: 'Signup:no-hold', subject_payload: JSON.dump(subject_hash))
      create(:hold, :error, subject_ref: 'User:7') # not a signup

      expect(described_class.due_signups(Time.current)).to eq([due])
    end
  end

  describe '.run' do
    it 'a clean re-screen posts the approval, resolves the signup and counts the attempt' do
      signup = errored_signup
      allow(svc).to receive(:screen_if_enabled).and_return(outcome(:allowed))
      captured = nil
      allow(ExportControl::ScreeningServiceClient).to receive(:post_signed) { |_url, body| captured = JSON.parse(body) }

      expect(described_class.run).to eq(1)

      expect(captured['decision']).to eq('approved')
      expect(captured['correlation_id']).to eq('Signup:abc')
      expect(captured['account']['email']).to eq('jane@example.edu')
      expect(signup.reload.status).to eq(PendingSignup::STATUS_RESOLVED)
      expect(signup.screen_attempts).to eq(1)
    end

    it 're-screens with the stored subject details' do
      errored_signup
      expect(svc).to receive(:screen_if_enabled) do |subject|
        expect(subject.country).to eq('KE')
        expect(subject.subject_ref).to eq('Signup:abc')
        outcome(:error)
      end
      described_class.run
    end

    it 'another error keeps the signup pending, counts the attempt and waits longer next time' do
      signup = errored_signup
      allow(svc).to receive(:screen_if_enabled).and_return(outcome(:error))
      expect(ExportControl::ScreeningServiceClient).not_to receive(:post_signed)

      described_class.run
      expect(signup.reload.status).to eq(PendingSignup::STATUS_PENDING)
      expect(signup.screen_attempts).to eq(1)
      expect(described_class.due_signups(Time.current)).to be_empty # backoff just restarted
    end

    it 'alerts once when the last attempt still cannot reach Visual Compliance' do
      errored_signup(attempts: described_class::MAX_ATTEMPTS - 1)
      allow(svc).to receive(:screen_if_enabled).and_return(outcome(:error))
      allow(ExportControl::ScreeningAudit).to receive(:report_failure)

      described_class.run
      expect(ExportControl::ScreeningAudit).to have_received(:report_failure)
        .with('screen.retry_exhausted', subject_ref: 'Signup:abc', attempts: described_class::MAX_ATTEMPTS)
      expect(described_class.due_signups(1.week.from_now)).to be_empty # no further attempts
    end

    it 'does not alert when the last attempt got through' do
      errored_signup(attempts: described_class::MAX_ATTEMPTS - 1)
      allow(svc).to receive(:screen_if_enabled) do
        Hold.active.where(reason: Hold::REASON_SCREENING_ERROR).find_each(&:release!)
        outcome(:allowed)
      end
      allow(ExportControl::ScreeningServiceClient).to receive(:post_signed)
      expect(ExportControl::ScreeningAudit).not_to receive(:report_failure)

      described_class.run
    end

    it 'never raises; a sweep failure alerts and returns 0' do
      allow(described_class).to receive(:due_signups).and_raise(StandardError, 'db down')
      allow(ExportControl::ScreeningAudit).to receive(:report_failure)

      expect(described_class.run).to eq(0)
      expect(ExportControl::ScreeningAudit).to have_received(:report_failure)
        .with('screen.retry_sweep_failed', hash_including(:error))
    end
  end
end
