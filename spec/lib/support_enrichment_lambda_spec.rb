# frozen_string_literal: true

require "rails_helper"

RSpec.describe SupportEnrichmentLambda do
  let(:args) do
    { correlation_id: "c1", sfn_execution_arn: "arn:exec", run_type: "pipeline_run", run_id: 187 }
  end

  describe ".enabled?" do
    it "is false when the ARN is unset (inert until deployed)" do
      allow(described_class).to receive(:function_arn).and_return(nil)
      expect(described_class.enabled?).to be(false)
    end

    it "is true when the ARN is set" do
      allow(described_class).to receive(:function_arn).and_return("arn:aws:lambda:us-west-2:1:function:fn")
      expect(described_class.enabled?).to be(true)
    end
  end

  describe ".enrich" do
    it "does not invoke and returns nil when disabled" do
      allow(described_class).to receive(:function_arn).and_return(nil)
      expect(described_class).not_to receive(:client)
      expect(described_class.enrich(**args)).to be_nil
    end

    it "invokes the lambda and returns the parsed, redacted payload" do
      allow(described_class).to receive(:function_arn).and_return("arn:fn")
      resp = double("resp", function_error: nil, payload: StringIO.new({ "sfn" => { "cause" => "[REDACTED]" } }.to_json))
      fake = double("lambda_client")
      expect(fake).to receive(:invoke)
        .with(hash_including(function_name: "arn:fn", invocation_type: "RequestResponse"))
        .and_return(resp)
      allow(described_class).to receive(:client).and_return(fake)

      expect(described_class.enrich(**args)).to eq("sfn" => { "cause" => "[REDACTED]" })
    end

    it "raises on a lambda function_error so the job retries / dead-letters" do
      allow(described_class).to receive(:function_arn).and_return("arn:fn")
      resp = double("resp", function_error: "Unhandled", payload: StringIO.new("boom"))
      allow(described_class).to receive(:client).and_return(double("c", invoke: resp))

      expect { described_class.enrich(**args) }.to raise_error(/support-enrichment lambda error/)
    end
  end
end
