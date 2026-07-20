# frozen_string_literal: true

require "rails_helper"

# Branch sweep for the Queries::FedBulkDownloadsQuery concern (CZID-285/303c). The existing
# spec is a request spec; these drive the private mapping helpers directly through plain
# hashes (no DB, no schema execution) so every filter/coalesce arm is exercised in isolation.
#
# Branches driven (each fails if its arm is inverted/removed):
#   - map_fed_bulk_download: id&.to_s coalesce; NEXTGEN_STATUSES enum mapping (known vs unknown->nil).
#   - bulk_download_entity_inputs: Array() wrapping of nil vs list; entity id&.to_s coalesce.
#   - bulk_download_params: non-Hash -> []; each filter_map `next` guard (excluded key, nil param,
#     nil value, empty-array value) vs kept; value String passthrough vs to_json.
#   - snake_to_camel: underscore-boundary upcasing.
RSpec.describe Queries::FedBulkDownloadsQuery, type: :concern do
  # Host mixing in the concern. The `included do field ... end` needs a no-op `field` DSL.
  let(:host_class) do
    Class.new do
      def self.field(*_args, **_kwargs); end
      include Queries::FedBulkDownloadsQuery
    end
  end

  let(:host) { host_class.new }

  describe "#map_fed_bulk_download" do
    it "maps a known Rails status to its NextGen enum and stringifies the id" do
      result = host.send(:map_fed_bulk_download, { "id" => 7, "status" => "success" })

      expect(result[:id]).to eq("7")
      expect(result[:status]).to eq("SUCCEEDED")
    end

    it "yields nil status for an unmapped Rails status and nil id when id is absent" do
      result = host.send(:map_fed_bulk_download, { "status" => "bogus" })

      expect(result[:status]).to be_nil
      expect(result[:id]).to be_nil
    end
  end

  describe "#bulk_download_entity_inputs" do
    it "concatenates workflow_runs and pipeline_runs, stringifying each id" do
      bd = {
        "workflow_runs" => [{ "id" => 1, "sample_name" => "a" }],
        "pipeline_runs" => [{ "id" => 2, "sample_name" => "b" }],
      }
      result = host.send(:bulk_download_entity_inputs, bd)

      expect(result).to eq([{ id: "1", name: "a" }, { id: "2", name: "b" }])
    end

    it "treats missing run lists as empty via Array() (nil -> [])" do
      expect(host.send(:bulk_download_entity_inputs, {})).to eq([])
    end
  end

  describe "#bulk_download_params" do
    it "returns [] when params is not a Hash" do
      expect(host.send(:bulk_download_params, nil)).to eq([])
      expect(host.send(:bulk_download_params, "x")).to eq([])
    end

    it "skips excluded plumbing keys (workflow / sample_ids)" do
      params = { "workflow" => { "value" => "cg" }, "sample_ids" => { "value" => [1] } }
      expect(host.send(:bulk_download_params, params)).to eq([])
    end

    it "skips a nil param and a param whose value is nil" do
      params = { "a" => nil, "b" => { "value" => nil } }
      expect(host.send(:bulk_download_params, params)).to eq([])
    end

    it "skips a value that is an empty array but keeps a non-empty one" do
      params = {
        "empty" => { "value" => [] },
        "filled" => { "value" => %w[x y], "displayName" => "Filled" },
      }
      result = host.send(:bulk_download_params, params)

      expect(result.map { |p| p[:paramType] }).to eq(["filled"])
      # A non-String value is JSON-encoded; the displayName is passed through.
      expect(result.first[:value]).to eq('["x","y"]')
      expect(result.first[:displayName]).to eq("Filled")
    end

    it "passes a String value through unchanged (not JSON-encoded)" do
      params = { "download_format" => { "value" => "fasta" } }
      result = host.send(:bulk_download_params, params)

      expect(result.first[:value]).to eq("fasta")
      # snake_to_camel is applied to the key.
      expect(result.first[:paramType]).to eq("downloadFormat")
    end
  end

  describe "#snake_to_camel" do
    it "upper-cases the char after each underscore and drops the underscore" do
      expect(host.send(:snake_to_camel, "download_format_v2")).to eq("downloadFormatV2")
    end

    it "leaves a token with no underscores unchanged" do
      expect(host.send(:snake_to_camel, "workflow")).to eq("workflow")
    end
  end
end
