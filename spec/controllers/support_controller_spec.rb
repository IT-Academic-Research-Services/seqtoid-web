require 'rails_helper'

# Regression coverage for the public legal/footer pages served by SupportController.
# These are click-through targets from the footer + user menu ("Terms of Use",
# "Privacy Notice", "Recent Changes") and must render for signed-out visitors.
RSpec.describe SupportController, type: :controller do
  render_views

  describe "GET #terms" do
    it "renders the Terms of Use page (200) for a signed-out visitor" do
      get :terms
      expect(response).to have_http_status(:ok)
      expect(response.body).to include("TermsOfUse")
    end
  end

  describe "GET #privacy" do
    it "renders the Privacy Notice page (200) for a signed-out visitor" do
      get :privacy
      expect(response).to have_http_status(:ok)
      expect(response.body).to include("PrivacyNotice")
    end
  end

  describe "GET #terms_changes" do
    it "renders the Terms Changes page (200) for a signed-out visitor" do
      get :terms_changes
      expect(response).to have_http_status(:ok)
      expect(response.body).to include("TermsChanges")
    end
  end

  # Release notes: the external (production) feed lists changes only for the approved components
  # (alignment engine, pipelines, CLI); every other public component collapses to one summary line,
  # infra components drop out, and internal fields never leave the server.
  describe "GET #releases_data" do
    let(:ledger) do
      [
        { "env" => "env-prod", "version" => "2026.10.02.1", "day" => "2026-10-02", "n" => 1, "component" => "web",
          "source_repo" => "IT-Academic-Research-Services/seqtoid-web", "sha" => "sha-e133a4a8", "reason" => "auto",
          "changes" => [{ "type" => "fixed", "title" => "SMP-1902: block disposable email domains", "pr" => 1, "url" => "u" }], },
        { "env" => "env-prod", "version" => "2026.10.02.2", "day" => "2026-10-02", "n" => 2, "component" => "swipe",
          "sha" => "sha-aaaa1111", "reason" => "r",
          "changes" => [{ "type" => "fixed", "title" => "SMP-1571: retry spot interruptions", "pr" => 7, "url" => "u" }], },
        { "env" => "env-prod", "version" => "2026.10.02.3", "day" => "2026-10-02", "n" => 3, "component" => "workflows",
          "changes" => [{ "type" => "added", "title" => "Add consensus genome QC metric", "pr" => 9 }], },
        { "env" => "env-prod", "version" => "2026.10.02.4", "day" => "2026-10-02", "n" => 4, "component" => "ssot",
          "changes" => [{ "type" => "changed", "title" => "Resize Aurora", "pr" => 3 }], },
        { "env" => "env-prod", "version" => "2026.10.02.5", "day" => "2026-10-02", "n" => 5, "component" => "cli",
          "changes" => [{ "type" => "added", "title" => "SMP-1700: resumable uploads", "pr" => 4 }], },
        { "env" => "env-prod", "version" => "2026.10.02.6", "day" => "2026-10-02", "n" => 6, "component" => "reference",
          "changes" => [], },
      ]
    end
    let(:environment) { "env-prod" }
    let(:public_flag) { nil }

    before do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with("ENVIRONMENT").and_return(environment)
      allow(ENV).to receive(:[]).with("RELEASE_NOTES_PUBLIC").and_return(public_flag)
      allow(ENV).to receive(:[]).with("CHANGELOG_S3_URI").and_return(nil)
      allow(S3Util).to receive(:get_s3_file).and_return(ledger.to_json)
      allow(Rails.cache).to receive(:fetch).and_yield
    end

    def records
      JSON.parse(response.body).index_by { |r| r["component"] }
    end

    context "on env-prod (external feed, signed in)" do
      before { sign_in create(:user) }

      it "reads the env-prod ledger" do
        get :releases_data
        expect(S3Util).to have_received(:get_s3_file)
          .with("s3://seqtoid-env-prod-release-notes/release-notes/env-prod.json")
      end

      it "lists approved components' changes without ticket keys, PR links or internal fields" do
        get :releases_data
        expect(records["swipe"]["changes"]).to eq([{ "type" => "fixed", "title" => "retry spot interruptions" }])
        expect(records["workflows"]["changes"]).to eq([{ "type" => "added", "title" => "Add consensus genome QC metric" }])
        expect(records["cli"]["changes"]).to eq([{ "type" => "added", "title" => "resumable uploads" }])
        expect(records["swipe"].keys).to match_array(%w[env version day n component changes])
      end

      it "reduces every other public component to its summary line and drops infra" do
        get :releases_data
        expect(records["web"]["changes"]).to eq(
          [{ "type" => "changed", "title" => SupportController::RELEASE_NOTE_COMPONENTS["web"]["summary"] }]
        )
        expect(response.body).not_to include("disposable")
        expect(records["reference"]["changes"]).to eq([])
        expect(records).not_to have_key("ssot")
      end
    end

    context "on an internal env, signed out" do
      let(:environment) { "staging" }

      it "requires sign-in" do
        get :releases_data
        expect(response).to redirect_to(root_path)
        expect(S3Util).not_to have_received(:get_s3_file)
      end
    end

    context "on an internal env" do
      let(:environment) { "staging" }

      before { sign_in create(:user) }

      it "serves the full ledger" do
        get :releases_data
        expect(records["web"]["changes"].first["title"]).to eq("SMP-1902: block disposable email domains")
        expect(records).to have_key("ssot")
      end

      it "serves the external view for a public preview" do
        get :releases_data, params: { audience: "public" }
        expect(response.body).not_to include("disposable")
        expect(records).not_to have_key("ssot")
      end
    end
  end
end
