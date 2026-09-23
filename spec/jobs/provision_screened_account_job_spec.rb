# frozen_string_literal: true

require 'rails_helper'

RSpec.describe ProvisionScreenedAccountJob do
  let(:account) { { 'email' => 'Jane@UCSF.edu', 'name' => 'Jane Doe' } }

  describe 'approved' do
    let(:payload) { { 'decision' => 'approved', 'correlation_id' => 'User:1', 'account' => account } }

    it 'provisions a new account (DB + Auth0 + activation) via UserFactoryService' do
      allow(User).to receive(:exists?).with(email: 'jane@ucsf.edu').and_return(false)
      factory = instance_double(UserFactoryService)
      expect(UserFactoryService).to receive(:new)
        .with(email: 'jane@ucsf.edu', name: 'Jane Doe', send_activation: true).and_return(factory)
      expect(factory).to receive(:call)

      described_class.new.run(payload)
    end

    it 'is idempotent: a replayed callback for an existing email is a no-op' do
      allow(User).to receive(:exists?).with(email: 'jane@ucsf.edu').and_return(true)
      expect(UserFactoryService).not_to receive(:new)

      described_class.new.run(payload)
    end

    it 'does nothing when the account email is blank' do
      expect(UserFactoryService).not_to receive(:new)
      described_class.new.run('decision' => 'approved', 'account' => { 'name' => 'No Email' })
    end
  end

  describe 'denied' do
    let(:payload) { { 'decision' => 'denied', 'correlation_id' => 'User:1', 'account' => account } }

    it 'sends the "unable to accept" email' do
      mail = double('mail')
      expect(UserMailer).to receive(:account_creation_denied).with('Jane@UCSF.edu').and_return(mail)
      expect(mail).to receive(:deliver_now)

      described_class.new.run(payload)
    end
  end

  it 'ignores an unknown decision (never provisions)' do
    expect(UserFactoryService).not_to receive(:new)
    described_class.new.run('decision' => 'weird', 'account' => account)
  end

  # SMP-1901 -- the CZ ID transfer request captured pre-account on the signup form is copied onto the user
  # here (the only point at which the user exists) and the sidecar row is then removed.
  describe 'CZ ID transfer request' do
    let(:approved) { { 'decision' => 'approved', 'correlation_id' => 'Signup:x', 'account' => account } }

    def stub_provisioned_user(user)
      allow(User).to receive(:exists?).with(email: 'jane@ucsf.edu').and_return(false)
      factory = instance_double(UserFactoryService)
      allow(factory).to receive(:call).and_return(user)
      allow(UserFactoryService).to receive(:new).and_return(factory)
    end

    it 'copies a matching request onto the provisioned user and deletes the row' do
      user = create(:user, email: 'jane@ucsf.edu')
      CzidTransferRequest.create!(email: 'jane@ucsf.edu', wants_czid_data_transferred: true,
                                  czid_account_email: 'jane@czid.org')
      stub_provisioned_user(user)

      described_class.new.run(approved)

      expect(user.reload.wants_czid_data_transferred).to be(true)
      expect(user.czid_account_email).to eq('jane@czid.org')
      expect(CzidTransferRequest.find_by(email: 'jane@ucsf.edu')).to be_nil
    end

    it 'provisions fine when there is no matching request (columns stay at defaults)' do
      user = create(:user, email: 'jane@ucsf.edu')
      stub_provisioned_user(user)

      expect { described_class.new.run(approved) }.not_to raise_error
      expect(user.reload.wants_czid_data_transferred).to be(false)
      expect(user.czid_account_email).to be_nil
    end

    it 'deletes any stored request when the applicant is denied' do
      CzidTransferRequest.create!(email: 'jane@ucsf.edu', wants_czid_data_transferred: true,
                                  czid_account_email: 'jane@czid.org')
      allow(UserMailer).to receive(:account_creation_denied).and_return(double('mail', deliver_now: true))

      described_class.new.run('decision' => 'denied', 'correlation_id' => 'Signup:x', 'account' => account)

      expect(CzidTransferRequest.find_by(email: 'jane@ucsf.edu')).to be_nil
    end
  end

  # SMP-1902 -- backstop: if provisioning hits a User validation error (e.g. a blocked email domain that
  # slipped past the signup-form check), the job must deny (send a decision email) rather than raise and
  # leave the applicant in limbo with no email.
  describe 'a validation error at provisioning' do
    let(:approved) do
      { 'decision' => 'approved', 'correlation_id' => 'Signup:x',
        'account' => { 'email' => 'blocked@gmail.com', 'name' => 'Blocked User' } }
    end

    it 'denies (sends the decision email) instead of raising' do
      allow(User).to receive(:exists?).with(email: 'blocked@gmail.com').and_return(false)
      invalid = User.new(email: 'blocked@gmail.com')
      invalid.errors.add(:email, 'cannot be a personal or temporary email address')
      factory = instance_double(UserFactoryService)
      allow(factory).to receive(:call).and_raise(ActiveRecord::RecordInvalid.new(invalid))
      allow(UserFactoryService).to receive(:new).and_return(factory)

      expect(UserMailer).to receive(:account_creation_denied)
        .with('blocked@gmail.com').and_return(double('mail', deliver_now: true))

      expect { described_class.new.run(approved) }.not_to raise_error
    end
  end
end
