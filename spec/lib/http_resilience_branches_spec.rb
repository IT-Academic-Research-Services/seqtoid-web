# frozen_string_literal: true

require "rails_helper"

# Branch coverage for HttpResilience. http_resilience_spec drives the state machine
# and the retry loop with a live Rails.logger; this file closes the remaining arms:
#   * reset_window_elapsed? / elapsed_since_open on a breaker that has never opened
#     (the `@opened_at.nil?` guards -- unreachable through `open?`, which
#     short-circuits on `@state == :open` before ever calling them).
#   * the `Rails.logger`-absent fallback of the three log helpers, which must warn to
#     stderr instead of raising NoMethodError on nil.
RSpec.describe HttpResilience do
  after { HttpResilience.reset! }

  describe HttpResilience::CircuitBreaker do
    let(:fake_now) { { t: 500.0 } }
    let(:clock) { -> { fake_now[:t] } }

    subject(:breaker) do
      described_class.new(:dep, failure_threshold: 2, reset_timeout: 30, clock: clock)
    end

    it "treats a never-opened breaker's reset window as already elapsed" do
      expect(breaker.state).to eq(:closed)
      expect(breaker.send(:reset_window_elapsed?)).to be(true)
    end

    it "reports zero elapsed time for a never-opened breaker" do
      expect(breaker.send(:elapsed_since_open)).to eq(0)
    end

    it "reports the real elapsed time once the breaker has opened" do
      2.times { expect { breaker.run { raise "boom" } }.to raise_error("boom") }
      expect(breaker.state).to eq(:open)

      fake_now[:t] += 7.0
      expect(breaker.send(:elapsed_since_open)).to eq(7.0)
      expect(breaker.send(:reset_window_elapsed?)).to be(false)
    end

    it "warns to stderr when the circuit opens and Rails.logger is unavailable" do
      allow(Rails).to receive(:logger).and_return(nil)

      expect do
        2.times { expect { breaker.run { raise "boom" } }.to raise_error("boom") }
      end.to output(/\[HttpResilience\] circuit 'dep' OPEN after 2 consecutive failures/).to_stderr

      expect(breaker.state).to eq(:open)
    end
  end

  describe "log helpers without a Rails logger" do
    before { allow(Rails).to receive(:logger).and_return(nil) }

    it "warns to stderr on a retry" do
      expect do
        HttpResilience.log_retry(URI("https://example.test/x"), 1, 3, 0.5, Timeout::Error.new("slow"))
      end.to output(%r{\[HttpResilience\] transient GET example\.test \(attempt 1/3\); retrying in 0\.5s}).to_stderr
    end

    it "warns to stderr when retries are exhausted" do
      expect do
        HttpResilience.log_exhausted(URI("https://example.test/x"), 3, Errno::ECONNRESET.new("reset"))
      end.to output(/\[HttpResilience\] exhausted retries on example\.test after 3 attempts/).to_stderr
    end
  end
end
