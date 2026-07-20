# frozen_string_literal: true

require "rails_helper"

# Branch sweep for the Queries::SampleMetadataQuery concern (CZID-285/307). The existing
# spec is a request spec; these drive the federation post-processing helpers directly so
# the id-coalesce, pipeline-run guard, and location-union case arms are each exercised in
# isolation (no DB, no schema execution).
#
# Branches driven (each fails if its arm is inverted/removed):
#   - apply_federation_transforms: item id present -> to_s vs nil -> untouched; pipeline_run
#     present-with-id -> to_s vs nil/absent -> skip.
#   - resolve_location_validated_value: Hash (id present vs nil) -> object typename;
#     String -> string typename; neither -> nil.
RSpec.describe Queries::SampleMetadataQuery, type: :concern do
  # Host mixing in the concern. The `included do field ... end` needs a no-op `field` DSL.
  let(:host_class) do
    Class.new do
      def self.field(*_args, **_kwargs); end
      include Queries::SampleMetadataQuery
    end
  end

  let(:host) { host_class.new }

  let(:object_typename) { Queries::SampleMetadataQuery::LOCATION_OBJECT_TYPENAME }
  let(:string_typename) { Queries::SampleMetadataQuery::LOCATION_STRING_TYPENAME }

  describe "#resolve_location_validated_value" do
    it "tags a Hash location with the object typename and stringifies a present id" do
      result = host.send(:resolve_location_validated_value, { id: 12, name: "SF" })

      expect(result[:id]).to eq("12")
      expect(result[:__typename]).to eq(object_typename)
      expect(result[:name]).to eq("SF")
    end

    it "keeps a nil Hash id as nil (the id nil arm)" do
      result = host.send(:resolve_location_validated_value, { id: nil, name: "SF" })

      expect(result[:id]).to be_nil
      expect(result[:__typename]).to eq(object_typename)
    end

    it "wraps a String location with the string typename" do
      result = host.send(:resolve_location_validated_value, "San Francisco")

      expect(result).to eq(name: "San Francisco", __typename: string_typename)
    end

    it "returns nil for a value that is neither a Hash nor a String (the unmatched case)" do
      expect(host.send(:resolve_location_validated_value, 42)).to be_nil
      expect(host.send(:resolve_location_validated_value, nil)).to be_nil
    end
  end

  describe "#apply_federation_transforms" do
    it "stringifies present metadata ids and leaves nil ids untouched" do
      response = {
        "metadata" => [
          { "id" => 5, "location_validated_value" => "SF" },
          { "id" => nil, "location_validated_value" => nil },
        ],
        "additional_info" => { "pipeline_run" => nil },
      }

      result = host.send(:apply_federation_transforms, response)

      expect(result[:metadata][0][:id]).to eq("5")
      expect(result[:metadata][0][:location_validated_value][:__typename]).to eq(string_typename)
      expect(result[:metadata][1][:id]).to be_nil
    end

    it "stringifies the pipeline_run id when present" do
      response = {
        "metadata" => [],
        "additional_info" => { "pipeline_run" => { "id" => 99 } },
      }

      result = host.send(:apply_federation_transforms, response)

      expect(result.dig(:additional_info, :pipeline_run, :id)).to eq("99")
    end

    it "leaves the pipeline_run id alone when it is nil (guard false arm)" do
      response = {
        "metadata" => [],
        "additional_info" => { "pipeline_run" => { "id" => nil, "name" => "keep" } },
      }

      result = host.send(:apply_federation_transforms, response)

      expect(result.dig(:additional_info, :pipeline_run, :id)).to be_nil
      expect(result.dig(:additional_info, :pipeline_run, :name)).to eq("keep")
    end
  end
end
