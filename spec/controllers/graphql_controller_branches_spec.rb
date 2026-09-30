require "rails_helper"

# Branch coverage for GraphqlController: the development-only error handler (both arms of the
# `raise e unless Rails.env.development?` guard), GraphQL response error logging, and prepare_variables.
RSpec.describe GraphqlController, type: :request do
  create_users

  before do
    sign_in @admin
  end

  describe "error handling in #execute" do
    context "when IdseqSchema.execute raises an exception" do
      before do
        allow(IdseqSchema).to receive(:execute).and_raise(StandardError, "schema exploded")
      end

      it "logs the exception to LogUtil and re-raises outside development" do
        expect(LogUtil).to receive(:log_error).with(
          "GraphQL execution error: schema exploded",
          exception: an_instance_of(StandardError),
          query: "{ __typename }",
          variables: {},
          operation_name: nil
        )

        expect { post "/graphql", params: { query: "{ __typename }" } }
          .to raise_error(StandardError, "schema exploded")
      end

      it "logs the exception to LogUtil and renders JSON in development" do
        allow(Rails.env).to receive(:development?).and_return(true)

        expect(LogUtil).to receive(:log_error).with(
          "GraphQL execution error: schema exploded",
          exception: an_instance_of(StandardError),
          query: "{ __typename }",
          variables: {},
          operation_name: nil
        )

        post "/graphql", params: { query: "{ __typename }" }

        expect(response).to have_http_status(:internal_server_error)
        json = JSON.parse(response.body)
        expect(json["errors"].first["message"]).to eq("schema exploded")
        expect(json["errors"].first["backtrace"]).to be_an(Array)
        expect(json["data"]).to eq({})
      end
    end

    context "when IdseqSchema.execute returns response errors" do
      it "logs each GraphQL error to LogUtil" do
        result = { "data" => nil, "errors" => [{ "message" => "Sample not found", "locations" => [{ "line" => 1, "column" => 2 }] }] }
        allow(IdseqSchema).to receive(:execute).and_return(result)

        expect(LogUtil).to receive(:log_error).with(
          "GraphQL error: Sample not found",
          query: "query SampleQuery { sample(id: 123) { id } }",
          variables: { "id" => "123" },
          operation_name: "SampleQuery",
          error: result["errors"].first
        )

        post "/graphql", params: {
          query: "query SampleQuery { sample(id: 123) { id } }",
          variables: { id: "123" },
          operationName: "SampleQuery",
        }

        expect(response).to have_http_status(:ok)
      end

      it "does not log when there are no errors" do
        result = { "data" => { "appConfig" => { "key" => "k" } } }
        allow(IdseqSchema).to receive(:execute).and_return(result)

        expect(LogUtil).not_to receive(:log_error)

        post "/graphql", params: { query: "{ appConfig(id: 1) { key } }" }

        expect(response).to have_http_status(:ok)
      end
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
