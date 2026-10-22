require "rails_helper"

RSpec.describe SignupRateLimit do
  it "uses an in-memory store in tests" do
    expect(described_class.build_store(test: true)).to be_a(ActiveSupport::Cache::MemoryStore)
  end

  # Regression: the deployed (non-test) store must build with the bundled gems. With a pooled
  # RedisCacheStore, connection_pool 3.x raised ArgumentError at boot and broke the main image build.
  it "builds the Redis-backed store used outside tests without raising" do
    store = nil
    expect { store = described_class.build_store(test: false) }.not_to raise_error
    expect(store).to be_a(ActiveSupport::Cache::RedisCacheStore)
  end
end
