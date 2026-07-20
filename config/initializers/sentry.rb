# frozen_string_literal: true

# Sentry error reporting via the maintained sentry-ruby / sentry-rails SDK.
# (sentry-raven is EOL - migrated under CZID-154.)
#
# DSN stands for Data Source Name.
# https://docs.sentry.io/platforms/ruby/guides/rails/configuration/options/
if ENV['SENTRY_DSN_BACKEND']
  require Rails.root.join('lib/sentry_event_filter').to_s

  Sentry.init do |config|
    config.dsn = ENV['SENTRY_DSN_BACKEND']

    # sentry-rails auto-instruments Rack and controllers; no manual middleware
    # insert is required (raven's Raven::Rack is gone).

    # Environment tag on every event. Mirrors the old raven current_environment,
    # falling back to Rails.env when RAILS_ENV is not set.
    config.environment = ENV['RAILS_ENV'] || Rails.env

    # Release tag on every event (CZID-552). GIT_VERSION is the 8-char commit SHA
    # baked into the image (Dockerfile ARG GIT_COMMIT -> ENV GIT_VERSION). This is
    # the SAME value the frontend reports as release (window.GIT_RELEASE_SHA) and
    # the SAME value the dev CD pipeline registers as the Sentry release/deploy, so
    # runtime backend errors attribute to the release that shipped them -- unlocking
    # suspect commits, accurate regression windows, and resolve-in-next-release.
    config.release = ENV['GIT_VERSION'] if ENV['GIT_VERSION'].present?

    # We only want to send events to Sentry in these environments. This replaces
    # raven's `config.environments`; events raised in any other environment
    # (e.g. test) are dropped before send.
    config.enabled_environments = %w[sandbox staging prod dev development]

    # Error-reporting parity only: do NOT enable performance tracing here
    # (OpenTelemetry owns traces/metrics - see config/initializers/opentelemetry.rb).
    config.traces_sample_rate = 0.0

    # Do not send PII by default. user/context is attached explicitly in
    # ApplicationController#set_sentry_context.
    config.send_default_pii = false

    # Drop benign shutdown-time noise before it reports (platform-overhaul 727).
    # Today this filters only the resque-scheduler SIGTERM race where releasing the
    # Redis master lock hits a mid-connect socket (Errno::EALREADY caused by the
    # shutdown Interrupt). SentryEventFilter is deliberately narrow so real Redis
    # outages still report -- see lib/sentry_event_filter.rb.
    config.before_send = lambda do |event, hint|
      exception = hint && hint[:exception]
      SentryEventFilter.shutdown_connect_race?(exception) ? nil : event
    end
  end

  # Reporting failures:
  # With sentry-rails, uncaught exceptions in Rails/Rack/background jobs are
  # captured automatically. To report explicitly, use LogUtil.log_err /
  # Sentry.capture_message("Something went very wrong").
end
