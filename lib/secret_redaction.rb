# frozen_string_literal: true

require "digest"

# Redaction helpers for credential material that must never reach a log sink
# (Rails log -> stdout -> CloudWatch/Loki/Grafana, and Sentry).
#
# Two kinds show up in this app's diagnostics:
#
#   1. Third-party bearer tokens. A BaseSpace access token grants read access to
#      the USER'S Illumina BaseSpace account -- their sequencing data, not ours
#      (SMP-1729). It is the user's credential, held by us in transit.
#   2. Presigned URLs. The query string IS the credential for its validity
#      window (S3 X-Amz-Signature, BaseSpace HrefContent download paths).
#
# Neither may be logged. Where a correlation id is genuinely needed to tie log
# lines together -- e.g. several samples share one BaseSpace token, so "which
# token" is a real debugging question -- log `fingerprint`, a truncated SHA256.
# It is not reversible and shares no prefix with the secret, so it cannot be
# replayed against the provider the way a "first N chars" mask can.
module SecretRedaction
  REDACTED = "[REDACTED]"

  # 12 hex chars = 48 bits of the digest. Far more than enough to tell two
  # tokens apart inside one investigation, and far too little to recover the
  # input. Prefixed so a reader never mistakes it for the token itself.
  FINGERPRINT_LENGTH = 12
  FINGERPRINT_PREFIX = "sha256:"

  # Extras/context keys whose VALUE is credential material. Key-based matching is
  # the reliable signal: an access token is an opaque random string with no
  # distinguishing shape, so matching on the value alone would either miss real
  # tokens or redact innocent ids. Anything ending in _fingerprint / _digest is
  # already a one-way derivative and is deliberately preserved.
  SECRET_KEY_PATTERN = /
    access[_-]?token | auth[_-]?token | refresh[_-]?token | id[_-]?token |
    \btoken\b | secret | password | passwd | api[_-]?key | access[_-]?key |
    authorization | credential | private[_-]?key | session[_-]?id
  /xi
  SAFE_KEY_PATTERN = /(?:fingerprint|digest)\z/i

  # A URL anywhere inside free text (e.g. the stderr curl hands back).
  URL_PATTERN = %r{https?://[^\s"'<>\\)\]\}]+}

  # Query parameters that make a URL a bearer credential on its own.
  SIGNED_QUERY_PARAM_PATTERN = /
    x-amz-signature | x-amz-credential | x-amz-security-token |
    awsaccesskeyid | \bsignature\b | \bsig\b | access[_-]?token | \btoken\b
  /xi

  # "Authorization: Bearer <token>" / "x-access-token: <token>" as they appear
  # inside a serialized request or a provider error body.
  BEARER_PATTERN = /((?:bearer|x-access-token)[\s:=]+)(\S+)/i

  # Guard against a self-referential or pathologically nested structure. Deeper
  # than this is marked truncated, NOT redacted -- it is a depth limit, not a
  # finding, and a reader should not mistake it for a secret we removed.
  MAX_SCRUB_DEPTH = 8
  TRUNCATED = "[TRUNCATED]"

  module_function

  # A non-reversible correlation id for a secret. nil in, nil out, so callers can
  # pass it straight into a log payload without a presence check.
  def fingerprint(value)
    return nil if value.nil?

    string = value.to_s
    return nil if string.empty?

    "#{FINGERPRINT_PREFIX}#{Digest::SHA256.hexdigest(string)[0, FINGERPRINT_LENGTH]}"
  end

  # Strip the credential-bearing query string and fragment from a URL, keeping
  # the origin and object path -- which is what you actually need to identify
  # the file in a bucket listing. Non-URL input is returned untouched.
  def redact_url(value)
    return value unless value.is_a?(String)

    base, separator, _rest = value.partition(/[?#]/)
    return value if separator.empty?

    "#{base}?#{REDACTED}"
  end

  # Same, but only for URLs that are demonstrably signed. Used on generic
  # payloads where a plain URL is useful context worth keeping intact.
  def redact_url_if_signed(value)
    signed_url?(value) ? redact_url(value) : value
  end

  def signed_url?(value)
    return false unless value.is_a?(String)

    _base, separator, rest = value.partition(/[?#]/)
    return false if separator.empty?

    SIGNED_QUERY_PARAM_PATTERN.match?(rest)
  end

  # Redact EVERY URL and bearer token embedded in free text. Use where the URLs
  # in play are known to be credentialed -- e.g. the stderr of the curl that
  # downloads BaseSpace HrefContent paths.
  def redact_text(value)
    return value unless value.is_a?(String)

    redact_bearer(value.gsub(URL_PATTERN) { |url| redact_url(url) })
  end

  # Same, but leaves plain unsigned URLs intact. Use on generic payloads where a
  # bare URL is context worth keeping.
  def redact_signed_text(value)
    return value unless value.is_a?(String)

    redact_bearer(value.gsub(URL_PATTERN) { |url| redact_url_if_signed(url) })
  end

  def redact_bearer(value)
    return value unless value.is_a?(String)

    value.gsub(BEARER_PATTERN) { "#{Regexp.last_match(1)}#{REDACTED}" }
  end

  # Apply redact_url to a single path or to every element of a list of paths.
  def redact_urls(value)
    value.is_a?(Array) ? value.map { |item| redact_url(item) } : redact_url(value)
  end

  # Recursively redact a log/telemetry payload: values under a secret-looking key
  # are dropped entirely, signed URLs lose their signature, and bearer tokens in
  # free text are masked. Structure, keys and every non-secret value survive, so
  # the payload stays as debuggable as it was.
  def scrub(value, depth = 0)
    return TRUNCATED if depth > MAX_SCRUB_DEPTH

    case value
    when Hash
      value.each_with_object({}) do |(key, val), acc|
        acc[key] = secret_key?(key) ? REDACTED : scrub(val, depth + 1)
      end
    when Array
      value.map { |item| scrub(item, depth + 1) }
    when String
      redact_signed_text(value)
    else
      value
    end
  end

  def secret_key?(key)
    name = key.to_s
    return false if SAFE_KEY_PATTERN.match?(name)

    SECRET_KEY_PATTERN.match?(name)
  end
end
