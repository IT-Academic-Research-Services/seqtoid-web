# frozen_string_literal: true

require "rails_helper"

RSpec.describe MailDeliveryReporting do
  let(:client) { Aws::SESV2::Client.new(stub_responses: true) }
  let(:delivery) { Aws::ActionMailer::SESV2::Mailer.new(sesv2_client: client) }
  let(:message) do
    Mail.new do
      from "no-reply@seqtoid.org"
      to ["applicant@example.edu", "second@Lab.Example.org"]
      subject "Your SeqtoID account"
      body "hello"
    end
  end

  it "is prepended onto the :ses_v2 delivery method" do
    expect(Aws::ActionMailer::SESV2::Mailer.ancestors).to include(described_class)
    expect(ActionMailer::Base.delivery_methods[:ses_v2]).to eq(Aws::ActionMailer::SESV2::Mailer)
  end

  context "when SES rejects the send" do
    before do
      client.stub_responses(
        :send_email,
        "MessageRejected"
      )
    end

    it "reports the failure without recipient addresses and re-raises" do
      allow(LogUtil).to receive(:log_message)

      expect { delivery.deliver!(message) }.to raise_error(Aws::SESV2::Errors::MessageRejected)

      expect(LogUtil).to have_received(:log_message).with(
        "[mail_delivery_failed] outbound email was not delivered",
        level: :error,
        error_class: "Aws::SESV2::Errors::MessageRejected",
        ses_error_code: "MessageRejected",
        recipient_count: 2,
        recipient_domains: "example.edu,lab.example.org"
      )
    end

    it "never logs an address" do
      reported = nil
      allow(LogUtil).to receive(:log_message) { |_msg, **details| reported = details }

      expect { delivery.deliver!(message) }.to raise_error(Aws::SESV2::Errors::MessageRejected)
      expect(reported.values.join(" ")).not_to include("@")
    end

    it "still raises the delivery error when reporting itself fails" do
      allow(LogUtil).to receive(:log_message).and_raise(StandardError, "sentry down")

      expect { delivery.deliver!(message) }.to raise_error(Aws::SESV2::Errors::MessageRejected)
    end

    it "keeps raise_delivery_errors = false silent for the caller while still reporting" do
      allow(LogUtil).to receive(:log_message)
      message.delivery_method(delivery.class, sesv2_client: client)
      message.raise_delivery_errors = false

      expect { message.deliver }.not_to raise_error
      expect(LogUtil).to have_received(:log_message).once
    end
  end

  context "when SES accepts the send" do
    it "does not report anything" do
      allow(LogUtil).to receive(:log_message)

      delivery.deliver!(message)

      expect(LogUtil).not_to have_received(:log_message)
    end
  end
end
