require 'rails_helper'

# The GeoComply device-location provider (JWT-based BrowserGuard flow). Results are JWTs signed by
# GeoComply's engine; here a test "engine" key signs them and is published the way GeoComply publishes its
# keys (geodata-jwt-keys: base64 PEM per kid), so the real signature path is exercised end to end.
RSpec.describe ExportControl::Providers::Geocomply do
  let(:user) { create(:user) }
  let(:ctx) { { user_id: user.id, session_id: "sess-1", ip_address: "203.0.113.7" } }
  let(:signing_key) { OpenSSL::PKey::EC.generate("prime256v1") }
  let(:engine_key) { OpenSSL::PKey::EC.generate("prime256v1") }
  let(:keys_url) { "https://keys.example.test/bootstrap/geodata-jwt-keys" }

  def key_set(*entries)
    { status: "success", keys: entries }.to_json
  end

  def key_entry(key, kid: "engine-1", not_after: "2099-01-01T00:00:00Z")
    { kid: kid, alg: "ES256", not_after: not_after, public_key: Base64.strict_encode64(key.public_to_pem) }
  end

  let(:env) do
    { "GEOCOMPLY_AKEY" => "akey-1", "GEOCOMPLY_SIGNING_KEY" => signing_key.to_pem,
      "GEOCOMPLY_SIGNING_KEY_ID" => "sk_test", "GEOCOMPLY_RESULT_KEYS_URL" => nil,
      "GEOCOMPLY_RESULT_KEYS_JSON" => key_set(key_entry(engine_key)), }
  end

  # A "pass" result in the shape of GeoComply's quickstart fixture, bound to our user and session.
  def result_payload(**overrides)
    { gc_transaction: "gc-tx-1", akey: "akey-1", user_id: user.id.to_s, user_session_id: "sess-1",
      location: { source: "wifi", country_code: "US" }, error_code: 0, error_message: "",
      geolocate_in: 3600, buffer_time: 60, iat: Time.current.to_i, exp: 10.minutes.from_now.to_i, }
      .merge(overrides).compact
  end

  def engine_token(payload = result_payload, key: engine_key, kid: "engine-1", alg: "ES256")
    JWT.encode(payload, key, alg, { kid: kid, typ: "JWT" })
  end

  def verify(token, context = ctx)
    ClimateControl.modify(env) { described_class.verify_token(token, context) }
  end

  before { described_class.instance_variable_set(:@result_keys_cache, nil) }

  describe ".verify_token" do
    it "VERIFIES a genuine engine-signed pass for this user and session" do
      result = verify(engine_token)
      expect(result.status).to eq(DeviceLocationAttestation::STATUS_VERIFIED)
      expect(result.provider).to eq("geocomply")
      expect(result.attestation_ref).to eq("gc-tx-1")
      expect(result.asserted_country).to eq("US")
    end

    it "fails MALFORMED for a blank token" do
      expect(verify("  ").failure_reason).to eq(DeviceLocationAttestation::FAILURE_MALFORMED)
    end

    it "fails MALFORMED for something that is not a JWT" do
      expect(verify("not-a-jwt").failure_reason).to eq(DeviceLocationAttestation::FAILURE_MALFORMED)
    end

    it "fails PROVIDER_ERROR when our credentials are missing" do
      env["GEOCOMPLY_AKEY"] = nil
      expect(verify(engine_token).failure_reason).to eq(DeviceLocationAttestation::FAILURE_PROVIDER_ERROR)
    end

    it "fails INVALID_SIGNATURE for a result signed by any other key" do
      forged = engine_token(key: OpenSSL::PKey::EC.generate("prime256v1"))
      expect(verify(forged).failure_reason).to eq(DeviceLocationAttestation::FAILURE_INVALID_SIGNATURE)
    end

    it "fails INVALID_SIGNATURE when the payload was altered after signing" do
      genuine = engine_token
      other = engine_token(result_payload(user_id: "someone-else"))
      tampered = [genuine.split(".")[0], other.split(".")[1], genuine.split(".")[2]].join(".")
      expect(verify(tampered).failure_reason).to eq(DeviceLocationAttestation::FAILURE_INVALID_SIGNATURE)
    end

    it "refuses an unsigned (alg none) result" do
      unsigned = JWT.encode(result_payload, nil, "none")
      expect(verify(unsigned).status).to eq(DeviceLocationAttestation::STATUS_FAILED)
    end

    it "refuses an HS256 result (algorithm confusion)" do
      hs = JWT.encode(result_payload, "secret", "HS256", { kid: "engine-1" })
      expect(verify(hs).failure_reason).to eq(DeviceLocationAttestation::FAILURE_INVALID_SIGNATURE)
    end

    it "fails EXPIRED when exp has passed" do
      token = engine_token(result_payload(exp: 1.minute.ago.to_i))
      expect(verify(token).failure_reason).to eq(DeviceLocationAttestation::FAILURE_EXPIRED)
    end

    it "fails EXPIRED when the non-standard expires_at has passed" do
      token = engine_token(result_payload(exp: nil, expires_at: 1.minute.ago.to_i))
      expect(verify(token).failure_reason).to eq(DeviceLocationAttestation::FAILURE_EXPIRED)
    end

    it "still verifies when the result's kid is not in the key set (tries every key)" do
      expect(verify(engine_token(kid: "rotated")).status).to eq(DeviceLocationAttestation::STATUS_VERIFIED)
    end

    it "skips keys past their not_after" do
      env["GEOCOMPLY_RESULT_KEYS_JSON"] = key_set(key_entry(engine_key, not_after: "2001-01-01T00:00:00Z"))
      expect { verify(engine_token) }.to raise_error(described_class::NoEngineKeys)
    end

    it "RAISES when no engine keys are configured (the controller turns this into a deny)" do
      env["GEOCOMPLY_RESULT_KEYS_JSON"] = nil
      expect { verify(engine_token) }.to raise_error(described_class::NoEngineKeys)
    end

    context "with a live key set URL" do
      before { env["GEOCOMPLY_RESULT_KEYS_URL"] = keys_url }

      it "verifies with keys fetched from the URL" do
        env["GEOCOMPLY_RESULT_KEYS_JSON"] = nil
        stub_request(:get, keys_url).to_return(status: 200, body: key_set(key_entry(engine_key)))
        expect(verify(engine_token).status).to eq(DeviceLocationAttestation::STATUS_VERIFIED)
      end

      it "falls back to the pinned key set when the URL returns 403" do
        stub_request(:get, keys_url).to_return(status: 403, body: "nope")
        expect(verify(engine_token).status).to eq(DeviceLocationAttestation::STATUS_VERIFIED)
      end

      it "re-fetches once when the result's kid is new (key rotation)" do
        env["GEOCOMPLY_RESULT_KEYS_JSON"] = nil
        rotated = OpenSSL::PKey::EC.generate("prime256v1")
        stub_request(:get, keys_url)
          .to_return({ status: 200, body: key_set(key_entry(engine_key)) },
                     { status: 200, body: key_set(key_entry(engine_key), key_entry(rotated, kid: "engine-2")) })
        expect(verify(engine_token).status).to eq(DeviceLocationAttestation::STATUS_VERIFIED)
        token = engine_token(result_payload(gc_transaction: "gc-tx-2"), key: rotated, kid: "engine-2")
        expect(verify(token).status).to eq(DeviceLocationAttestation::STATUS_VERIFIED)
      end
    end
  end

  describe "checks after the signature" do
    {
      "GeoComply reported a fail" => [{ error_code: 1, error_message: "boundary" }, DeviceLocationAttestation::FAILURE_SPOOFED],
      "a fail with no location" => [{ error_code: 1, location: nil }, DeviceLocationAttestation::FAILURE_SPOOFED],
      "no transaction id" => [{ gc_transaction: nil }, DeviceLocationAttestation::FAILURE_MALFORMED],
      "no country" => [{ location: { source: "ip" } }, DeviceLocationAttestation::FAILURE_MALFORMED],
      "another operator's akey" => [{ akey: "someone-else" }, DeviceLocationAttestation::FAILURE_INVALID_SIGNATURE],
      "issued for another user" => [{ user_id: "999999" }, DeviceLocationAttestation::FAILURE_INVALID_SIGNATURE],
      "issued for another login session" => [{ user_session_id: "sess-2" }, DeviceLocationAttestation::FAILURE_INVALID_SIGNATURE],
      "issued too long ago" => [{ iat: 10.minutes.ago.to_i }, DeviceLocationAttestation::FAILURE_EXPIRED],
      "dated in the future" => [{ iat: 10.minutes.from_now.to_i }, DeviceLocationAttestation::FAILURE_EXPIRED],
      "no time bound at all" => [{ iat: nil, exp: nil }, DeviceLocationAttestation::FAILURE_EXPIRED],
      "no validity left" => [{ geolocate_in: 60, buffer_time: 60 }, DeviceLocationAttestation::FAILURE_EXPIRED],
      "a blocked country" => [{ location: { country_code: "IR" } }, DeviceLocationAttestation::FAILURE_SPOOFED],
    }.each do |label, (overrides, reason)|
      it "fails #{reason} when #{label}" do
        result = verify(engine_token(result_payload(**overrides)))
        expect(result.status).to eq(DeviceLocationAttestation::STATUS_FAILED)
        expect(result.failure_reason).to eq(reason)
      end
    end

    it "accepts expiry alone (no iat)" do
      expect(verify(engine_token(result_payload(iat: nil))).status).to eq(DeviceLocationAttestation::STATUS_VERIFIED)
    end

    it "fails INVALID_SIGNATURE when the request has no login session" do
      expect(verify(engine_token, ctx.merge(session_id: nil)).failure_reason)
        .to eq(DeviceLocationAttestation::FAILURE_INVALID_SIGNATURE)
    end

    it "fails SPOOFED when the transaction id was already used (replay)" do
      create(:device_location_attestation, user: user, device_provider: "geocomply", attestation_ref: "gc-tx-1")
      expect(verify(engine_token).failure_reason).to eq(DeviceLocationAttestation::FAILURE_SPOOFED)
    end
  end

  describe ".authorization_token" do
    def sign(**args)
      ClimateControl.modify(env) { described_class.authorization_token(**args) }
    end

    it "signs an ES256 JWT with the claims GeoComply requires" do
      token = sign(user_id: 42, session_id: "sess-1")
      payload, header = JWT.decode(token, signing_key, true, algorithm: "ES256", aud: "geocomply", verify_aud: true)
      expect(header).to include("alg" => "ES256", "kid" => "sk_test", "typ" => "JWT")
      expect(payload).to include("iss" => "akey-1", "sub" => "akey-1", "aud" => "geocomply")
      expect(payload["ctx"]).to eq("user_id" => "42", "session_id" => "sess-1")
      expect(payload["jti"]).to match(/\A\h{8}-\h{4}-4\h{3}-\h{4}-\h{12}\z/)
      expect(payload["exp"] - payload["iat"]).to eq(1.hour.to_i)
    end

    it "accepts a key stored with escaped newlines" do
      env["GEOCOMPLY_SIGNING_KEY"] = signing_key.to_pem.gsub("\n", "\\n")
      expect { JWT.decode(sign(user_id: 1, session_id: "s"), signing_key, true, algorithm: "ES256") }.not_to raise_error
    end

    it "uses a new jti for every token" do
      jtis = Array.new(2) { JWT.decode(sign(user_id: 1, session_id: "s"), nil, false).first["jti"] }
      expect(jtis.uniq.size).to eq(2)
    end

    it "raises when credentials are missing" do
      env["GEOCOMPLY_AKEY"] = nil
      expect { sign(user_id: 1, session_id: "s") }.to raise_error(ArgumentError)
    end
  end
end
