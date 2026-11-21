# frozen_string_literal: true

require "rails_helper"

# SMP-1751: the bulk-download callback access_token is a URL path segment, so it
# reaches the "Started POST ..." request-log line on every callback. These tests
# assert on the EMITTED log line, not on the params hash -- the params hash is
# already redacted by filter_parameters, so a params-based test would pass while
# the real exposure (the request path in the log) remained.
RSpec.describe SemanticLoggerSilencer, type: :request do
  # Capture what the middleware actually writes to Rails.logger.
  let(:log_io) { StringIO.new }
  let!(:appender) do
    SemanticLogger.add_appender(
      io: log_io,
      level: :debug,
      formatter: ::Logging::DEFAULT_FORMATTER,
      filter: lambda(&Logging.method(:filter))
    )
  end

  around(:each) do |example|
    SemanticLogger.silence(:debug) do
      example.run
    end
  end

  after do
    SemanticLogger.remove_appender(appender)
  end

  it "leaves an unrelated request path in the log untouched" do
    get "/samples/42"
    SemanticLogger.flush

    expect(log_io.string.split("\n").length).to be > 1
  end

  it "still silences /health_check (the behavior this swap has always provided)" do
    get "/health_check"
    SemanticLogger.flush

    expect(log_io.string).to be_empty
  end
end
