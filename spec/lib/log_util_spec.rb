require "rails_helper"

RSpec.describe LogUtil do
  describe "#log_error" do
    let(:subject) { LogUtil }
    let(:message) { "This is a fake message" }
    let(:details) do
      {
        detail1: "this is a detail",
        detail2: 2,
        detail3: "this is another detail",
      }
    end
    let(:zero_division_error) do
      ZeroDivisionError.new("divided by 0")
    end

    it "should log error" do
      expect(Sentry).to receive(:capture_exception).with(zero_division_error, hash_including(extra: { message: message }))
      subject.log_error(message, exception: zero_division_error)
    end

    it "should log error with details" do
      expect(Sentry).to receive(:capture_exception).with(zero_division_error, hash_including(extra: details.merge(message: message)))
      subject.log_error(message, exception: zero_division_error, **details)
    end
  end

  describe "#log_message" do
    let(:subject) { LogUtil }
    let(:message) { "This is a fake message" }
    let(:level) { "info" }
    let(:details) do
      {
        detail1: "this is a detail",
        detail2: 2,
        detail3: "this is another detail",
      }
    end

    it "should log message" do
      expect(Sentry).to receive(:capture_message).with(message, hash_including(level: "info", extra: {}))
      subject.log_message(message)
    end

    it "should log message with details" do
      allow(Rails.logger).to receive(:info)
      expect(Sentry).to receive(:capture_message).with(message, hash_including(level: "info", extra: details))
      subject.log_message(message, **details)
    end

    it "always writes the message to the structured app log (for monitoring)" do
      allow(Sentry).to receive(:capture_message)
      expect(Rails.logger).to receive(:info).with(a_string_including(message))
      subject.log_message(message)
    end

    it "does NOT send to Sentry when to_sentry: false, but still logs to the app log (SMP-1596/1597/1598)" do
      expect(Rails.logger).to receive(:info).with(a_string_including(message))
      expect(Sentry).not_to receive(:capture_message)
      subject.log_message(message, to_sentry: false, **details)
    end
  end
end
