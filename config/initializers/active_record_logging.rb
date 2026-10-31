# frozen_string_literal: true

require './lib/logging'

class ActiveRecord::LogSubscriber
  alias old_sql sql

  def sql(event)
    payload = event.payload

    # Filter out schema migrations and internal metadata spam
    return if payload[:name] == 'ActiveRecord::SchemaMigration Load'
    return if payload[:name] == 'ActiveRecord::InternalMetadata Load'
    return if payload[:sql] =~ /schema_migrations/

    old_sql(event)
  end
end

class ActiveRecord::Migration
  alias original_write write

  def write(text = "")
    Logging.capture_console(module: "ActiveRecord::Migration") do
      original_write(text)
    end
  end
end

module ActiveRecord::Tasks::DatabaseTasks
  alias original_create create
  alias original_drop drop

  def create(configuration, *arguments)
    Logging.capture_console(module: "ActiveRecord::Tasks::DatabaseTasks") do
      original_create(configuration, *arguments)
    end
  end

  def drop(configuration, *arguments)
    Logging.capture_console(module: "ActiveRecord::Tasks::DatabaseTasks") do
      original_drop(configuration, *arguments)
    end
  end
end
