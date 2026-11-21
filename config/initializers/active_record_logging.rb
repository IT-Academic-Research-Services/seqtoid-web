# frozen_string_literal: true

require './lib/logging'

Logging.add_filter(lambda { |log|
  return false if log.payload&.dig(:sql) =~ /schema_migrations/
  # return false if log.message == 'DataMigrate::DataSchemaMigration Load'
  return false if log.message == 'ActiveRecord::SchemaMigration Load'
  return false if log.message == 'ActiveRecord::InternalMetadata Load'
  return false if log.message == 'AppConfig Load'

  true
})

class ActiveRecord::Migration
  alias original_write write

  def write(text = "")
    Logging.capture_console(module: "ActiveRecord::Migration", method: "write") do
      original_write(text)
    end
  end
end

module ActiveRecord::Tasks::DatabaseTasks
  alias original_create create
  alias original_create_all create_all
  alias original_drop drop
  alias original_drop_all drop_all
  alias original_migrate_status migrate_status
  alias original_purge_all purge_all

  def create(configuration, *arguments)
    Logging.capture_console(module: "ActiveRecord::Tasks::DatabaseTasks", method: "create") do
      original_create(configuration, *arguments)
    end
  end

  def create_all
    Logging.capture_console(module: "ActiveRecord::Tasks::DatabaseTasks", method: "create_all") do
      original_create_all
    end
  end

  def drop(configuration, *arguments)
    Logging.capture_console(module: "ActiveRecord::Tasks::DatabaseTasks", method: "drop") do
      original_drop(configuration, *arguments)
    end
  end

  def drop_all
    Logging.capture_console(module: "ActiveRecord::Tasks::DatabaseTasks", method: "drop_all") do
      original_drop_all
    end
  end

  def migrate_status
    Logging.capture_console(module: "ActiveRecord::Tasks::DatabaseTasks", method: "migrate_status") do
      original_migrate_status
    end
  end

  def purge_all
    Logging.capture_console(module: "ActiveRecord::Tasks::DatabaseTasks", method: "purge_all") do
      original_purge_all
    end
  end
end

# Extract the core logger if it's wrapped in ActiveSupport::TaggedLogging
ActiveRecord::Base.logger = Rails.logger.respond_to?(:logger) ? Rails.logger.logger : Rails.logger
