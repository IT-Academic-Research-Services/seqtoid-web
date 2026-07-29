# frozen_string_literal: true

require "rails_helper"

RSpec.describe SupportEnrichmentJob do
  let(:args) { ["c1", "arn:exec", "pipeline_run", 187] }

  it "no-ops when the enrichment lambda is disabled" do
    allow(SupportEnrichmentLambda).to receive(:enabled?).and_return(false)
    expect(SupportEnrichmentLambda).not_to receive(:enrich)
    expect(SupportRouter).not_to receive(:route_enrichment)

    described_class.perform(*args)
  end

  it "routes the redacted detail the lambda returns, correlated by id" do
    allow(SupportEnrichmentLambda).to receive(:enabled?).and_return(true)
    detail = { "sfn" => { "cause" => "[REDACTED]" }, "logs" => { "tail" => ["[REDACTED]"] } }
    expect(SupportEnrichmentLambda).to receive(:enrich)
      .with(correlation_id: "c1", sfn_execution_arn: "arn:exec", run_type: "pipeline_run", run_id: 187)
      .and_return(detail)
    expect(SupportRouter).to receive(:route_enrichment).with(correlation_id: "c1", detail: detail)

    described_class.perform(*args)
  end

  it "does not route when the lambda returns nothing" do
    allow(SupportEnrichmentLambda).to receive(:enabled?).and_return(true)
    allow(SupportEnrichmentLambda).to receive(:enrich).and_return(nil)
    expect(SupportRouter).not_to receive(:route_enrichment)

    described_class.perform(*args)
  end
end
