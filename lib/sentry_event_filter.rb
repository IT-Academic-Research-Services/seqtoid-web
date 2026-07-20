# frozen_string_literal: true

# Predicates for Sentry `before_send` (config/initializers/sentry.rb), extracted
# so the drop rules are unit-testable without booting Sentry.
module SentryEventFilter
  # A socket connect that is still in progress (EALREADY / EINPROGRESS) at the
  # moment the process is signalled to shut down (SIGTERM/INT/QUIT surfaces in
  # Ruby as Interrupt / SignalException).
  CONNECT_IN_PROGRESS = [Errno::EALREADY, IO::EINPROGRESSWaitWritable].freeze
  SHUTDOWN_SIGNALS = [Interrupt, SignalException].freeze
  MAX_CAUSE_DEPTH = 10

  module_function

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
end
