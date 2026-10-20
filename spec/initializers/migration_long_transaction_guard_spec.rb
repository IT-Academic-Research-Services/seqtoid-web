require "rails_helper"

RSpec.describe MigrationLongTransactionGuard do
  let(:conn) { double("connection", adapter_name: "Mysql2") }

  around do |ex|
    old = ENV["MIGRATION_GUARD_MAX_TRANSACTION_AGE_SECONDS"]
    ex.run
  ensure
    old.nil? ? ENV.delete("MIGRATION_GUARD_MAX_TRANSACTION_AGE_SECONDS") : ENV["MIGRATION_GUARD_MAX_TRANSACTION_AGE_SECONDS"] = old
  end

  def rows(*list)
    double("result", to_a: list)
  end

  it "lets the migration run when no transaction is older than the threshold" do
    allow(conn).to receive(:select_all).and_return(rows)
    expect { described_class.check!(conn, "AddX (1)") }.not_to raise_error
  end

  it "refuses to run, naming the blocker, when a long transaction is open" do
    allow(conn).to receive(:select_all).and_return(rows({ "thread_id" => 62_938, "age_seconds" => 7738, "rows_modified" => 46_324_090 }))
    expect { described_class.check!(conn, "AddX (1)") }
      .to raise_error(described_class::LongTransactionError, /thread 62938 open 7738s/)
  end

  it "uses the configured threshold and excludes its own session" do
    ENV["MIGRATION_GUARD_MAX_TRANSACTION_AGE_SECONDS"] = "120"
    expect(conn).to receive(:select_all) do |sql|
      expect(sql).to include("INTERVAL 120 SECOND")
      expect(sql).to include("CONNECTION_ID()")
      rows
    end
    described_class.check!(conn, "AddX (1)")
  end

  it "is disabled at 0" do
    ENV["MIGRATION_GUARD_MAX_TRANSACTION_AGE_SECONDS"] = "0"
    expect(conn).not_to receive(:select_all)
    described_class.check!(conn, "AddX (1)")
  end

  it "skips non-MySQL adapters" do
    other = double("connection", adapter_name: "SQLite")
    expect(other).not_to receive(:select_all)
    described_class.check!(other, "AddX (1)")
  end

  it "never blocks a deploy when the check itself cannot run" do
    allow(conn).to receive(:select_all).and_raise(StandardError, "Access denied; you need the PROCESS privilege")
    expect { described_class.check!(conn, "AddX (1)") }.not_to raise_error
  end

  it "is wired in front of every migration" do
    migration = Class.new(ActiveRecord::Migration[7.2]) do
  def change
  end
end.new("AddX", 1)
    expect(described_class).to receive(:check!).with(conn, /AddX|1/).and_raise(described_class::LongTransactionError, "blocked")
    expect { migration.exec_migration(conn, :up) }.to raise_error(described_class::LongTransactionError)
  end
end
