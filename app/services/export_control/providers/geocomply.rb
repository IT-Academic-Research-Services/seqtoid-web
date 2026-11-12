# GeoComply device-location provider (server side), selected by AppConfig::DEVICE_LOCATION_PROVIDER =
# "geocomply". Uses BrowserGuard's JWT-based integration (SDK v2.19.1+), following GeoComply's quickstart
# backend:
#
#   1. authorization_token: we sign a short-lived ES256 JWT for the user's login session. The attestation
#      page passes it to GcHtml5.authorize(). The signing key never leaves the server; GeoComply verifies
#      the token with the public key registered in its portal (kid = the portal's sk_... key id).
#   2. The page calls GcHtml5.verify() and posts the result -- a JWT signed by GeoComply's engine -- as
#      attestation_token.
#   3. verify_token: the result is NEVER trusted as sent. Its ES256 signature is verified against
#      GeoComply's published engine keys (validate_result), then its fields are checked:
#        - it has a gc_transaction id
#        - GeoComply reported a pass (error_code 0)
#        - it is for OUR operator (akey) and for THIS user and login session (user_id, user_session_id),
#          which GeoComply copies from the token we signed
#        - it has a time bound and is within it (exp / expires_at not passed, iat within MAX_PACKET_AGE),
#          and GeoComply still considers it current (geolocate_in - buffer_time > 0)
#        - its transaction id has not been used before (no replay)
#        - it has a country (location.country_code), and that country is not blocked
#
# Configuration comes from chamber (ENV), never from the request:
#   GEOCOMPLY_AKEY              operator akey (iss/sub of our token; must match the result's akey)
#   GEOCOMPLY_SIGNING_KEY       EC P-256 private key, PEM (SEC1 or PKCS8)
#   GEOCOMPLY_SIGNING_KEY_ID    the portal's signing key id (sk_...), sent as the JWT kid
#   GEOCOMPLY_RESULT_KEYS_URL   GeoComply's geodata-jwt-keys URL for this environment (live key set)
#   GEOCOMPLY_RESULT_KEYS_JSON  a pinned copy of that key set, used when the URL is unset or unreachable
#
# FAIL-CLOSED: missing configuration, no usable engine keys, or any failed check means status "failed".
module ExportControl
  module Providers
    module Geocomply
      PROVIDER_NAME = "geocomply".freeze

      class NoEngineKeys < StandardError; end

      # GeoComply recommends about an hour; the maximum is 24 hours.
      AUTH_TOKEN_TTL = 1.hour
      AUTH_TOKEN_AUDIENCE = "geocomply".freeze
      RESULT_ALGORITHM = "ES256".freeze

      # How old a result may be when it reaches us, when it carries an iat.
      MAX_PACKET_AGE = 5.minutes

      # How long a fetched engine key set is reused before it is fetched again.
      RESULT_KEYS_TTL = 10.minutes

      # Matches the WAF geo-block (counsel's list). Defence in depth: GeoComply's own geofence rules should
      # already fail these, but we never accept them even if it does not.
      BLOCKED_COUNTRIES = %w[CU IR KP RU SY UA].freeze

      CREDENTIAL_ENV_KEYS = %w[GEOCOMPLY_AKEY GEOCOMPLY_SIGNING_KEY GEOCOMPLY_SIGNING_KEY_ID].freeze

      # The validated result fields this module relies on.
      Packet = Struct.new(:error_code, :transaction_id, :akey, :user_id, :user_session_id, :country,
                          :issued_at, :expires_at, :geolocate_in, :buffer_time, :error_message,
                          keyword_init: true)

      @result_keys_mutex = Mutex.new
      @result_keys_cache = nil # { url:, at:, keys: [[kid, OpenSSL::PKey::EC], ...] }

      module_function

      def credentials_configured?
        CREDENTIAL_ENV_KEYS.all? { |k| ENV[k].present? }
      end

      # The ES256 JWT the page passes to GcHtml5.authorize(). user_id must not contain PII, so it is our
      # numeric user id. Raises when credentials are missing or the key is not an EC private key.
      def authorization_token(user_id:, session_id:, now: Time.current)
        raise ArgumentError, "GeoComply credentials are not configured" unless credentials_configured?

        akey = ENV["GEOCOMPLY_AKEY"]
        payload = {
          iss: akey,
          sub: akey,
          aud: AUTH_TOKEN_AUDIENCE,
          jti: SecureRandom.uuid,
          iat: now.to_i,
          exp: (now + AUTH_TOKEN_TTL).to_i,
          ctx: { user_id: user_id.to_s, session_id: session_id.to_s },
        }
        key = OpenSSL::PKey::EC.new(normalize_pem(ENV["GEOCOMPLY_SIGNING_KEY"]))
        JWT.encode(payload, key, "ES256", { kid: ENV["GEOCOMPLY_SIGNING_KEY_ID"], typ: "JWT" })
      end

      def verify_token(token, ctx = {})
        return failed(DeviceLocationAttestation::FAILURE_MALFORMED) if token.nil? || token.to_s.strip.empty?
        return failed(DeviceLocationAttestation::FAILURE_PROVIDER_ERROR) unless credentials_configured?

        payload, reason = validate_result(token.to_s)
        return failed(reason) if payload.nil?

        evaluate(packet_from(payload), ctx)
      end

      # Checks the fields of a result whose signature validate_result has already verified.
      def evaluate(packet, ctx)
        ref = packet.transaction_id.to_s.strip
        country = packet.country.to_s.strip.upcase

        return failed(DeviceLocationAttestation::FAILURE_MALFORMED) if ref.empty?
        # A GeoComply fail (boundary, proxy, jailbreak...). Its rules are in packet.error_message.
        return failed(DeviceLocationAttestation::FAILURE_SPOOFED, ref, country) unless packet.error_code.to_s == "0"
        return failed(DeviceLocationAttestation::FAILURE_MALFORMED, ref) if country.empty?
        return failed(DeviceLocationAttestation::FAILURE_INVALID_SIGNATURE, ref, country) unless issued_for?(packet, ctx)
        return failed(DeviceLocationAttestation::FAILURE_EXPIRED, ref, country) unless fresh?(packet)
        return failed(DeviceLocationAttestation::FAILURE_SPOOFED, ref, country) if replayed?(ref)
        return failed(DeviceLocationAttestation::FAILURE_SPOOFED, ref, country) if BLOCKED_COUNTRIES.include?(country)

        ExportControl::DeviceLocationProvider::Result.new(
          status: DeviceLocationAttestation::STATUS_VERIFIED,
          failure_reason: nil,
          provider: PROVIDER_NAME,
          attestation_ref: ref,
          asserted_country: country
        )
      end

      # Verifies the result JWT's ES256 signature against GeoComply's engine keys and returns
      # [payload, nil], or [nil, failure_reason]. The token's kid picks the key first; if it is not in the
      # cached set the set is fetched once more (key rotation), then every key is tried. Raises
      # NoEngineKeys when no key can be loaded (misconfiguration or outage -> provider error -> deny).
      def validate_result(token)
        kid = JWT.decode(token, nil, false).last["kid"]
        keys = result_keys
        keys = result_keys(force_refresh: true) if kid && keys.none? { |k, _| k == kid } && ENV["GEOCOMPLY_RESULT_KEYS_URL"].present?
        raise NoEngineKeys, "no GeoComply engine keys available" if keys.empty?

        keys.sort_by { |k, _| k == kid ? 0 : 1 }.each do |_, key|
          payload, = JWT.decode(token, key, true, algorithm: RESULT_ALGORITHM)
          return [nil, DeviceLocationAttestation::FAILURE_EXPIRED] if expired?(payload["expires_at"])

          return [payload, nil]
        rescue JWT::ExpiredSignature
          return [nil, DeviceLocationAttestation::FAILURE_EXPIRED]
        rescue JWT::VerificationError, JWT::IncorrectAlgorithm
          next
        end
        [nil, DeviceLocationAttestation::FAILURE_INVALID_SIGNATURE]
      rescue JWT::DecodeError
        [nil, DeviceLocationAttestation::FAILURE_MALFORMED]
      end

      def packet_from(payload)
        location = payload["location"].is_a?(Hash) ? payload["location"] : {}
        Packet.new(
          error_code: payload["error_code"],
          transaction_id: payload["gc_transaction"],
          akey: payload["akey"],
          user_id: payload["user_id"],
          user_session_id: payload["user_session_id"],
          country: location["country_code"],
          issued_at: epoch_time(payload["iat"]),
          expires_at: epoch_time(payload["exp"] || payload["expires_at"]),
          geolocate_in: Integer(payload["geolocate_in"].to_s, 10, exception: false),
          buffer_time: Integer(payload["buffer_time"].to_s, 10, exception: false),
          error_message: payload["error_message"].to_s
        )
      end

      # GeoComply's engine public keys as [[kid, key], ...], unexpired only. Prefers the live key set from
      # GEOCOMPLY_RESULT_KEYS_URL (cached RESULT_KEYS_TTL); falls back to the pinned GEOCOMPLY_RESULT_KEYS_JSON
      # when the URL is unset, unreachable or empty.
      def result_keys(force_refresh: false)
        url = ENV["GEOCOMPLY_RESULT_KEYS_URL"].presence
        if url
          @result_keys_mutex.synchronize do
            cached = @result_keys_cache
            if !force_refresh && cached && cached[:url] == url && cached[:keys].any? &&
               cached[:at] > RESULT_KEYS_TTL.ago
              return cached[:keys]
            end
          end
          keys = fetch_result_keys(url)
          keys = pinned_result_keys if keys.empty?
          @result_keys_mutex.synchronize { @result_keys_cache = { url: url, at: Time.current, keys: keys } } if keys.any?
          keys
        else
          pinned_result_keys
        end
      end

      def fetch_result_keys(url)
        response = HttpResilience.breaker(:geocomply_result_keys).run do
          HttpResilience.get(url, open_timeout: 3, read_timeout: 5)
        end
        return [] unless response.is_a?(Net::HTTPSuccess)

        parse_key_set(response.body)
      rescue StandardError => e
        Rails.logger.error("[Geocomply] engine key set unavailable, using pinned keys: #{e.class}: #{e.message}")
        []
      end

      def pinned_result_keys
        raw = ENV["GEOCOMPLY_RESULT_KEYS_JSON"]
        raw.present? ? parse_key_set(raw) : []
      end

      # geodata-jwt-keys payload: {"status":"success","keys":[{"kid","public_key" (base64 PEM),"not_after"}]}.
      # Entries that do not decode, or are past not_after, are skipped.
      def parse_key_set(json)
        body = JSON.parse(json)
        return [] unless body.is_a?(Hash) && body["status"] == "success" && body["keys"].is_a?(Array)

        body["keys"].filter_map do |entry|
          next unless entry.is_a?(Hash) && entry["kid"].is_a?(String) && entry["public_key"].is_a?(String)
          next if entry["not_after"].present? && Time.iso8601(entry["not_after"]) <= Time.current

          [entry["kid"], OpenSSL::PKey::EC.new(Base64.decode64(entry["public_key"]))]
        rescue ArgumentError, OpenSSL::PKey::PKeyError
          nil
        end
      rescue JSON::ParserError
        []
      end

      def issued_for?(packet, ctx)
        ctx[:user_id].present? && ctx[:session_id].present? &&
          packet.akey.to_s == ENV["GEOCOMPLY_AKEY"].to_s &&
          packet.user_id.to_s == ctx[:user_id].to_s &&
          packet.user_session_id.to_s == ctx[:session_id].to_s
      end

      # A result must carry at least one time bound (exp / expires_at, or iat). GeoComply's quickstart only
      # sometimes sets expiry, so either is accepted; a result with neither is refused.
      def fresh?(packet)
        return false if packet.expires_at.nil? && packet.issued_at.nil?
        return false if packet.expires_at && packet.expires_at <= Time.current
        return false if packet.issued_at && (packet.issued_at < MAX_PACKET_AGE.ago || packet.issued_at > 1.minute.from_now)

        (packet.geolocate_in.to_i - packet.buffer_time.to_i).positive?
      end

      def expired?(epoch)
        epoch.is_a?(Numeric) && epoch <= Time.current.to_i
      end

      def epoch_time(value)
        value.is_a?(Numeric) ? Time.zone.at(value) : nil
      end

      # Tolerate keys stored with escaped "\n" instead of real newlines.
      def normalize_pem(pem)
        pem.to_s.gsub("\\n", "\n").strip
      end

      def replayed?(ref)
        DeviceLocationAttestation.where(device_provider: PROVIDER_NAME, attestation_ref: ref).exists?
      end

      def failed(reason, ref = nil, country = nil)
        ExportControl::DeviceLocationProvider::Result.new(
          status: DeviceLocationAttestation::STATUS_FAILED,
          failure_reason: reason,
          provider: PROVIDER_NAME,
          attestation_ref: ref,
          asserted_country: country.presence
        )
      end
    end
  end
end
