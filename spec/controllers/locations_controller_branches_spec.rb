require 'rails_helper'

# Branch-coverage spec for LocationsController.
#
# Targets branches the existing locations_controller_spec.rb does NOT exercise:
#   * external_search rescue -> 500 when a geosearch action fails
#   * external_search_action's else (unsuccessful request) arm that raises
#   * the `msg += ": #{resp}" if resp` arm inside that else (resp present vs nil)
#
# The happy / no-result / no-geocode paths are already covered by the main spec.
# TEST-ONLY. Mutation-checked.
RSpec.describe LocationsController, type: :controller do
  create_users

  before { sign_in @joe }

  describe "GET external_search failure handling" do
    it "returns 500 with the geosearch error message when a provider request is unsuccessful" do
      # [false, resp] drives external_search_action into its else arm, which raises;
      # the controller rescue turns that into a 500. If the rescue were removed the
      # example would error out instead of asserting a 500 body.
      allow(Location).to receive(:geo_search_request_base).and_return([false, "429 Too Many Requests"])

      get :external_search, params: { query: "UCSF" }

      expect(response).to have_http_status(:internal_server_error)
      body = JSON.parse(response.body)
      expect(body["status"]).to eq("failed")
      expect(body["message"]).to eq(LocationsController::GEOSEARCH_ERR_MSG)
    end

    it "appends the response detail to the logged error when a body is present" do
      allow(Location).to receive(:geo_search_request_base).and_return([false, "429 Too Many Requests"])
      # resp present -> the `msg += ": #{resp}"` arm fires; the composed message carries the body.
      expect(LogUtil).to receive(:log_error)
        .with(a_string_including("429 Too Many Requests"), any_args)

      get :external_search, params: { query: "UCSF" }
      expect(response).to have_http_status(:internal_server_error)
    end

    it "logs the bare rate-limit message (no detail suffix) when the response body is nil" do
      allow(Location).to receive(:geo_search_request_base).and_return([false, nil])
      # resp nil -> the append arm is skipped; the message is EXACTLY the constant
      # (not prefix-matched), so inverting the `if resp` guard would break this.
      expect(LogUtil).to receive(:log_error)
        .with(LocationsController::GEOSEARCH_RATE_LIMIT_ERR, any_args)

      get :external_search, params: { query: "UCSF" }
      expect(response).to have_http_status(:internal_server_error)
    end
  end
end
