# frozen_string_literal: true

# Resolve a database password from AWS Secrets Manager instead of a static copy in Chamber.
#
# WHY THIS EXISTS
# Some of our Aurora clusters are created with `manage_master_user_password = true`, which means AWS
# owns the password: it generates the value, stores it in a Secrets Manager secret it controls, and
# ROTATES it on a schedule (every 7 days by default). Any copy of that password taken at deploy time
# is correct only until the next rotation. That is exactly how the env-prod screening service broke:
# Chamber held a copy from 2026-08-20, AWS rotated on 09-11 and 09-18, and the next pod to start got
# "Access denied for user 'screeningmaster'". The running pod survived only because rotation does not
# disturb connections that are already open, so the breakage stayed invisible for twelve days.
#
# The fix is to stop copying. When <PREFIX>_DB_SECRET_ID is set, the password is read from the secret
# at boot, so a pod always starts with whatever AWS considers current.
#
# This mirrors how the app already reads its other externally-owned secret: scripts/token_auth.py
# fetches <ENVIRONMENT>/czid-services-private-key from Secrets Manager with the pod's IRSA role. The
# IAM grant lives beside it (seqtoid-ssot-infra infra/state-foundation/app: ReadDbSecret /
# ReadScreeningDbSecret), and the secret is encrypted with the shared app KMS key the role can
# already decrypt. No new credential path, no new trust.
#
# Failure is LOUD. If a secret id is configured and cannot be read, we raise instead of falling back
# to a possibly-stale Chamber value: a pod that cannot get the current password cannot talk to the
# database anyway, and a clear boot failure beats a confusing "Access denied" later.
module SecretResolver
  class Error < StandardError; end

  OPEN_TIMEOUT = 2
  READ_TIMEOUT = 5
  RETRY_LIMIT  = 3

  module_function

  # Password for a connection, preferring the AWS-managed secret when one is configured.
  #
  #   prefix - env var prefix, e.g. "SCREENING_DB" -> SCREENING_DB_SECRET_ID / SCREENING_DB_PASSWORD
  #   fallback_keys - env vars to fall back to, in order, when no secret id is set
  def db_password(prefix, *fallback_keys)
    secret_id = ENV["#{prefix}_SECRET_ID"]
    return password_from_secret(secret_id) if secret_id && !secret_id.strip.empty?

    ["#{prefix}_PASSWORD", *fallback_keys].each do |key|
      value = ENV[key]
      return value unless value.nil?
    end
    ""
  end

  # Memoized per process: database.yml can be evaluated more than once during boot, and a rotating
  # secret is still stable within a single process lifetime.
  def password_from_secret(secret_id)
    @cache ||= {}
    return @cache[secret_id] if @cache.key?(secret_id)

    @cache[secret_id] = fetch_password(secret_id)
  end

  def fetch_password(secret_id)
    require "aws-sdk-secretsmanager"
    require "json"

    client = Aws::SecretsManager::Client.new(
      region: ENV["AWS_REGION"] || ENV["AWS_DEFAULT_REGION"] || "us-west-2",
      http_open_timeout: OPEN_TIMEOUT,
      http_read_timeout: READ_TIMEOUT,
      retry_limit: RETRY_LIMIT
    )
    raw = client.get_secret_value(secret_id: secret_id).secret_string
    raise Error, "secret #{secret_id} has no secret_string" if raw.nil? || raw.empty?

    # RDS-managed secrets are JSON ({"username":...,"password":...}); a hand-made secret may be the
    # password itself. Accept both so this is not tied to one secret shape.
    parsed = begin
      JSON.parse(raw)
    rescue JSON::ParserError
      nil
    end
    return raw unless parsed.is_a?(Hash)

    password = parsed["password"]
    raise Error, "secret #{secret_id} is JSON but has no \"password\" key" if password.nil?

    password
  rescue Aws::Errors::ServiceError, Seahorse::Client::NetworkingError => e
    # Do NOT fall back to a stale copy; see the note at the top of this file.
    raise Error, "could not read database password from Secrets Manager secret #{secret_id}: " \
                 "#{e.class}: #{e.message}"
  end
end
