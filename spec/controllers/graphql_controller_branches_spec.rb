require "rails_helper"

# Branch coverage for GraphqlController: the development-only error handler (both arms of the
# `raise e unless Rails.env.development?` guard) and the un-exercised arms of prepare_variables.
RSpec.describe GraphqlController, type: :request do
  create_users

  before do
    sign_in @admin
  end

  describe "error handling in #execute" do
    before do
      allow(IdseqSchema).to receive(:execute).and_raise(StandardError, "schema exploded")
    end

    it "re-raises outside development so the error reaches the normal error handling" do
      expect { post "/graphql", params: { query: "{ __typename }" } }
        .to raise_error(StandardError, "schema exploded")
    end

    it "renders the message and backtrace as JSON in development" do
      allow(Rails.env).to receive(:development?).and_return(true)

      post "/graphql", params: { query: "{ __typename }" }

      expect(response).to have_http_status(:internal_server_error)
      json = JSON.parse(response.body)
      expect(json["errors"].first["message"]).to eq("schema exploded")
      expect(json["errors"].first["backtrace"]).to be_an(Array)
      expect(json["data"]).to eq({})
    end
  end

  describe "#prepare_variables" do
    let(:controller_instance) { described_class.new }

    def prepare(value)
      controller_instance.send(:prepare_variables, value)
    end

    it "parses a JSON string" do
      expect(prepare('{"a":1}')).to eq("a" => 1)
    end

    it "returns an empty hash for a blank string" do
      expect(prepare("")).to eq({})
    end

    it "passes a plain Hash through untouched" do
      variables = { "sampleId" => 5 }
      expect(prepare(variables)).to eq(variables)
    end

    it "unwraps ActionController::Parameters without requiring permit" do
      params = ActionController::Parameters.new(sampleId: 5)
      expect(prepare(params)).to eq("sampleId" => 5)
    end

    it "returns an empty hash for nil" do
      expect(prepare(nil)).to eq({})
    end

    it "raises on an unsupported parameter type" do
      expect { prepare(42) }.to raise_error(ArgumentError, /Unexpected parameter: 42/)
    end
  end
end
