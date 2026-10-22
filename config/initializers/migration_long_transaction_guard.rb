# frozen_string_literal: true

# Refuse to start a migration while another session holds a long-running transaction.
#
# Why: DDL needs a metadata lock on its table. If another session has a transaction open on that table,
# the ALTER waits -- and while it waits, MySQL queues every NEW query on that table behind it, so the app
# stalls. strong_migrations' lock_timeout bounds the wait, but each attempt (and every Kubernetes / Argo
# retry of the migrate job) still stalls the app for that long. On 2026-10-20 a 2-hour user-data import
# transaction blocked a prod release's ALTER TABLE pipeline_runs exactly this way.
#
# So before each migration runs -- on that migration's own connection, which covers the main and the
# screening database alike -- look for transactions older than the threshold. If there are any, fail the
# migration immediately with the offender's thread id and age, WITHOUT issuing any DDL (reading
# information_schema takes no lock on application tables). The deploy fails fast and can be retried once
# the long transaction is gone; the app never queues behind it.
#
# MIGRATION_GUARD_MAX_TRANSACTION_AGE_SECONDS: threshold (default 300). 0 disables the guard.
# MySQL only. If the check itself cannot run (e.g. missing PROCESS privilege), it logs and lets the
# migration proceed -- the guard must never be the reason a deploy cannot migrate.
module MigrationLongTransactionGuard
  DEFAULT_MAX_AGE_SECONDS = 300

  class LongTransactionError < StandardError; end

  def self.max_age_seconds
    value = Integer(ENV.fetch("MIGRATION_GUARD_MAX_TRANSACTION_AGE_SECONDS", DEFAULT_MAX_AGE_SECONDS).to_s, exception: false)
    value.nil? ? DEFAULT_MAX_AGE_SECONDS : value
  end

  # Long-running transactions on this server other than our own session's.
  def self.long_transactions(connection, max_age)
    connection.select_all(<<~SQL.squish).to_a
      SELECT trx_mysql_thread_id AS thread_id,
             TIMESTAMPDIFF(SECOND, trx_started, NOW()) AS age_seconds,
             trx_rows_modified AS rows_modified
      FROM information_schema.innodb_trx
      WHERE trx_started < NOW() - INTERVAL #{max_age.to_i} SECOND
        AND trx_mysql_thread_id <> CONNECTION_ID()
      ORDER BY trx_started
    SQL
  end

  def self.check!(connection, migration_name)
    max_age = max_age_seconds
    return if max_age <= 0
    return unless connection.adapter_name.to_s.match?(/mysql|trilogy/i)

    rows = begin
      long_transactions(connection, max_age)
    rescue StandardError => e
      Rails.logger.warn("[MigrationGuard] could not check for long transactions (#{e.class}); proceeding")
      return
    end
    return if rows.empty?

    detail = rows.first(5).map { |r| "thread #{r['thread_id']} open #{r['age_seconds']}s (#{r['rows_modified']} rows modified)" }.join("; ")
    raise LongTransactionError,
          "Refusing to run #{migration_name}: #{rows.size} transaction(s) open longer than #{max_age}s would block its " \
          "table lock and stall the app (#{detail}). Retry the deploy once they finish, or set " \
          "MIGRATION_GUARD_MAX_TRANSACTION_AGE_SECONDS=0 to override."
  end

  module MigrationHook
    def exec_migration(conn, direction)
      MigrationLongTransactionGuard.check!(conn, "#{self.class.name} (#{version})")
      super
    end
  end
end

ActiveSupport.on_load(:active_record) do
  ActiveRecord::Migration.prepend(MigrationLongTransactionGuard::MigrationHook)
end
