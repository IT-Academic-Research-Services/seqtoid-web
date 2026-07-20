# frozen_string_literal: true

require "rails_helper"

# Branch sweep for DeadLetterQueue. The existing spec covers the happy path
# (record + persist + LogUtil), the persist-raises rescue, newest-first ordering
# and the entries limit. This targets the branches it leaves cold:
#   * record with a NIL exception -> the `exception&.class&.name` safe-nav MISS
#     arm AND the `exception || StandardError.new(...)` fallback arm.
#   * safe_args JSON.dump FAILURE rescue arm (unserializable arg -> to_s fallback).
#   * entries / count when redis is UNAVAILABLE (the guard-false early returns).
#   * redis_available? StandardError rescue arm (Resque.redis blows up -> false).
#   * warn_log with NO Rails.logger (the `warn` else arm).
RSpec.describe DeadLetterQueue do
  before { described_class.clear }
  after { described_class.clear }

  describe ".record with a nil exception" do
    it "records nil error fields and dead-letters with a synthesized StandardError" do
      captured = nil
      allow(LogUtil).to receive(:log_error) do |_msg, **kwargs|
        captured = kwargs
      end

      entry = described_class.record("SomeJob", [1], nil)

      # exception&.class&.name and exception&.message both take the nil arm.
      expect(entry["error_class"]).to be_nil
      expect(entry["error"]).to be_nil
      expect(entry["job"]).to eq("SomeJob")

      # exception || StandardError.new("dead-lettered") -> the fallback object.
      expect(captured[:exception]).to be_a(StandardError)
      expect(captured[:exception].message).to eq("dead-lettered")

      # It still persisted despite the nil exception.
      expect(described_class.count).to eq(1)
    end
  end

  describe ".record safe_args fallback" do
    it "falls back to a to_s rendering when the args are not JSON-serializable" do
      allow(LogUtil).to receive(:log_error)

      # Float::NAN cannot be JSON-dumped (JSON::GeneratorError), so safe_args
      # hits its rescue arm and maps each arg through to_s instead.
      entry = described_class.record("NanJob", [Float::NAN], StandardError.new("boom"))

      expect(entry["args"]).to eq(["NaN"])
      # And the persisted entry is still readable (args were made JSON-safe).
      expect(described_class.entries.first["args"]).to eq(["NaN"])
    end
  end

  describe "reads when redis is unavailable" do
    before { allow(described_class).to receive(:redis_available?).and_return(false) }

    it "entries returns an empty array (guard-false early return)" do
      expect(described_class.entries).to eq([])
    end

    it "count returns zero (guard-false early return)" do
      expect(described_class.count).to eq(0)
    end

    it "clear is a no-op that does not touch redis" do
      expect(Resque.redis).not_to receive(:del)
      expect(described_class.clear).to be_nil
    end
  end

  describe ".redis_available?" do
    it "is false (rescued) when probing redis raises" do
      allow(Resque).to receive(:redis).and_raise(StandardError, "redis down")
      expect(described_class.send(:redis_available?)).to be(false)
    end
  end

  describe ".warn_log without a Rails logger" do
    it "warns to stderr when Rails.logger is nil (the else arm)" do
      allow(Rails).to receive(:logger).and_return(nil)
      expect { described_class.send(:warn_log, "[DeadLetter] no logger here") }
        .to output(/no logger here/).to_stderr
    end
  end
end
