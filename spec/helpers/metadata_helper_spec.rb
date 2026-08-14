require "rails_helper"

RSpec.describe MetadataHelper, type: :helper do
  describe "#get_new_custom_field" do
    it "builds an unsaved string MetadataField named after the input" do
      field = helper.get_new_custom_field("my_custom")
      expect(field).to be_a(MetadataField)
      expect(field).not_to be_persisted
      expect(field.name).to eq("my_custom")
      expect(field.display_name).to eq("my_custom")
      expect(field.base_type).to eq(MetadataField::STRING_TYPE)
    end
  end

  describe "#generate_metadata_default_value" do
    it "picks from options for a string field with options" do
      field = MetadataField.new(base_type: MetadataField::STRING_TYPE, display_name: "Sample Type", options: %w[Serum Stool].to_json)
      expect(%w[Serum Stool]).to include(helper.generate_metadata_default_value(field, "Human"))
    end

    it "returns an Example string for a string field without options" do
      field = MetadataField.new(base_type: MetadataField::STRING_TYPE, display_name: "Notes")
      expect(helper.generate_metadata_default_value(field, "Human")).to eq("Example Notes")
    end

    it "returns a number under 100 for a number field" do
      field = MetadataField.new(base_type: MetadataField::NUMBER_TYPE, display_name: "Host Age")
      value = helper.generate_metadata_default_value(field, "Human")
      expect(value).to be_a(Integer)
      expect(value).to be_between(0, 99)
    end

    it "returns a YYYY-MM date for Human host on a date field" do
      field = MetadataField.new(base_type: MetadataField::DATE_TYPE, display_name: "Collection Date")
      expect(helper.generate_metadata_default_value(field, "Human")).to match(/\A\d{4}-\d{2}\z/)
    end

    it "returns a YYYY-MM-DD date for non-Human host on a date field" do
      field = MetadataField.new(base_type: MetadataField::DATE_TYPE, display_name: "Collection Date")
      expect(helper.generate_metadata_default_value(field, "Mosquito")).to match(/\A\d{4}-\d{2}-\d{2}\z/)
    end

    it "returns nil for an unhandled base_type" do
      field = MetadataField.new(base_type: MetadataField::LOCATION_TYPE, display_name: "Collection Location")
      expect(helper.generate_metadata_default_value(field, "Human")).to be_nil
    end
  end

  describe ".order_metadata_fields_for_csv" do
    it "sorts required fields first and drops legacy collection_location" do
      optional = MetadataField.new(id: 1, name: "sample_type", is_required: 0)
      required = MetadataField.new(id: 2, name: "collection_date", is_required: 1)
      legacy = MetadataField.new(id: 3, name: "collection_location", is_required: 0)

      ordered = MetadataHelper.order_metadata_fields_for_csv([optional, required, legacy])
      expect(ordered.map(&:name)).to eq(%w[collection_date sample_type])
    end
  end

  describe ".get_csv_headers_for_metadata_fields" do
    it "renames collection_location_v2 to collection_location and passes others through" do
      fields = [
        MetadataField.new(name: "collection_location_v2"),
        MetadataField.new(name: "sample_type"),
      ]
      expect(MetadataHelper.get_csv_headers_for_metadata_fields(fields))
        .to eq(%w[collection_location sample_type])
    end
  end

  describe "#get_available_matching_field" do
    let(:project) { create(:project, metadata_fields_count: 0) }
    let(:sample) { create(:sample, project: project) }
    let!(:field) { create(:metadata_field, name: "custom_thing", display_name: "Custom Thing") }

    before { project.metadata_fields << field }

    it "matches by name" do
      expect(helper.get_available_matching_field(sample, "custom_thing")).to eq(field)
    end

    it "matches by display_name" do
      expect(helper.get_available_matching_field(sample, "Custom Thing")).to eq(field)
    end

    it "returns nil when no field matches" do
      expect(helper.get_available_matching_field(sample, "nonexistent")).to be_nil
    end

    it "matches collection_location_v2 via the exported 'collection_location' header (round-trip alias)" do
      location_field = create(:metadata_field, name: "collection_location_v2", display_name: "Collection Location")
      project.metadata_fields << location_field
      # get_csv_headers_for_metadata_fields exports this field's header as "collection_location";
      # re-uploading that header must still resolve to the required collection_location_v2 field.
      expect(helper.get_available_matching_field(sample, "collection_location")).to eq(location_field)
    end
  end

  describe "#get_matching_core_field" do
    let(:sample) { create(:sample) }
    let!(:core_field) { create(:metadata_field, name: "core_field", display_name: "Core Field", is_core: 1) }

    before { sample.host_genome.metadata_fields << core_field }

    it "matches a core field by name" do
      expect(helper.get_matching_core_field(sample, "core_field")).to eq(core_field)
    end

    it "matches a core field by display name" do
      expect(helper.get_matching_core_field(sample, "Core Field")).to eq(core_field)
    end

    it "returns nil for a non-core field on the host genome" do
      non_core = create(:metadata_field, name: "not_core", is_core: 0)
      sample.host_genome.metadata_fields << non_core
      expect(helper.get_matching_core_field(sample, "not_core")).to be_nil
    end
  end

  describe ".get_unique_metadata_fields_for_samples" do
    it "returns only the metadata fields the samples actually have metadata for" do
      sample = create(:sample, metadata_fields: { "sample_type" => "Serum" })
      other_field = create(:metadata_field, name: "unused_field")
      sample.project.metadata_fields << other_field

      result = MetadataHelper.get_unique_metadata_fields_for_samples(Sample.where(id: sample.id))
      names = result.pluck(:name)
      expect(names).to include("sample_type")
      expect(names).not_to include("unused_field")
    end
  end

  describe "#metadata_csv_has_duplicate_columns" do
    let(:error_aggregator) { ErrorHelper::ErrorAggregator.new }

    it "returns false when there are no duplicates" do
      result = helper.metadata_csv_has_duplicate_columns(
        ["Sample Name", "sample_type", "collection_date"], [], error_aggregator
      )
      expect(result).to be(false)
      expect(error_aggregator.error_groups).to be_empty
    end

    it "detects a duplicate custom column and records an error" do
      result = helper.metadata_csv_has_duplicate_columns(
        ["custom_col", "custom_col"], [], error_aggregator
      )
      expect(result).to be(true)
      groups = error_aggregator.error_groups
      expect(groups.length).to eq(1)
      expect(groups.first[:caption]).to include("duplicate columns were found")
    end

    it "treats sample name synonyms as the same column" do
      result = helper.metadata_csv_has_duplicate_columns(
        ["sample_name", "Sample Name"], [], error_aggregator
      )
      expect(result).to be(true)
    end

    it "treats an existing field's name and display_name as the same column" do
      existing = MetadataField.new(name: "sample_type", display_name: "Sample Type")
      result = helper.metadata_csv_has_duplicate_columns(
        ["sample_type", "Sample Type"], [existing], error_aggregator
      )
      expect(result).to be(true)
    end
  end
end
