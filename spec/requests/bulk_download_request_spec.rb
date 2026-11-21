require 'rails_helper'

# Full-stack request specs for BulkDownloadsController.
#
# The bulk-download endpoints are exactly the class that produced the "returns
# 200 but the real behavior isn't asserted" bug. These specs assert the real
# authorization boundary (BulkDownload.viewable => a user only sees their own
# downloads, admins see all) and the token-auth surface used by the async
# worker callbacks (success/error/progress_with_token), including that a bad
# token is rejected. See app/controllers/bulk_downloads_controller.rb and
# app/models/bulk_download.rb#viewable.
RSpec.describe "BulkDownloads request", type: :request do
  create_users

  let(:log_io) { StringIO.new }
  let!(:appender) do
    SemanticLogger.add_appender(
      io: log_io,
      level: :debug,
      formatter: ::Logging::DEFAULT_FORMATTER,
      filter: lambda(&Logging.method(:filter))
    )
  end

  around(:each) do |example|
    SemanticLogger.silence(:debug) do
      example.run
    end
  end

  after do
    SemanticLogger.remove_appender(appender)
  end

  describe "GET /bulk_downloads.json (index)" do
    context "when not signed in" do
      it "returns 401 Not Authenticated for the JSON endpoint (does not leak data)" do
        get "/bulk_downloads.json"
        # Full-stack: the Warden failure_app (config/initializers/auth0.rb) renders
        # {error: 'Unauthorized', code: 401} before the controller runs, so we get
        # a 401 JSON response rather than ApplicationController's {errors: ['Not
        # Authenticated']} (that branch is only hit in controller specs, which skip
        # the middleware). The point of this spec — no data leak on 401 — holds.
        expect(response).to have_http_status(:unauthorized)
        expect(response.media_type).to eq("application/json")
        expect(response.body).to include("Unauthorized")
      end
    end

    context "when signed in as a regular user" do
      before { sign_in @joe }

      it "returns only the current user's own bulk downloads, not other users'" do
        mine = create(:bulk_download, user: @joe, status: BulkDownload::STATUS_WAITING)
        theirs = create(:bulk_download, user: @admin, status: BulkDownload::STATUS_WAITING)

        get "/bulk_downloads.json"

        expect(response).to have_http_status(:ok)
        ids = JSON.parse(response.body).map { |bd| bd["id"] }
        expect(ids).to include(mine.id)
        expect(ids).not_to include(theirs.id)
      end

      it "does not return soft-deleted bulk downloads" do
        active = create(:bulk_download, user: @joe, status: BulkDownload::STATUS_SUCCESS)
        deleted = create(:bulk_download, user: @joe, status: BulkDownload::STATUS_SUCCESS, deleted_at: Time.now.utc)

        get "/bulk_downloads.json"

        expect(response).to have_http_status(:ok)
        ids = JSON.parse(response.body).map { |bd| bd["id"] }
        expect(ids).to include(active.id)
        expect(ids).not_to include(deleted.id)
      end
    end

    context "when signed in as an admin" do
      before { sign_in @admin }

      it "sees other users' bulk downloads (admin scope is unrestricted)" do
        joes = create(:bulk_download, user: @joe, status: BulkDownload::STATUS_WAITING)

        get "/bulk_downloads.json"

        expect(response).to have_http_status(:ok)
        ids = JSON.parse(response.body).map { |bd| bd["id"] }
        expect(ids).to include(joes.id)
      end
    end
  end

  describe "GET /bulk_downloads/:id.json (show)" do
    before { sign_in @joe }

    it "returns the bulk download the user owns" do
      mine = create(:bulk_download, user: @joe, status: BulkDownload::STATUS_SUCCESS)

      get "/bulk_downloads/#{mine.id}.json"

      expect(response).to have_http_status(:ok)
      body = JSON.parse(response.body)
      expect(body["bulk_download"]["id"]).to eq(mine.id)
    end

    it "returns 404 with an error for a bulk download owned by another user" do
      theirs = create(:bulk_download, user: @admin, status: BulkDownload::STATUS_SUCCESS)

      get "/bulk_downloads/#{theirs.id}.json"

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["error"]).to eq(BulkDownloadsHelper::BULK_DOWNLOAD_NOT_FOUND)
    end
  end

  describe "GET /bulk_downloads/:id/presigned_output_url" do
    before { sign_in @joe }

    it "returns 404 when the download has not succeeded yet" do
      waiting = create(:bulk_download, user: @joe, status: BulkDownload::STATUS_WAITING)

      get "/bulk_downloads/#{waiting.id}/presigned_output_url"

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["error"]).to eq(BulkDownloadsHelper::OUTPUT_FILE_NOT_SUCCESSFUL)
    end

    it "returns 404 for another user's download rather than leaking a URL" do
      theirs = create(:bulk_download, user: @admin, status: BulkDownload::STATUS_SUCCESS)

      get "/bulk_downloads/#{theirs.id}/presigned_output_url"

      expect(response).to have_http_status(:not_found)
      expect(JSON.parse(response.body)["error"]).to eq(BulkDownloadsHelper::BULK_DOWNLOAD_NOT_FOUND)
    end
  end

  describe "GET /bulk_downloads/types" do
    it "hides admin-only download types from a regular user" do
      sign_in @joe
      get "/bulk_downloads/types", params: { workflow: WorkflowRun::WORKFLOW[:short_read_mngs] }

      expect(response).to have_http_status(:ok)
      types = JSON.parse(response.body)
      # No returned type may be flagged admin_only for a non-admin.
      expect(types.any? { |t| t["admin_only"] }).to be(false)
      # All returned types must be valid for the requested workflow.
      expect(types).to be_all { |t| t["workflows"].include?(WorkflowRun::WORKFLOW[:short_read_mngs]) }
    end
  end

  # The *_with_token endpoints skip authenticate_user! and are hit by the async
  # bulk-download worker. Access is gated purely by a per-record access token.
  # NOTE: BulkDownload uses `has_secure_token :access_token`, so the token is
  # generated by the DB record on create — we read it off the record (per the
  # "derive expectations from actuals" rule) rather than hardcoding it.
  describe "token-authenticated worker callbacks" do
    let!(:bulk_download) do
      create(:bulk_download, user: @joe, status: BulkDownload::STATUS_RUNNING)
    end
    let(:valid_token) { bulk_download.access_token }

    describe "POST /bulk_downloads/:id/progress/:access_token redacts the access-token" do
      it "updates progress with a valid token (no session required)" do
        SemanticLogger.flush
        log_io.reopen("")
        post "/bulk_downloads/#{bulk_download.id}/progress/#{valid_token}", params: { progress: 0.42 }
        SemanticLogger.flush

        expect(response).to have_http_status(:ok)
        expect(JSON.parse(response.body)["status"]).to eq("success")
        expect(bulk_download.reload.progress).to be_within(0.001).of(0.42)

        actual = log_io.string.split("\n").map { |line| JSON.parse(line, symbolize_names: true) }
        expect(actual.length).to be >= 8
        expect(actual[0]).to include({
                                       level: "debug",
                                       message: "Started",
                                       payload: hash_including(path: "/bulk_downloads/#{bulk_download.id}/progress/[REDACTED]"),
                                       http: hash_including(url: "http://www.example.com/bulk_downloads/#{bulk_download.id}/progress/[REDACTED]"),
                                       request_id: request.request_id,
                                     })
        expect(actual[1]).to include({
                                       name: "BulkDownloadsController",
                                       level: "debug",
                                       message: "Processing #progress_with_token",
                                       http: hash_including(url: "http://www.example.com/bulk_downloads/#{bulk_download.id}/progress/[REDACTED]"),
                                       request_id: request.request_id,
                                     })
        expect(actual[1]).to_not include(:payload)
        actual.slice(2, 5)&.each do |item|
          expect(item).to include({
                                    payload: hash_not_including(:path),
                                    http: hash_including(url: "http://www.example.com/bulk_downloads/#{bulk_download.id}/progress/[REDACTED]"),
                                    request_id: request.request_id,
                                  })
        end
        expect(actual[7]).to include({
                                       name: "BulkDownloadsController",
                                       level: "info",
                                       message: "Completed #progress_with_token",
                                       payload: hash_including(path: "/bulk_downloads/#{bulk_download.id}/progress/[REDACTED]"),
                                       http: hash_including(url: "http://www.example.com/bulk_downloads/#{bulk_download.id}/progress/[REDACTED]"),
                                       request_id: request.request_id,
                                     })
      end

      it "rejects an invalid token with 401 and does not mutate the record" do
        post "/bulk_downloads/#{bulk_download.id}/progress/wrong-token", params: { progress: 0.99 }

        # The controller renders {error: INVALID_ACCESS_TOKEN} with status 401, but
        # Warden::Manager (config/initializers/auth0.rb) intercepts EVERY 401
        # response through the full middleware stack and substitutes its failure_app
        # body ({error: 'Unauthorized', code: 401}). So the controller's specific
        # error body isn't observable at the request layer — only the 401 status is.
        # What matters for this spec still holds: rejected (401) and no mutation.
        expect(response).to have_http_status(:unauthorized)
        expect(response.body).to include("Unauthorized")
        expect(bulk_download.reload.progress).to be_nil
      end

      it "returns 404 for a non-existent bulk download id" do
        post "/bulk_downloads/0/progress/whatever", params: { progress: 0.1 }

        expect(response).to have_http_status(:not_found)
        expect(JSON.parse(response.body)["error"]).to eq(BulkDownloadsHelper::BULK_DOWNLOAD_NOT_FOUND)
      end
    end

    describe "POST /bulk_downloads/:id/error/:access_token" do
      it "marks the download errored and clears the access token" do
        post "/bulk_downloads/#{bulk_download.id}/error/#{valid_token}", params: { error_message: "boom" }

        expect(response).to have_http_status(:ok)
        bulk_download.reload
        expect(bulk_download.status).to eq(BulkDownload::STATUS_ERROR)
        expect(bulk_download.error_message).to eq("boom")
        # Token is single-use: cleared after the callback.
        expect(bulk_download.access_token).to be_nil
      end
    end
  end
end
