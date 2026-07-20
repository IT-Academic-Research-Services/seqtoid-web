# frozen_string_literal: true

require "rails_helper"
require Rails.root.join("lib/sentry_event_filter").to_s

RSpec.describe SentryEventFilter do
  # Build `outer` raised with `inner` as its cause, the way Ruby links a rescue
  # that re-raises -- so exception.cause reflects a real cause chain.
  def raise_with_cause(outer, inner)
    begin
      raise inner
    rescue Exception # rubocop:disable Lint/RescueException
      begin
        raise outer
      rescue => e
        return e
      end
    end
  end

  describe ".shutdown_connect_race?" do
    it "is TRUE for a connect-in-progress error caused by a shutdown Interrupt (the scheduler race)" do
      ex = raise_with_cause(Errno::EALREADY, Interrupt.new)
      expect(described_class.shutdown_connect_race?(ex)).to be(true)
    end

    it "is TRUE for EINPROGRESS caused by a SignalException" do
      ex = raise_with_cause(IO::EINPROGRESSWaitWritable.new, SignalException.new("SIGTERM"))
      expect(described_class.shutdown_connect_race?(ex)).to be(true)
    end

    it "is FALSE for a connect-in-progress error with NO shutdown signal in the cause chain (a real connect issue)" do
      ex = raise_with_cause(Errno::EALREADY, RuntimeError.new("boom"))
      expect(described_class.shutdown_connect_race?(ex)).to be(false)
    end

    it "is FALSE for a real Redis outage during shutdown (ECONNREFUSED is not connect-in-progress)" do
      ex = raise_with_cause(Errno::ECONNREFUSED, Interrupt.new)
      expect(described_class.shutdown_connect_race?(ex)).to be(false)
    end

    it "is FALSE for a bare shutdown Interrupt with no connect error" do
      expect(described_class.shutdown_connect_race?(Interrupt.new)).to be(false)
    end

    it "is FALSE for nil" do
      expect(described_class.shutdown_connect_race?(nil)).to be(false)
    end
  end

  describe ".cause_chain" do
    it "walks the cause chain and is bounded against cycles" do
      ex = raise_with_cause(Errno::EALREADY, Interrupt.new)
      chain = described_class.cause_chain(ex)
      expect(chain.first).to be_a(Errno::EALREADY)
      expect(chain.any? { |e| e.is_a?(Interrupt) }).to be(true)
      expect(chain.size).to be <= SentryEventFilter::MAX_CAUSE_DEPTH
    end
  end
end
