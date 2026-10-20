# Mark existing migrations as safe
# rubocop:disable Style/NumericLiterals
StrongMigrations.start_after = 20220513205413
# rubocop:enable Style/NumericLiterals

# Set timeouts for migrations
# 5s (was 10s): while an ALTER waits for its metadata lock, MySQL queues the app's new queries on that table
# behind it, so the wait IS app stall time. MigrationLongTransactionGuard refuses to start at all when a long
# transaction is open; this bounds the wait for shorter ones.
StrongMigrations.lock_timeout = 5.seconds
StrongMigrations.statement_timeout = 5.hours

# Analyze tables after indexes are added
# Outdated statistics can sometimes hurt performance
StrongMigrations.auto_analyze = true

# Set the version of the production database so the right checks are run in
# development. The platform moved to MySQL 8 (Aurora MySQL 3 / 8.0.mysql_aurora);
# dev/staging/prod all target 8.0. Driven by env (#483) so it can't silently drift
# from the real engine per environment, defaulting to "8.0". The old hardcoded
# "5.7.37" pin was a pre-8.0 holdover strong_migrations (2.5.x) no longer supports
# analyzing — it raised "MySQL version (5.7.37) not supported", blocking migrations.
StrongMigrations.target_version = ENV.fetch("STRONG_MIGRATIONS_TARGET_VERSION", "8.0")

# Add custom checks
# StrongMigrations.add_check do |method, args|
#   if method == :add_index && args[0].to_s == "users"
#     stop! "No more indexes on the users table"
#   end
# end

# Make some operations safe by default
# See https://github.com/ankane/strong_migrations#saf
