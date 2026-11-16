require "rails_helper"

RSpec.describe LogUtil do
  let(:message) { "This is a fake message" }
  let(:log_io) { StringIO.new }
  let(:zero_division_message) { "divided by 0" }

  let(:zero_division_error) do
    exception = ZeroDivisionError.new(zero_division_message)
    exception.set_backtrace(caller)
    exception
  end

  let(:details) do
    {
      detail1: "this is a detail",
      detail2: 2,
      detail3: "this is another detail",
    }
  end

  around(:each) do |example|
    original_logger = Rails.logger
    Rails.logger = Logging.create_json_logger(log_io, :debug)
    example.run
  ensure
    Rails.logger = original_logger
  end

  describe "#log_exception" do
    it "should log exception with no message or details" do
      expect(Sentry).not_to receive(:capture_message)
      expect(Sentry).to receive(:capture_exception).with(
        zero_division_error,
        hash_including(level: :error, extra: {})
      )

      LogUtil.log_exception(zero_division_error)

      actual = JSON.parse(log_io.string, symbolize_names: true)
      expect(actual).to include(err: hash_including(:stack, name: ZeroDivisionError.name, message: zero_division_message), level: "error", msg: zero_division_message)
      expect(actual).not_to include(:detail1, :detail2, :detail3)
    end

    it "should log exception with message and details" do
      expect(Sentry).not_to receive(:capture_message)
      expect(Sentry).to receive(:capture_exception).with(
        zero_division_error,
        hash_including(level: :error, extra: { message: message, **details })
      )

      LogUtil.log_exception(zero_division_error, message: message, **details)

      actual = JSON.parse(log_io.string, symbolize_names: true)
      expect(actual).to include(err: hash_including(:stack, name: ZeroDivisionError.name, message: zero_division_message), level: "error", msg: message, **details)
    end
  end

  describe "#log_error" do
    it "should log error" do
      expect(Sentry).not_to receive(:capture_message)
      expect(Sentry).to receive(:capture_exception).with(
        zero_division_error,
        hash_including(level: :error, extra: { message: message })
      )

      LogUtil.log_error(message, exception: zero_division_error)

      actual = JSON.parse(log_io.string, symbolize_names: true)
      expect(actual).to include(err: hash_including(:stack, name: ZeroDivisionError.name, message: zero_division_message), level: "error", msg: message)
      expect(actual).not_to include(:detail1, :detail2, :detail3)
    end

    it "should log error with details" do
      expect(Sentry).not_to receive(:capture_message)
      expect(Sentry).to receive(:capture_exception).with(
        zero_division_error,
        hash_including(level: :error, extra: { message: message, **details })
      )

      LogUtil.log_error(message, exception: zero_division_error, **details)

      actual = JSON.parse(log_io.string, symbolize_names: true)
      expect(actual).to include(err: hash_including(:stack, name: ZeroDivisionError.name, message: zero_division_message), level: "error", msg: message, **details)
    end

    it "should log message if exception is missing" do
      expect(Sentry).to receive(:capture_message).with(
        message,
        hash_including(level: :error, extra: details)
      )
      expect(Sentry).not_to receive(:capture_exception)

      LogUtil.log_error(message, **details)

      actual = JSON.parse(log_io.string, symbolize_names: true)
      expect(actual).to include(level: "error", msg: message, **details)
      expect(actual).not_to include(:err)
    end

    it "should log error with details at requested level" do
      expect(Sentry).not_to receive(:capture_message)
      expect(Sentry).to receive(:capture_exception).with(
        zero_division_error,
        hash_including(level: :debug, extra: { message: message, **details })
      )

      LogUtil.log_error(message, level: :debug, exception: zero_division_error, **details)

      actual = JSON.parse(log_io.string, symbolize_names: true)
      expect(actual).to include(err: hash_including(:stack, name: ZeroDivisionError.name, message: zero_division_message), level: "debug", msg: message, **details)
    end
  end

  describe "#log_message" do
    it "should log message" do
      expect(Sentry).to receive(:capture_message).with(message, hash_including(level: :info, extra: {}))
      expect(Sentry).not_to receive(:capture_exception)

      LogUtil.log_message(message)

      actual = JSON.parse(log_io.string, symbolize_names: true)
      expect(actual).to include(level: "info", msg: message)
      expect(actual).not_to include(:backtrace, :exception)
    end

    it "should log message with details" do
      expect(Sentry).to receive(:capture_message).with(message, hash_including(level: :info, extra: details))
      expect(Sentry).not_to receive(:capture_exception)

      LogUtil.log_message(message, **details)

      actual = JSON.parse(log_io.string, symbolize_names: true)
      expect(actual).to include(level: "info", msg: message, **details)
      expect(actual).not_to include(:backtrace, :exception)
    end

    it "should log with details at requested level" do
      expect(Sentry).to receive(:capture_message).with(message, hash_including(level: :warn, extra: details))
      expect(Sentry).not_to receive(:capture_exception)

      LogUtil.log_message(message, level: :warn, **details)

      actual = JSON.parse(log_io.string, symbolize_names: true)
      expect(actual).to include(level: "warn", msg: message, **details)
      expect(actual).not_to include(:backtrace, :exception)
    end
  end
end
