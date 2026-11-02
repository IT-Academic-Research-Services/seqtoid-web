require "ougai"
require "rails_helper"
require Rails.root.join("lib", "logging").to_s

RSpec.describe Logging do
  let(:now_dt) { Time.now.getlocal }
  let(:now_dt_str) { now_dt.utc.iso8601(3) }
  let(:thread_id) { Thread.current.object_id }
  let(:message) { "This is a fake message" }

  describe "Formatter" do
    let(:custom_formatter) { Logging::Formatter.new }

    before do
      travel_to(now_dt, with_usec: true)
    end

    after do
      travel_back
    end

    it "to_level() transforms level to lowercase" do
      actual = JSON.parse(custom_formatter.call("TRACE", now_dt, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "trace", msg: message, time: now_dt_str)

      actual = JSON.parse(custom_formatter.call("ErroR", now_dt, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "error", msg: message, time: now_dt_str)

      actual = JSON.parse(custom_formatter.call("debug", now_dt, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "debug", msg: message, time: now_dt_str)

      # NOTE: The level is pass-through, so no validation it performed on the name
      actual = JSON.parse(custom_formatter.call("Invalid", now_dt, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "invalid", msg: message, time: now_dt_str)
    end

    it "format_datetime() always transforms datetime to UTC" do
      actual = JSON.parse(custom_formatter.call("DEBUG", now_dt.utc, nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "debug", msg: message, time: now_dt_str)

      actual = JSON.parse(custom_formatter.call("DEBUG", now_dt.in_time_zone("America/Los_Angeles"), nil, message), symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "debug", msg: message, time: now_dt_str)
    end

    it "dump() removes unwanted fields" do
      # Filter out global [:pid, :v] and thread-local [:zip]
      Logging.with_field_removed(:zip) do
        actual = JSON.parse(custom_formatter.call("DEBUG", now_dt, nil, { msg: message, foo: "bar", module: "baz", zip: "zoom" }), symbolize_names: true)
        expect(actual).to include(name: "rspec", level: "debug", msg: message, time: now_dt_str, foo: "bar", module: "baz")
        expect(actual).to include(:hostname)
        # Ougai::Formatters::Bunyan only has the following default fields: [name, hostname, pid, level, time, v]
        # And we explicitly remove [pid, v] globally, and [zip] via Logging.with_field_removed() above
        expect(actual).not_to include(:pid, :request_id, :thread_id, :user_id, :v, :zip)
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
      travel_to(now_dt, with_usec: true)
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
      Logging.with_field_removed(:foo) do
        logger.info({ msg: message, foo: "bar", module: "baz", zip: "zoom" })

        actual = JSON.parse(log_output, symbolize_names: true)
        expect(actual).to include(name: "rspec", environment: "test", level: "info", msg: message, time: now_dt_str, module: "baz", zip: "zoom", thread_id: thread_id)
        expect(actual).to include(:hostname)
        expect(actual).not_to include(:foo, :pid, :request_id, :user_id, :v)
      end
    end

    it "Will log if message is blank, if it also has other non-ignored fields" do
      logger.info("", foo: "bar", module: "baz")

      actual = JSON.parse(log_output, symbolize_names: true)
      expect(actual).to include(name: "rspec", level: "info", time: now_dt_str, foo: "bar", module: "baz", environment: "test", thread_id: thread_id)
      expect(actual).to include(:hostname)
      expect(actual).not_to include(:msg, :pid, :request_id, :user_id, :v)
    end

    it "Will not log if message is blank, if it has no other non-ignored fields" do
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
      expect(actual).to include(name: "rspec", level: "info", time: now_dt_str, msg: message, environment: "test", user_id: user.id, request_id: request.request_id, thread_id: thread_id)
      expect(actual).to include(:hostname)
      expect(actual).not_to include(:pid, :v)
    end

    it "Will not log if any of Logging::filters fails" do
      # Uses global and thread-local lists of filters
      Logging.with_filter(->(data) { data && !data[:msg]&.include?('message we want excluded') && data }) do
        logger.info("message we want excluded")

        expect(log_output).to be_blank

        logger.info(message)

        actual = JSON.parse(log_output, symbolize_names: true)
        expect(actual).to include(name: "rspec", level: "info", time: now_dt_str, msg: message, environment: "test", thread_id: thread_id)
        expect(actual).to include(:hostname)
        expect(actual).not_to include(:pid, :request_id, :user_id, :v)
      end
    end
  end
end
