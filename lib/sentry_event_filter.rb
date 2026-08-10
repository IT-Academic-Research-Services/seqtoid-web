# frozen_string_literal: true

require_relative "secret_redaction"

# Predicates and payload scrubbing for Sentry `before_send`
# (config/initializers/sentry.rb), extracted so the rules are unit-testable
# without booting Sentry.
module SentryEventFilter
  # A socket connect that is still in progress (EALREADY / EINPROGRESS) at the
  # moment the process is signalled to shut down (SIGTERM/INT/QUIT surfaces in
  # Ruby as Interrupt / SignalException).
  CONNECT_IN_PROGRESS = [Errno::EALREADY, IO::EINPROGRESSWaitWritable].freeze
  SHUTDOWN_SIGNALS = [Interrupt, SignalException].freeze
  MAX_CAUSE_DEPTH = 10

  # The `rails runner` subcommand and its short alias, as they appear in the
  # process argv right after the rails CLI token.
  RUNNER_COMMANDS = %w[runner r].freeze
  # Linux exposes the immutable exec argv here (unaffected by in-process `$0=`),
  # which is what lets us tell `rails runner` apart from `rails server` etc.
  PROC_CMDLINE = "/proc/self/cmdline"

  # Marker left in place of the extras payload if scrubbing itself blows up. The
  # event still reports (exception + stacktrace are untouched); only the context
  # we could not prove clean is dropped. Fail CLOSED on the secret, open on the
  # error signal.
  SCRUB_FAILED = { scrub_error: "extras dropped: redaction failed" }.freeze

  module_function

  # Last line of defence for credential material in telemetry (SMP-1729).
  #
  # Individual call sites are fixed not to pass secrets, but call sites are a
  # snapshot -- the next one to add `access_token:` to a log payload would
  # re-open the hole silently. This scrubs the event on the way out instead, so
  # the property holds for call sites that do not exist yet: values under a
  # secret-looking key are dropped, presigned URLs lose their signature, and
  # bearer tokens embedded in free text are masked, in both extras and
  # breadcrumbs. Message, exception, stacktrace and every non-secret value are
  # left exactly as they were.
  def scrub_secrets(event)
    return event if event.nil?

    begin
      scrub_attribute(event, :extra)
      scrub_breadcrumbs(event)
    rescue StandardError
      force_attribute(event, :extra, SCRUB_FAILED.dup)
    end

    event
  end

  # Replace an event attribute with its scrubbed copy, whether the SDK exposes a
  # writer for it or only a readable hash we can rewrite in place.
  def scrub_attribute(event, name)
    return unless event.respond_to?(name)

    current = event.public_send(name)
    return if current.nil?

    scrubbed = SecretRedaction.scrub(current)
    return if force_attribute(event, name, scrubbed)

    current.replace(scrubbed) if current.is_a?(Hash)
  end

  def force_attribute(event, name, value)
    writer = :"#{name}="
    return false unless event.respond_to?(writer)

    event.public_send(writer, value)
    true
  end

  def scrub_breadcrumbs(event)
    buffer = event.respond_to?(:breadcrumbs) ? event.breadcrumbs : nil
    return unless buffer.respond_to?(:each)

    buffer.each do |crumb|
      next if crumb.nil?

      scrub_attribute(crumb, :data)
      if crumb.respond_to?(:message) && crumb.respond_to?(:message=)
        crumb.message = SecretRedaction.redact_signed_text(crumb.message)
      end
    end
  end

  # True for the benign resque-scheduler shutdown race (platform-overhaul 727):
  # on pod SIGTERM, resque-scheduler's before_shutdown releases its Redis master
  # lock; if the Redis socket is mid-connect the non-blocking connect raises
  # Errno::EALREADY / IO::EINPROGRESSWaitWritable, with the shutdown Interrupt as
  # the cause. Harmless (the lock has a TTL; the next scheduler re-acquires it).
  #
  # Deliberately narrow: it requires BOTH a connect-in-progress error AND a
  # shutdown signal in the cause chain, so real Redis outages
  # (Redis::CannotConnectError, Errno::ECONNREFUSED, timeouts, DNS) still report --
  # none of those are connect-in-progress errors, and none are Interrupt-caused.
  def shutdown_connect_race?(exception)
    return false unless exception
    return false unless CONNECT_IN_PROGRESS.any? { |klass| exception.is_a?(klass) }

    cause_chain(exception).any? do |err|
      SHUTDOWN_SIGNALS.any? { |klass| err.is_a?(klass) }
    end
  end

  # The exception plus its `.cause` ancestors, bounded so a self-referential or
  # pathologically deep chain cannot loop.
  def cause_chain(exception)
    chain = []
    cursor = exception
    while cursor && chain.size < MAX_CAUSE_DEPTH && !chain.include?(cursor)
      chain << cursor
      cursor = cursor.cause
    end
    chain
  end

  # True when this process is a HUMAN's interactive rails CLI session -- an
  # ad-hoc `rails console` or a hand-typed `rails runner "<one-liner>"` at a dev
  # pod. When the operator's inline code raises (a typo, a wrong column name),
  # sentry-rails would otherwise mint a tracked issue for what is not a product
  # defect -- source: runner, eval'd inline code, zero first-party frames, single
  # occurrence, 0 users (SMP-1583; cf. the SMP-1562/1563 users.admin / updated_at
  # console typos). Such an event is dropped before send.
  #
  # Deliberately narrow so AUTOMATED work still reports:
  #   * `rails console` is only ever a person -- CI / cron / Argo never use it.
  #   * `rails runner` is matched ONLY when STDIN is a TTY, i.e. an interactive
  #     session (kubectl exec -it). The data-integrity / nightly CI runners and
  #     any k8s CronJob / Argo Workflow invoke `rails runner` NON-interactively
  #     (no TTY), so their failures are preserved.
  #   * rake tasks, Resque jobs, and web requests never match either branch, so
  #     genuine background/web errors always report.
  #
  # Args are injectable purely so the predicate is unit-testable without spawning
  # a real console/runner; production always uses the live process state.
  def interactive_cli_session?(console: rails_console?, cmdline: process_cmdline, stdin: $stdin)
    return true if console
    return false unless runner_invocation?(cmdline)

    tty?(stdin)
  end

  # `rails console` defines Rails::Console once the console has booted (after the
  # initializers run, so this must be evaluated per-event, not memoized at init).
  def rails_console?
    defined?(Rails::Console) ? true : false
  end

  # True when the process argv is a `rails runner` (or `rails r`) invocation.
  # Reads the NUL-separated exec argv; the rails CLI token is either bare "rails"
  # or a path ending in "/rails" (covers bin/rails and `bundle exec rails`), and
  # the very next token is the runner subcommand. A `rails runner <file.rb>` that
  # rewrites $0 is intentionally NOT matched -- those are the automated scripts we
  # want to keep reporting.
  def runner_invocation?(cmdline)
    return false unless cmdline

    tokens = cmdline.split("\0").reject(&:empty?)
    idx = tokens.index { |t| t == "rails" || t.end_with?("/rails") }
    return false if idx.nil?

    RUNNER_COMMANDS.include?(tokens[idx + 1])
  end

  def tty?(stdin)
    stdin.respond_to?(:tty?) && stdin.tty?
  rescue StandardError
    false
  end

  # The immutable Linux exec argv, NUL-joined. nil on platforms without /proc
  # (e.g. local macOS dev), where we cannot prove a runner invocation and so fail
  # OPEN -- a genuine error is never suppressed just because we could not read it.
  def process_cmdline
    File.binread(PROC_CMDLINE)
  rescue StandardError
    nil
  end
end
