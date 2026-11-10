# frozen_string_literal: true

require "rails_helper"

RSpec.describe "config/initializers/active_record_logging.rb" do
  describe "ActiveRecord::LogSubscriber#sql" do
    let(:subscriber) { ActiveRecord::LogSubscriber.new }

    def build_event(name, sql: "SELECT 1")
      ActiveSupport::Notifications::Event.new(
        "sql.active_record",
        Time.current,
        Time.current,
        "event_id",
        { name: name, sql: sql }
      )
    end

    it "suppresses 'AppConfig Load' events from being logged" do
      event = build_event("AppConfig Load", sql: "SELECT `app_configs`.* FROM `app_configs`")
      expect(subscriber).not_to receive(:old_sql)

      subscriber.sql(event)
    end

    it "suppresses 'ActiveRecord::SchemaMigration Load' events from being logged" do
      event = build_event("ActiveRecord::SchemaMigration Load", sql: "SELECT `schema_migrations`.* FROM `schema_migrations`")
      expect(subscriber).not_to receive(:old_sql)

      subscriber.sql(event)
    end

    it "suppresses 'ActiveRecord::InternalMetadata Load' events from being logged" do
      event = build_event("ActiveRecord::InternalMetadata Load", sql: "SELECT `ar_internal_metadata`.* FROM `ar_internal_metadata`")
      expect(subscriber).not_to receive(:old_sql)

      subscriber.sql(event)
    end

    it "suppresses events whose SQL matches /schema_migrations/" do
      event = build_event("SQL", sql: "SELECT version FROM schema_migrations")
      expect(subscriber).not_to receive(:old_sql)

      subscriber.sql(event)
    end

    it "delegates queries with other names to old_sql" do
      event = build_event("User Load", sql: "SELECT `users`.* FROM `users`")
      expect(subscriber).to receive(:old_sql).with(event)

      subscriber.sql(event)
    end

    it "delegates queries without a name to old_sql when not matching schema_migrations" do
      event = build_event(nil, sql: "SELECT 1")
      expect(subscriber).to receive(:old_sql).with(event)

      subscriber.sql(event)
    end
  end

  describe "ActiveRecord::Migration#write" do
    let(:migration) do
      Class.new(ActiveRecord::Migration[7.2]) do
        def change
        end
      end.new("TestMigration", 1)
    end

    it "wraps write with Logging.capture_console specifying the ActiveRecord::Migration module and write method" do
      expect(Logging).to receive(:capture_console).with(module: "ActiveRecord::Migration", method: "write").and_call_original
      expect(migration).to receive(:original_write).with("== 1 TestMigration: migrating ==").and_call_original

      migration.write("== 1 TestMigration: migrating ==")
    end

    it "captures migration console output and routes it to Rails.logger" do
      migration.verbose = true
      expect(Rails.logger).to receive(:info).with(
        "migrating test",
        hash_including(module: "ActiveRecord::Migration", method: "write", stream: "stdout")
      )

      migration.write("migrating test")
    ensure
      migration.verbose = false
    end
  end

  describe "ActiveRecord::Tasks::DatabaseTasks.create" do
    it "wraps create in Logging.capture_console specifying the ActiveRecord::Tasks::DatabaseTasks module and create method" do
      config = { "adapter" => "mysql2", "database" => "test_db" }

      expect(Logging).to receive(:capture_console).with(module: "ActiveRecord::Tasks::DatabaseTasks", method: "create").and_call_original
      expect(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_create).with(config, :extra_arg)

      ActiveRecord::Tasks::DatabaseTasks.create(config, :extra_arg)
    end

    it "captures stdout output during create and routes to Rails.logger" do
      config = { "adapter" => "mysql2", "database" => "test_db" }

      allow(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_create) do
        puts "Database test_db created"
      end

      expect(Rails.logger).to receive(:info).with(
        "Database test_db created",
        hash_including(module: "ActiveRecord::Tasks::DatabaseTasks", method: "create", stream: "stdout")
      )

      ActiveRecord::Tasks::DatabaseTasks.create(config)
    end

    it "captures stderr output during create and routes to Rails.logger.warn" do
      config = { "adapter" => "mysql2", "database" => "test_db" }

      allow(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_create) do
        warn "Database test_db warning"
      end

      expect(Rails.logger).to receive(:warn).with(
        "Database test_db warning",
        hash_including(module: "ActiveRecord::Tasks::DatabaseTasks", method: "create", stream: "stderr")
      )

      ActiveRecord::Tasks::DatabaseTasks.create(config)
    end
  end

  describe "ActiveRecord::Tasks::DatabaseTasks.create_all" do
    it "wraps create_all in Logging.capture_console specifying the create_all method" do
      expect(Logging).to receive(:capture_console).with(module: "ActiveRecord::Tasks::DatabaseTasks", method: "create_all").and_call_original
      expect(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_create_all)

      ActiveRecord::Tasks::DatabaseTasks.create_all
    end

    it "captures stdout output during create_all and routes to Rails.logger" do
      allow(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_create_all) do
        puts "All databases created"
      end

      expect(Rails.logger).to receive(:info).with(
        "All databases created",
        hash_including(module: "ActiveRecord::Tasks::DatabaseTasks", method: "create_all", stream: "stdout")
      )

      ActiveRecord::Tasks::DatabaseTasks.create_all
    end

    it "captures stderr output during create_all and routes to Rails.logger.warn" do
      allow(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_create_all) do
        warn "Create all warning"
      end

      expect(Rails.logger).to receive(:warn).with(
        "Create all warning",
        hash_including(module: "ActiveRecord::Tasks::DatabaseTasks", method: "create_all", stream: "stderr")
      )

      ActiveRecord::Tasks::DatabaseTasks.create_all
    end
  end

  describe "ActiveRecord::Tasks::DatabaseTasks.drop" do
    it "wraps drop in Logging.capture_console specifying the ActiveRecord::Tasks::DatabaseTasks module and drop method" do
      config = { "adapter" => "mysql2", "database" => "test_db" }

      expect(Logging).to receive(:capture_console).with(module: "ActiveRecord::Tasks::DatabaseTasks", method: "drop").and_call_original
      expect(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_drop).with(config, :extra_arg)

      ActiveRecord::Tasks::DatabaseTasks.drop(config, :extra_arg)
    end

    it "captures stdout output during drop and routes to Rails.logger" do
      config = { "adapter" => "mysql2", "database" => "test_db" }

      allow(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_drop) do
        puts "Database test_db dropped"
      end

      expect(Rails.logger).to receive(:info).with(
        "Database test_db dropped",
        hash_including(module: "ActiveRecord::Tasks::DatabaseTasks", method: "drop", stream: "stdout")
      )

      ActiveRecord::Tasks::DatabaseTasks.drop(config)
    end

    it "captures stderr output during drop and routes to Rails.logger.warn" do
      config = { "adapter" => "mysql2", "database" => "test_db" }

      allow(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_drop) do
        warn "Database test_db drop warning"
      end

      expect(Rails.logger).to receive(:warn).with(
        "Database test_db drop warning",
        hash_including(module: "ActiveRecord::Tasks::DatabaseTasks", method: "drop", stream: "stderr")
      )

      ActiveRecord::Tasks::DatabaseTasks.drop(config)
    end
  end

  describe "ActiveRecord::Tasks::DatabaseTasks.drop_all" do
    it "wraps drop_all in Logging.capture_console specifying the drop_all method" do
      expect(Logging).to receive(:capture_console).with(module: "ActiveRecord::Tasks::DatabaseTasks", method: "drop_all").and_call_original
      expect(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_drop_all)

      ActiveRecord::Tasks::DatabaseTasks.drop_all
    end

    it "captures stdout output during drop_all and routes to Rails.logger" do
      allow(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_drop_all) do
        puts "All databases dropped"
      end

      expect(Rails.logger).to receive(:info).with(
        "All databases dropped",
        hash_including(module: "ActiveRecord::Tasks::DatabaseTasks", method: "drop_all", stream: "stdout")
      )

      ActiveRecord::Tasks::DatabaseTasks.drop_all
    end

    it "captures stderr output during drop_all and routes to Rails.logger.warn" do
      allow(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_drop_all) do
        warn "Drop all warning"
      end

      expect(Rails.logger).to receive(:warn).with(
        "Drop all warning",
        hash_including(module: "ActiveRecord::Tasks::DatabaseTasks", method: "drop_all", stream: "stderr")
      )

      ActiveRecord::Tasks::DatabaseTasks.drop_all
    end
  end

  describe "ActiveRecord::Tasks::DatabaseTasks.migrate_status" do
    it "wraps migrate_status in Logging.capture_console specifying the migrate_status method" do
      expect(Logging).to receive(:capture_console).with(module: "ActiveRecord::Tasks::DatabaseTasks", method: "migrate_status").and_call_original
      expect(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_migrate_status)

      ActiveRecord::Tasks::DatabaseTasks.migrate_status
    end

    it "captures stdout output during migrate_status and routes to Rails.logger" do
      allow(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_migrate_status) do
        puts "Status: up"
      end

      expect(Rails.logger).to receive(:info).with(
        "Status: up",
        hash_including(module: "ActiveRecord::Tasks::DatabaseTasks", method: "migrate_status", stream: "stdout")
      )

      ActiveRecord::Tasks::DatabaseTasks.migrate_status
    end

    it "captures stderr output during migrate_status and routes to Rails.logger.warn" do
      allow(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_migrate_status) do
        warn "Status error"
      end

      expect(Rails.logger).to receive(:warn).with(
        "Status error",
        hash_including(module: "ActiveRecord::Tasks::DatabaseTasks", method: "migrate_status", stream: "stderr")
      )

      ActiveRecord::Tasks::DatabaseTasks.migrate_status
    end
  end

  describe "ActiveRecord::Tasks::DatabaseTasks.purge_all" do
    it "wraps purge_all in Logging.capture_console specifying the purge_all method" do
      expect(Logging).to receive(:capture_console).with(module: "ActiveRecord::Tasks::DatabaseTasks", method: "purge_all").and_call_original
      expect(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_purge_all)

      ActiveRecord::Tasks::DatabaseTasks.purge_all
    end

    it "captures stdout output during purge_all and routes to Rails.logger" do
      allow(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_purge_all) do
        puts "Purged all databases"
      end

      expect(Rails.logger).to receive(:info).with(
        "Purged all databases",
        hash_including(module: "ActiveRecord::Tasks::DatabaseTasks", method: "purge_all", stream: "stdout")
      )

      ActiveRecord::Tasks::DatabaseTasks.purge_all
    end

    it "captures stderr output during purge_all and routes to Rails.logger.warn" do
      allow(ActiveRecord::Tasks::DatabaseTasks).to receive(:original_purge_all) do
        warn "Purge warning"
      end

      expect(Rails.logger).to receive(:warn).with(
        "Purge warning",
        hash_including(module: "ActiveRecord::Tasks::DatabaseTasks", method: "purge_all", stream: "stderr")
      )

      ActiveRecord::Tasks::DatabaseTasks.purge_all
    end
  end
end
