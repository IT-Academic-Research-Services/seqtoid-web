require 'rails_helper'

# Branch-coverage companion #2 for app/models/metadatum.rb. metadatum_branches_spec.rb
# already drives the "simple" arms; this file takes the remaining ones:
#   - set_validated_values: the new-record host genome fallback (default fields)
#   - _determine_location_params: the unresolved-blob branch that returns nil
#   - validated_value / csv_compatible_value: the location_id PRESENT arms
#   - by_sample_ids: the use_csv_compatible_values arm
RSpec.describe Metadatum, type: :model do
  let(:errors_module) { ErrorHelper::MetadataValidationErrors }

  describe "#set_validated_values with an unsaved host genome" do
    let!(:default_field) do
      create(:metadata_field, name: "branch_default_field", display_name: "Branch Default Field",
                              base_type: MetadataField::STRING_TYPE, default_for_new_host_genome: 1)
    end

    # A host genome the user is defining inline has no persisted metadata_fields,
    # so the validator falls back to the default_for_new_host_genome set.
    def metadatum_for_new_host_genome(key:, metadata_field:)
      metadatum = Metadatum.new(key: key, raw_value: "some value")
      allow(metadatum).to receive(:sample).and_return(instance_double(Sample, host_genome: HostGenome.new))
      allow(metadatum).to receive(:metadata_field).and_return(metadata_field)
      metadatum
    end

    it "accepts a key that is a default field for new host genomes" do
      metadatum = metadatum_for_new_host_genome(key: "branch_default_field", metadata_field: default_field)

      metadatum.set_validated_values

      expect(metadatum.errors[:invalid_field_for_host_genome]).to be_empty
      expect(metadatum.string_validated_value).to eq("some value")
    end

    it "rejects a key that is not among the default fields for new host genomes" do
      other_field = create(:metadata_field, name: "branch_other_field", base_type: MetadataField::STRING_TYPE)
      metadatum = metadatum_for_new_host_genome(key: "branch_other_field_not_valid", metadata_field: other_field)

      metadatum.set_validated_values

      expect(metadatum.errors[:invalid_field_for_host_genome])
        .to include(errors_module::INVALID_FIELD_FOR_HOST_GENOME)
    end

    it "rejects when the sample cannot be resolved" do
      metadatum = Metadatum.new(key: "branch_default_field", raw_value: "x")
      allow(metadatum).to receive(:sample).and_return(nil)

      metadatum.set_validated_values

      expect(metadatum.errors[:sample_not_found]).to include(errors_module::SAMPLE_NOT_FOUND)
    end
  end

  describe "#_determine_location_params" do
    let(:metadatum) { Metadatum.new }

    it "treats an unparseable value as a plain CSV string" do
      expect(metadatum._determine_location_params("San Francisco, CA")).to eq(
        location_id: nil, string_validated_value: "San Francisco, CA", raw_value: nil
      )
    end

    it "unwraps a name-only blob that has no locationiq_id" do
      expect(metadatum._determine_location_params({ name: "Redwood City" }.to_json)).to eq(
        location_id: nil, string_validated_value: "Redwood City", raw_value: nil
      )
    end

    it "returns nil for a blob with neither a locationiq_id nor a name" do
      expect(metadatum._determine_location_params({ country_name: "USA" }.to_json)).to be_nil
    end

    it "returns nil for a blob whose name is blank" do
      expect(metadatum._determine_location_params({ name: "" }.to_json)).to be_nil
    end
  end

  describe "#validated_value and #csv_compatible_value for a resolved location" do
    let(:location) do
      Location.create!(
        name: "San Francisco, California, USA",
        country_name: "USA",
        state_name: "California",
        osm_id: 111,
        locationiq_id: 222
      )
    end
    let(:location_field) { build(:metadata_field, name: "collection_location_v2", base_type: MetadataField::LOCATION_TYPE) }
    let(:metadatum) do
      Metadatum.new(key: "collection_location_v2", string_validated_value: "fallback text", raw_value: "raw text")
    end

    before do
      allow(metadatum).to receive(:metadata_field).and_return(location_field)
      allow(metadatum).to receive(:location_id).and_return(location.id)
      allow(metadatum).to receive(:location).and_return(location)
    end

    it "expands the location into the default location fields" do
      value = metadatum.validated_value

      expect(value).to be_a(Hash)
      expect(value.keys).to match_array(Location::DEFAULT_LOCATION_FIELDS)
      expect(value[:name]).to eq("San Francisco, California, USA")
      expect(value[:country_name]).to eq("USA")
    end

    it "uses the location name for the CSV-friendly value" do
      expect(metadatum.csv_compatible_value).to eq("San Francisco, California, USA")
    end
  end

  describe ".by_sample_ids" do
    let(:project) { create(:project) }
    let!(:sample) do
      create(:sample, project: project, metadata_fields: { "branch_sample_type" => "Blood" })
    end

    it "returns the CSV-friendly (raw) value when use_csv_compatible_values is set" do
      result = Metadatum.by_sample_ids([sample.id], use_csv_compatible_values: true)

      expect(result[sample.id][:branch_sample_type]).to eq("Blood")
    end

    it "returns the validated value by default" do
      result = Metadatum.by_sample_ids([sample.id])

      expect(result[sample.id][:branch_sample_type]).to eq("Blood")
    end
  end
end
