# frozen_string_literal: true

require "rails_helper"

# Branch-coverage companion #2 for app/helpers/metadata_helper.rb.
# The wave-1/wave-2 specs drive metadata_template_csv_helper and the CSV
# validation pipeline. This file takes the small helpers whose arms nothing
# else reaches:
#   - get_available_matching_field / get_matching_core_field: name match,
#     display-name match and no match
#   - generate_metadata_default_value: string with and without options, number,
#     date for Human vs non-Human, and the unhandled base type (nil)
#   - order_metadata_fields_for_csv: required-first ordering and the legacy
#     collection_location rejection
#   - get_csv_headers_for_metadata_fields: the collection_location_v2 rename arm
#     and the pass-through arm
#   - metadata_csv_has_duplicate_columns: the duplicate arm and every
#     column-classification arm (sample name synonym, host genome synonym,
#     known field, custom field)
RSpec.describe MetadataHelper, type: :helper do
  let(:project) { create(:project) }
  let(:host_genome) { create(:host_genome, name: "BranchHelperHost") }

  describe "#get_available_matching_field" do
    let!(:field) do
      create(:metadata_field, name: "branch_sample_type", display_name: "Branch Sample Type",
                              base_type: MetadataField::STRING_TYPE)
    end
    let(:sample) { create(:sample, project: project, host_genome: host_genome) }

    before { project.metadata_fields << field }

    it "matches on the field name" do
      expect(helper.get_available_matching_field(sample, "branch_sample_type")).to eq(field)
    end

    it "matches on the display name" do
      expect(helper.get_available_matching_field(sample, "Branch Sample Type")).to eq(field)
    end

    it "returns nil when nothing on the project matches" do
      expect(helper.get_available_matching_field(sample, "not_a_field")).to be_nil
    end
  end

  describe "#get_matching_core_field" do
    let!(:core_field) do
      create(:metadata_field, name: "branch_core_field", display_name: "Branch Core Field",
                              base_type: MetadataField::STRING_TYPE, is_core: 1)
    end
    let!(:non_core_field) do
      create(:metadata_field, name: "branch_non_core_field", display_name: "Branch Non Core Field",
                              base_type: MetadataField::STRING_TYPE, is_core: 0)
    end
    let(:sample) { create(:sample, project: project, host_genome: host_genome) }

    before do
      host_genome.metadata_fields << core_field
      host_genome.metadata_fields << non_core_field
    end

    it "matches a core field by name" do
      expect(helper.get_matching_core_field(sample, "branch_core_field")).to eq(core_field)
    end

    it "matches a core field by display name" do
      expect(helper.get_matching_core_field(sample, "Branch Core Field")).to eq(core_field)
    end

    it "does not match a non-core field on the host genome" do
      expect(helper.get_matching_core_field(sample, "branch_non_core_field")).to be_nil
    end
  end

  describe "#get_new_custom_field" do
    it "builds an unsaved string field named after the column" do
      field = helper.get_new_custom_field("my_custom_column")

      expect(field).to be_a(MetadataField)
      expect(field).not_to be_persisted
      expect(field.name).to eq("my_custom_column")
      expect(field.display_name).to eq("my_custom_column")
      expect(field.base_type).to eq(MetadataField::STRING_TYPE)
    end
  end

  describe "#generate_metadata_default_value" do
    it "picks one of the forced options for a string field with options" do
      field = build(:metadata_field, name: "opt_field", display_name: "Opt Field",
                                     base_type: MetadataField::STRING_TYPE, options: %w[Blood Serum].to_json)

      expect(%w[Blood Serum]).to include(helper.generate_metadata_default_value(field, "Human"))
    end

    it "builds an Example value for a string field with no options" do
      field = build(:metadata_field, name: "free_field", display_name: "Free Field",
                                     base_type: MetadataField::STRING_TYPE, options: nil)

      expect(helper.generate_metadata_default_value(field, "Human")).to eq("Example Free Field")
    end

    it "returns a number for a number field" do
      field = build(:metadata_field, name: "num_field", display_name: "Num Field",
                                     base_type: MetadataField::NUMBER_TYPE)

      expect(helper.generate_metadata_default_value(field, "Human")).to be_a(Integer)
    end

    it "omits the day for a Human date field" do
      field = build(:metadata_field, name: "date_field", display_name: "Date Field",
                                     base_type: MetadataField::DATE_TYPE)

      expect(helper.generate_metadata_default_value(field, "Human")).to eq(Time.zone.today.strftime("%Y-%m"))
    end

    it "includes the day for a non-Human date field" do
      field = build(:metadata_field, name: "date_field", display_name: "Date Field",
                                     base_type: MetadataField::DATE_TYPE)

      expect(helper.generate_metadata_default_value(field, "Mosquito")).to eq(Time.zone.today.strftime("%Y-%m-%d"))
    end

    it "returns nil for a base type with no default generator" do
      field = build(:metadata_field, name: "loc_field", display_name: "Loc Field",
                                     base_type: MetadataField::LOCATION_TYPE)

      expect(helper.generate_metadata_default_value(field, "Human")).to be_nil
    end
  end

  describe ".order_metadata_fields_for_csv" do
    it "puts required fields first and drops the legacy collection_location field" do
      legacy = create(:metadata_field, name: "collection_location", display_name: "Collection Location",
                                       base_type: MetadataField::STRING_TYPE)
      optional = create(:metadata_field, name: "branch_optional", display_name: "Branch Optional",
                                         base_type: MetadataField::STRING_TYPE, is_required: 0)
      required = create(:metadata_field, name: "branch_required", display_name: "Branch Required",
                                         base_type: MetadataField::STRING_TYPE, is_required: 1,
                                         is_default: 1, is_core: 1, default_for_new_host_genome: 1)

      ordered = described_class.order_metadata_fields_for_csv([optional, legacy, required])

      expect(ordered.map(&:name)).to eq(%w[branch_required branch_optional])
    end
  end

  describe ".get_csv_headers_for_metadata_fields" do
    it "renames collection_location_v2 and leaves other names alone" do
      v2 = build(:metadata_field, name: "collection_location_v2", base_type: MetadataField::LOCATION_TYPE)
      other = build(:metadata_field, name: "branch_sample_type", base_type: MetadataField::STRING_TYPE)

      expect(described_class.get_csv_headers_for_metadata_fields([v2, other]))
        .to eq(%w[collection_location branch_sample_type])
    end
  end

  describe ".get_unique_metadata_fields_for_samples" do
    it "returns only the fields that the samples actually have metadata for" do
      field = create(:metadata_field, name: "branch_unique_field", display_name: "Branch Unique Field",
                                      base_type: MetadataField::STRING_TYPE)
      unused = create(:metadata_field, name: "branch_unused_field", display_name: "Branch Unused Field",
                                       base_type: MetadataField::STRING_TYPE)
      sample = create(:sample, project: project, host_genome: host_genome)
      host_genome.metadata_fields << field
      create(:metadatum, sample: sample, key: "branch_unique_field", raw_value: "Blood", metadata_field: field)

      fields = described_class.get_unique_metadata_fields_for_samples(Sample.where(id: sample.id))

      expect(fields).to include(field)
      expect(fields).not_to include(unused)
    end
  end

  describe "#metadata_csv_has_duplicate_columns" do
    let(:aggregator) { ErrorHelper::ErrorAggregator.new }
    let!(:known_field) do
      create(:metadata_field, name: "branch_known", display_name: "Branch Known",
                              base_type: MetadataField::STRING_TYPE)
    end

    it "is false for a header row with no repeats" do
      columns = ["sample_name", "Host Organism", "branch_known", "some_custom_column"]

      expect(helper.metadata_csv_has_duplicate_columns(columns, [known_field], aggregator)).to be(false)
      expect(aggregator.error_groups).to be_empty
    end

    it "flags a sample name column repeated under a synonym" do
      columns = ["sample_name", "Sample Name"]

      expect(helper.metadata_csv_has_duplicate_columns(columns, [known_field], aggregator)).to be(true)
      expect(aggregator.error_groups).not_to be_empty
    end

    it "flags a host organism column repeated under a synonym" do
      columns = ["sample_name", "host_genome", "Host Organism"]

      expect(helper.metadata_csv_has_duplicate_columns(columns, [known_field], aggregator)).to be(true)
    end

    it "flags a known field repeated under its display name" do
      columns = ["sample_name", "branch_known", "Branch Known"]

      expect(helper.metadata_csv_has_duplicate_columns(columns, [known_field], aggregator)).to be(true)
    end

    it "flags a custom column repeated verbatim" do
      columns = ["sample_name", "custom_col", "custom_col"]

      expect(helper.metadata_csv_has_duplicate_columns(columns, [known_field], aggregator)).to be(true)
    end
  end
end
