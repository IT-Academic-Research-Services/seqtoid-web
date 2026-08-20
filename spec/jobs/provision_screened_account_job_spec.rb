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
end
