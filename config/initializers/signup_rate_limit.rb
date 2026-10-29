# frozen_string_literal: true

# Store for the public sign-up form's rate limits (ExportControlSignupsController). Deliberately NOT
# Rails.cache: env-prod (and staging/sandbox) configure cache_store = :null_store, where every rate_limit
# would silently never trigger. Redis is the same instance Resque uses (REDISCLOUD_URL, see redis.rb).
# Tests use an in-memory store so specs are isolated and need no Redis.
module SignupRateLimit
  # pool: false -- with connection_pool 3.x (keyword-only options), ActiveSupport 7.2's RedisCacheStore builds
  # its pool with a positional hash and raises "wrong number of arguments (given 1, expected 0)" at boot, which
  # broke every non-test boot (the main image build's assets:precompile, and any deployed pod). A single client
  # is plenty for a rate-limit counter; the redis 4.x client is thread-safe.
  def self.build_store(test: Rails.env.test?)
    return ActiveSupport::Cache::MemoryStore.new if test

    ActiveSupport::Cache::RedisCacheStore.new(url: REDISCLOUD_URL, namespace: "signup-rate-limit", pool: false)
  end
end

SIGNUP_RATE_LIMIT_STORE = SignupRateLimit.build_store
