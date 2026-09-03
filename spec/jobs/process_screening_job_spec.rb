# frozen_string_literal: true

require 'rails_helper'

RSpec.describe ProcessScreeningJob do
  let(:payload) do
    {
      'screening_id' => 'scr-1', 'correlation_id' => 'User:42', 'soptionalid' => '42',
      'subject' => { 'name' => 'Jane Doe', 'country' => 'US', 'address1' => '1 Main St' },
      'account' => { 'email' => 'jane@ucsf.edu', 'name' => 'Jane Doe' },
      'callback_url' => 'http://web/internal/v1/screening_result',
    }
  end
  let(:svc) { instance_double(ExportControl::ScreeningService) }

  before { allow(ExportControl::ScreeningService).to receive(:new).and_return(svc) }

  def outcome(decision)
    ExportControl::ScreeningService::Outcome.new(decision: decision, screening_result: nil, hold: nil)
  end

  # A held outcome whose hold was placed for a sanctioned-jurisdiction association (the auto-deny trigger).
  def sanctioned_outcome
    hold = Hold.new(subject_ref: 'User:42', reason: Hold::REASON_SANCTIONED_JURISDICTION)
    ExportControl::ScreeningService::Outcome.new(decision: :held, screening_result: nil, hold: hold)
  end

  it 'posts an approved callback carrying the account on a solid pass (allowed)' do
    allow(svc).to receive(:screen_if_enabled).and_return(outcome(:allowed))
    captured = nil
    allow(ExportControl::ScreeningServiceClient).to receive(:post_signed) { |_url, body| captured = JSON.parse(body) }

    described_class.new.run(payload)

    expect(captured['decision']).to eq('approved')
    expect(captured['path']).to eq('auto')
    expect(captured['correlation_id']).to eq('User:42')
    expect(captured['account']['email']).to eq('jane@ucsf.edu')
  end

  it 'posts NO approval when held (fail-closed, awaits manual resolution)' do
    allow(svc).to receive(:screen_if_enabled).and_return(outcome(:held))
    expect(ExportControl::ScreeningServiceClient).not_to receive(:post_signed)
    described_class.new.run(payload)
  end

  it 'HOLDS the applicant signup (PendingSignup) for later resolution when held' do
    allow(svc).to receive(:screen_if_enabled).and_return(outcome(:held))
    expect { described_class.new.run(payload) }.to change(PendingSignup, :count).by(1)

    signup = PendingSignup.pending_for('User:42')
    expect(signup.screening_id).to eq('scr-1')
    expect(signup.callback_url).to eq('http://web/internal/v1/screening_result')
    expect(signup.account_payload['email']).to eq('jane@ucsf.edu')
  end

  it 'also holds a signup on an error outcome (fail-closed but recoverable by the poller)' do
    allow(svc).to receive(:screen_if_enabled).and_return(outcome(:error))
    expect { described_class.new.run(payload) }.to change(PendingSignup, :count).by(1)
  end

  it 'AUTO-DENIES a sanctioned-jurisdiction signup immediately, forwarding the account (no manual hold)' do
    allow(svc).to receive(:screen_if_enabled).and_return(sanctioned_outcome)
    captured = nil
    allow(ExportControl::ScreeningServiceClient).to receive(:post_signed) { |_url, body| captured = JSON.parse(body) }

    expect { described_class.new.run(payload) }.not_to change(PendingSignup, :count)

    expect(captured['decision']).to eq('denied')
    expect(captured['path']).to eq('auto')
    # The account is forwarded on denial too, so the callback receiver can email the applicant
    # (UserMailer.account_creation_denied). No PendingSignup is held for an auto-deny.
    expect(captured['account']['email']).to eq('jane@ucsf.edu')
  end

  it 'does NOT hold a signup on the disabled bypass (nil outcome)' do
    allow(svc).to receive(:screen_if_enabled).and_return(nil)
    expect { described_class.new.run(payload) }.not_to change(PendingSignup, :count)
  end

  it 'does NOT hold a signup on a solid pass (the callback fires inline, nothing to resolve later)' do
    allow(svc).to receive(:screen_if_enabled).and_return(outcome(:allowed))
    allow(ExportControl::ScreeningServiceClient).to receive(:post_signed)
    expect { described_class.new.run(payload) }.not_to change(PendingSignup, :count)
  end

  it 'does NOT persist a signup when there is no account payload (a non-signup screen)' do
    allow(svc).to receive(:screen_if_enabled).and_return(outcome(:held))
    expect { described_class.new.run(payload.except('account')) }.not_to change(PendingSignup, :count)
  end

  it 'is idempotent: a replayed held screen updates the pending signup, not a duplicate' do
    allow(svc).to receive(:screen_if_enabled).and_return(outcome(:held))
    described_class.new.run(payload)
    expect { described_class.new.run(payload) }.not_to change(PendingSignup, :count)
  end

  it 'posts NO approval when the screen errors' do
    allow(svc).to receive(:screen_if_enabled).and_return(outcome(:error))
    expect(ExportControl::ScreeningServiceClient).not_to receive(:post_signed)
    described_class.new.run(payload)
  end

  it 'posts NO approval when screening is disabled (nil outcome, full bypass)' do
    allow(svc).to receive(:screen_if_enabled).and_return(nil)
    expect(ExportControl::ScreeningServiceClient).not_to receive(:post_signed)
    described_class.new.run(payload)
  end

  it 'builds the screening subject from the payload' do
    captured_subject = nil
    allow(svc).to receive(:screen_if_enabled) { |s|
  captured_subject = s
  outcome(:held)
}

    described_class.new.run(payload)

    expect(captured_subject.subject_ref).to eq('User:42')
    expect(captured_subject.name).to eq('Jane Doe')
    expect(captured_subject.country).to eq('US')
    expect(captured_subject.address1).to eq('1 Main St')
    expect(captured_subject.soptionalid).to eq('42')
  end
end
