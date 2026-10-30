require "ougai"
require "rails_helper"
require Rails.root.join("lib", "logging").to_s

RSpec.describe Logging do
  let(:now_dt) { Time.utc(1970, 1, 1, 12, 0, 0) }
  let(:now_dt_str) { "1970-01-01T12:00:00.000+00:00" }
  let(:message) { "This is a fake message" }

  describe "Formatter" do
    let(:ogai_formatter) { Ougai::Formatters::Bunyan.new }
    let(:custom_formatter) { Logging::Formatter.new }

    before do
      travel_to(now_dt)
    end

    after do
      travel_back
    end

    it "to_level() transforms uppercase level string" do
      actual = JSON.parse(ogai_formatter.call("TRACE", now_dt.utc, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: 10, msg: message, time: now_dt_str)

      actual = JSON.parse(custom_formatter.call("TRACE", now_dt, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "trace", msg: message, time: now_dt_str)

      actual = JSON.parse(ogai_formatter.call("ERROR", now_dt.utc, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: 50, msg: message, time: now_dt_str)

      actual = JSON.parse(custom_formatter.call("ERROR", now_dt, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "error", msg: message, time: now_dt_str)
    end

    it "to_level() transforms lowercase level string" do
      # NOTE: level would be 20, if "debug" was uppercase; 70 means UNKNOWN
      actual = JSON.parse(ogai_formatter.call("debug", now_dt.utc, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: 70, msg: message, time: now_dt_str)

      actual = JSON.parse(custom_formatter.call("debug", now_dt, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "debug", msg: message, time: now_dt_str)
    end

    it "to_level() transforms invalid level string" do
      # NOTE: 70 means UNKNOWN
      actual = JSON.parse(ogai_formatter.call("invalid", now_dt.utc, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: 70, msg: message, time: now_dt_str)

      # NOTE: The level is pass-through, so no validation it performed on the name
      actual = JSON.parse(custom_formatter.call("invalid", now_dt, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "invalid", msg: message, time: now_dt_str)
    end

    it "format_datetime() transforms floats to a datetime" do
      expect do
        ogai_formatter.call("DEBUG", now_dt.to_f, nil, message)
      end.to raise_error("undefined method `strftime' for an instance of Float")

      actual = JSON.parse(custom_formatter.call("DEBUG", now_dt.to_f, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "debug", msg: message, time: now_dt_str)
    end

    it "format_datetime() datetime to a UTC datetime" do
      actual = JSON.parse(ogai_formatter.call("DEBUG", now_dt.in_time_zone("America/Los_Angeles"), nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: 20, msg: message, time: "1970-01-01T04:00:00.000-08:00")

      actual = JSON.parse(custom_formatter.call("DEBUG", now_dt.in_time_zone("America/Los_Angeles"), nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "debug", msg: message, time: now_dt_str)
    end

    it "dump() removes unwanted fields" do
      # Filter out global [:pid, :v] and thread-local [:zip]
      Logging.with_field_removed(:zip) do
        actual = JSON.parse(ogai_formatter.call("DEBUG", now_dt.utc, nil, { msg: message, foo: "bar", module: "baz", zip: "zoom" }), symbolize_names: true)
        expect(actual).to include(name: "rspec", level: 20, msg: message, time: now_dt_str, v: 0, foo: "bar", module: "baz", zip: "zoom")
        expect(actual).to include(:hostname, :pid, :v)

        actual = JSON.parse(custom_formatter.call("DEBUG", now_dt, nil, { msg: message, foo: "bar", module: "baz", zip: "zoom" }), symbolize_names: true)
        expect(actual).to include(name: "rspec", level: "debug", msg: message, time: now_dt_str, foo: "bar", module: "baz")
        expect(actual).to include(:hostname)
        expect(actual).not_to include(:pid, :v, :zip)
      end
    end
  end
  describe "create_json_logger" do
    let(:log_io) { StringIO.new }
    let(:logger) { ActiveSupport::BroadcastLogger.new(Logging.create_json_logger(log_io, :info)) }

    def log_output
      log_io.rewind
      (log_io.read || "").strip
    end

    before do
      travel_to(now_dt)
    end

    after do
      travel_back
      Logging::CurrentContext.reset_all
    end

    it "Will not log if lower log level" do
      logger.debug(message, foo: "bar", module: "baz")

      expect(log_output).to be_blank
    end

    it "logs JSON correctly, even with custom fields" do
      logger.info(message, foo: "bar", module: "baz")

      actual = JSON.parse(log_output, symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "info", msg: message, time: now_dt_str, foo: "bar", module: "baz")
      expect(actual).not_to include(:pid, :v, :user_id, :request_id)
    end

    it "Will log if message is blank, if has other non-ignored fields" do
      logger.info("", foo: "bar", module: "baz")

      actual = JSON.parse(log_output, symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "info", time: now_dt_str, foo: "bar", module: "baz", environment: "test")
      expect(actual).not_to include(:msg, :pid, :v, :user_id, :request_id)
    end

    it "Will not log if message is blank, if without other non-ignored fields" do
      # :module is in Logging::@ignored, so it doesn't impact whether it will log or not
      logger.info("", module: "baz")

      expect(log_output).to be_blank
    end

    it "Reads fields from CurrentContext" do
      request = ActionDispatch::TestRequest.create("action_dispatch.request_id" => SecureRandom.uuid)
      user = build_stubbed(:user, role: 0)
      Logging::CurrentContext.request = request
      Logging::CurrentContext.user = user

      logger.info(message)

      actual = JSON.parse(log_output, symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "info", time: now_dt_str, msg: message, environment: "test", user_id: user.id, request_id: request.request_id)
      expect(actual).not_to include(:pid, :v)
    end

    it "Will not log if any of Logging::filters fails" do
      # Uses global and thread-local lists of filters
      Logging.with_filter(->(data) { data && !data[:msg]&.include?('message we want excluded') && data }) do
        logger.info("message we want excluded")

        expect(log_output).to be_blank

        logger.info(message)

        actual = JSON.parse(log_output, symbolize_names: true)
        expect(actual).to include(name: "rspec", level: "info", time: now_dt_str, msg: message, environment: "test")
        expect(actual).not_to include(:pid, :v, :user_id, :request_id)
      end
    end
  end
end
