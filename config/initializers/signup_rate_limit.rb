# frozen_string_literal: true

# Store for the public sign-up form's rate limits (ExportControlSignupsController). Deliberately NOT
# Rails.cache: env-prod (and staging/sandbox) configure cache_store = :null_store, where every rate_limit
# would silently never trigger. Redis is the same instance Resque uses (REDISCLOUD_URL, see redis.rb).
# Tests use an in-memory store so specs are isolated and need no Redis.
SIGNUP_RATE_LIMIT_STORE =
  if Rails.env.test?
    ActiveSupport::Cache::MemoryStore.new
  else
    ActiveSupport::Cache::RedisCacheStore.new(url: REDISCLOUD_URL, namespace: "signup-rate-limit")
  end
