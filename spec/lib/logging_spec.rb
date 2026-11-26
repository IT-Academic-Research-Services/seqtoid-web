require "rails_helper"
require Rails.root.join("lib", "logging").to_s

RSpec.describe Logging do
  let(:now_dt) { Time.current }
  let(:now_dt_str) { now_dt.utc.iso8601(6) }
  let(:thread) { Thread.current.object_id.to_s }
  let(:message) { "This is a fake message" }
  let(:logger) { SemanticLogger["LoggingTest"] }

  describe "create_json_logger" do
    let(:log_io) { StringIO.new }
    let!(:appender) do
      SemanticLogger.add_appender(
        io: log_io,
        level: :info,
        formatter: ::Logging::DEFAULT_FORMATTER,
        filter: lambda(&Logging.method(:filter))
      )
    end

    before do
      travel_to(now_dt, with_usec: true)
    end

    after do
      travel_back
      SemanticLogger.remove_appender(appender)
    end

    around(:each) do |example|
      SemanticLogger.silence(:debug) do
        example.run
      end
    end

    it "Will not log if lower log level" do
      logger.debug(message)
      SemanticLogger.flush

      expect(log_io.string).to be_blank
    end

    it "logs JSON correctly" do
      logger.info(message)
      SemanticLogger.flush

      actual = JSON.parse(log_io.string, symbolize_names: true)
      expect(actual).to include(name: "LoggingTest",
                                application: "czid",
                                environment: "test",
                                level: "info",
                                level_index: 2,
                                message: message,
                                request_id: nil,
                                timestamp: now_dt_str,
                                thread: thread,
                                usr: nil)
      expect(actual).to include(:host)
      # TODO: Maybe remove unnecessary fields from the message, like :dd and :level_index
      expect(actual).not_to include(:named_tags, :payload) # :dd, :level_index)
    end

    it "logs JSON correctly, even with fields added and removed" do
      Logging.with_transformers(
        ->(log) { log.payload.delete(:foo) },
        ->(log) { log.payload[:tom] = "jones" }
      ) do
        logger.info(message, foo: "bar", module: "baz", zip: "zoom")
        SemanticLogger.flush

        actual = JSON.parse(log_io.string, symbolize_names: true)
        expect(actual).to include(name: "LoggingTest",
                                  application: "czid",
                                  environment: "test",
                                  level: "info",
                                  level_index: 2,
                                  message: message,
                                  payload: { module: "baz", tom: "jones", zip: "zoom" },
                                  request_id: nil,
                                  timestamp: now_dt_str,
                                  thread: thread,
                                  usr: nil)
        expect(actual).to include(:host)
        # TODO: Maybe remove unnecessary fields from the message, like :dd and :level_index
        expect(actual).not_to include(:named_tags) # :dd, :level_index)
      end
    end

    it "Extracts usr and request_id fields from named_tags" do
      request = ActionDispatch::TestRequest.create("action_dispatch.request_id" => SecureRandom.uuid)
      user = build_stubbed(:user, role: 0)

      Logging.with_user_and_request(user, request) do
        logger.info(message, module: "baz")
        SemanticLogger.flush

        actual = JSON.parse(log_io.string, symbolize_names: true)
        expect(actual).to include(name: "LoggingTest",
                                  application: "czid",
                                  environment: "test",
                                  level: "info",
                                  level_index: 2,
                                  message: message,
                                  named_tags: {}, # Should be non-existent if empty, like other places, but isn't for some reason.
                                  payload: { module: "baz" },
                                  request_id: request.request_id,
                                  timestamp: now_dt_str,
                                  thread: thread,
                                  usr: { email: user.email, id: user.id, name: user.name })
        expect(actual).to include(:host)
        # TODO: Maybe remove unnecessary fields from the message, like :dd and :level_index
        # expect(actual).not_to include(:dd, :level_index)
      end
    end

    it "Will not log if anything if Logging::filters return false" do
      # Uses global and thread-local lists of filters
      # SemanticLogger.tagged("super-tag") do
      Logging.with_filters(->(log) { !log.message.include?('message we want excluded') }) do
        SemanticLogger.named_tagged(my_tag: "zip") do
          logger.info("message we want excluded")
          SemanticLogger.flush

          expect(log_io.string).to be_blank

          logger.info(message)
          SemanticLogger.flush

          actual = JSON.parse(log_io.string, symbolize_names: true)
          expect(actual).to include(name: "LoggingTest",
                                    application: "czid",
                                    environment: "test",
                                    level: "info",
                                    level_index: 2,
                                    message: message,
                                    named_tags: { my_tag: "zip" },
                                    request_id: nil,
                                    timestamp: now_dt_str,
                                    thread: thread,
                                    usr: nil)
          expect(actual).to include(:host)
        end
      end
    end
  end
end
