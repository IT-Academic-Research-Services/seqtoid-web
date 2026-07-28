# frozen_string_literal: true

require "rails_helper"

# Coverage Wave (branch): residual branches for Queries::FedBulkDownloadsQuery.
# fed_bulk_downloads_query_branches_spec.rb drives the resolver end-to-end through
# GraphQL, where a persisted BulkDownload always has an id and every joined entity
# always has one -- so the `&.to_s` nil-receiver arms in map_fed_bulk_download and
# bulk_download_entity_inputs are never taken. This spec exercises the two mapping
# helpers directly on a bare host object that includes the concern.
RSpec.describe Queries::FedBulkDownloadsQuery, type: :request do
  # Minimal host for the concern: the `included do field ... end` hook needs a
  # `field` class method, which the real GraphQL object type provides.
  let(:host_class) do
    Class.new do
      def self.field(*_args, **_kwargs, &_block)
      end

      include Queries::FedBulkDownloadsQuery
    end
  end

  let(:host) { host_class.new }

  describe "#map_fed_bulk_download" do
    it "stringifies the id when one is present (the &. then-arm)" do
      mapped = host.send(:map_fed_bulk_download,
                         "id" => 12,
                         "status" => "success",
                         "download_type" => "reads_non_host",
                         "params" => nil)

      expect(mapped[:id]).to eq("12")
      expect(mapped[:status]).to eq("SUCCEEDED")
      expect(mapped[:downloadType]).to eq("reads_non_host")
      expect(mapped[:params]).to eq([])
    end

    it "leaves the id nil when the record has none (the &. nil arm)" do
      mapped = host.send(:map_fed_bulk_download, "id" => nil, "status" => "error")

      expect(mapped[:id]).to be_nil
      expect(mapped[:status]).to eq("FAILED")
      expect(mapped[:entityInputs]).to eq([])
    end

    it "maps an unrecognised rails status to nil rather than inventing an enum value" do
      mapped = host.send(:map_fed_bulk_download, "id" => 1, "status" => "brand_new_state")

      expect(mapped[:status]).to be_nil
    end
  end

  describe "#bulk_download_entity_inputs" do
    it "concatenates workflow runs and pipeline runs, stringifying present ids (the &. then-arm)" do
      inputs = host.send(:bulk_download_entity_inputs,
                         "workflow_runs" => [{ "id" => 3, "sample_name" => "WR sample" }],
                         "pipeline_runs" => [{ "id" => 7, "sample_name" => "PR sample" }])

      expect(inputs).to eq([
                             { id: "3", name: "WR sample" },
                             { id: "7", name: "PR sample" },
                           ])
    end

    it "keeps a nil entity id as nil (the &. nil arm)" do
      inputs = host.send(:bulk_download_entity_inputs,
                         "workflow_runs" => [{ "id" => nil, "sample_name" => "Nameless" }],
                         "pipeline_runs" => nil)

      expect(inputs).to eq([{ id: nil, name: "Nameless" }])
    end
  end
end
