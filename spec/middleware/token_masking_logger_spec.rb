# frozen_string_literal: true

require "rails_helper"

# SMP-1751: the bulk-download callback access_token is a URL path segment, so it
# reaches the "Started POST ..." request-log line on every callback. These tests
# assert on the EMITTED log line, not on the params hash -- the params hash is
# already redacted by filter_parameters, so a params-based test would pass while
# the real exposure (the request path in the log) remained.
RSpec.describe TokenMaskingLogger do
  # Obvious fake, shaped like a has_secure_token but not a real credential.
  let(:fake_token) { "faketokenNotARealCredential0123456789" }

  # A downstream app that just returns 200, so call() runs the request-start log.
  let(:app) { ->(_env) { [200, { "Content-Type" => "text/plain" }, ["ok"]] } }
  let(:middleware) { described_class.new(app) }

  # Capture what the middleware actually writes to Rails.logger.
  let(:log_io) { StringIO.new }

  around do |example|
    original_logger = Rails.logger
    Rails.logger = ActiveSupport::TaggedLogging.new(ActiveSupport::Logger.new(log_io))
    example.run
  ensure
    Rails.logger = original_logger
  end

  def log_output
    log_io.rewind
    log_io.read
  end

  %w[success error progress].each do |action|
    it "masks the token in the request-start line for the #{action} callback" do
      env = Rack::MockRequest.env_for("/bulk_downloads/123/#{action}/#{fake_token}", method: "POST")

      middleware.call(env)

      expect(log_output).to include("Started POST")
      expect(log_output).not_to include(fake_token)
      expect(log_output).to include("/bulk_downloads/123/#{action}/[REDACTED]")
    end
  end

  it "leaves an unrelated request path in the log untouched" do
    env = Rack::MockRequest.env_for("/samples/42", method: "GET")

    middleware.call(env)

    expect(log_output).to include("/samples/42")
    expect(log_output).not_to include("[REDACTED]")
  end

  it "still silences /health_check (the behavior this swap has always provided)" do
    env = Rack::MockRequest.env_for("/health_check", method: "GET")

    middleware.call(env)

    expect(log_output).not_to include("Started GET")
  end
end
