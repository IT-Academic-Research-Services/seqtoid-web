require "rails_helper"

# Request specs for Internal::ChaosController -- the Chaos Engine accuracy-gate integrity probe
# (#810/#815). Token-gated, fail-closed, reuses TaxonomyRollbackSupport.compute_fingerprint. The
# fingerprint is stubbed so these specs are deterministic and DB-content-independent.
# See app/controllers/internal/chaos_controller.rb.
RSpec.describe "Internal::Chaos integrity", type: :request do
  let(:token) { "s3cr3t-chaos-token" }
  let(:fp_ok) { { "table" => "taxon_lineages", "checksum" => "111", "row_count" => 42 } }

  def auth(t = token)
    { "Authorization" => "Bearer #{t}" }
  end

  before do
    # Default: a fresh baseline each example (no leakage), fingerprint returns a stable value.
    AppConfig.where(key: Internal::ChaosController::BASELINE_KEY).delete_all
    allow(TaxonomyRollbackSupport).to receive(:compute_fingerprint).and_return(fp_ok)
  end

  context "when CHAOS_INTEGRITY_TOKEN is unset (fail closed)" do
    it "is DISABLED with 503 -- never ships open" do
      get "/internal/chaos/integrity", headers: auth
      expect(response).to have_http_status(:service_unavailable)
      expect(JSON.parse(response.body)).to include("disabled" => true)
    end
  end

  context "when the token is set" do
    before { stub_const("ENV", ENV.to_hash.merge("CHAOS_INTEGRITY_TOKEN" => token)) }

    it "rejects a missing/wrong bearer token with 401" do
      get "/internal/chaos/integrity", headers: auth("nope")
      expect(response).to have_http_status(:unauthorized)
    end

    it "captures the baseline on the first call and reports integrity_ok" do
      get "/internal/chaos/integrity", headers: auth
      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["integrity_ok"]).to be(true)
      expect(body["captured"]).to be(true)
      expect(AppConfig.find_by(key: Internal::ChaosController::BASELINE_KEY)).to be_present
    end

    it "passes when the current fingerprint still matches the baseline" do
      get "/internal/chaos/integrity", headers: auth # capture
      get "/internal/chaos/integrity", headers: auth # verify
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["integrity_ok"]).to be(true)
    end

    it "FAILS closed (422, integrity_ok false) when a reference table's checksum drifts under the fault" do
      get "/internal/chaos/integrity", headers: auth # capture the good baseline
      # Simulate corruption: the same table now fingerprints differently.
      allow(TaxonomyRollbackSupport).to receive(:compute_fingerprint)
        .and_return(fp_ok.merge("checksum" => "999"))
      get "/internal/chaos/integrity", headers: auth
      expect(response).to have_http_status(:unprocessable_content)
      body = JSON.parse(response.body)
      expect(body["integrity_ok"]).to be(false)
      expect(body["mismatches"].first).to include("table" => "taxon_lineages")
    end

    it "recapture=1 forces a fresh baseline" do
      get "/internal/chaos/integrity", headers: auth # capture
      allow(TaxonomyRollbackSupport).to receive(:compute_fingerprint)
        .and_return(fp_ok.merge("checksum" => "999"))
      get "/internal/chaos/integrity?recapture=1", headers: auth
      expect(response).to have_http_status(:ok)
      expect(JSON.parse(response.body)["captured"]).to be(true)
    end
  end
end
