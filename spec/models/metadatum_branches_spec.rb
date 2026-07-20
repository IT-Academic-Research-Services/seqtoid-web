require 'rails_helper'

# Coverage Wave (branch): metadatum.rb had no model spec. This drives the
# validated-value setters and accessors that are pure (no sample/host_genome/DB
# dependency), covering both sides of each conditional:
#   - check_and_set_number_type: invalid-regex, valid, over-range (+ / -) branches
#   - check_and_set_string_type: no-field, forced+match, forced+no-match, unforced
#   - validated_value: location-type (id nil) vs non-location vs rescue
#   - csv_compatible_value: location-type (id nil) vs non-location
# metadata_field is stubbed so these run without touching the DB.
RSpec.describe Metadatum, type: :model do
  let(:errors_module) { ErrorHelper::MetadataValidationErrors }

  describe "#check_and_set_number_type" do
    it "records the value when the raw_value is a valid number" do
      m = Metadatum.new(raw_value: "42")
      m.check_and_set_number_type
      expect(m.number_validated_value).to eq(42)
      expect(m.errors[:raw_value]).to be_empty
    end

    it "adds an INVALID_NUMBER error when the raw_value is not numeric" do
      m = Metadatum.new(raw_value: "abc")
      m.check_and_set_number_type
      expect(m.number_validated_value).to be_nil
      expect(m.errors[:raw_value]).to include(errors_module::INVALID_NUMBER)
    end

    it "adds a NUMBER_OUT_OF_RANGE error for a value at or above 10**27" do
      m = Metadatum.new(raw_value: "9999999999999999999999999999")
      m.check_and_set_number_type
      expect(m.number_validated_value).to be_nil
      expect(m.errors[:raw_value]).to include(errors_module::NUMBER_OUT_OF_RANGE)
    end

    it "adds a NUMBER_OUT_OF_RANGE error for a value at or below -10**27" do
      m = Metadatum.new(raw_value: "-9999999999999999999999999999")
      m.check_and_set_number_type
      expect(m.number_validated_value).to be_nil
      expect(m.errors[:raw_value]).to include(errors_module::NUMBER_OUT_OF_RANGE)
    end
  end

  describe "#check_and_set_string_type" do
    it "stores the raw_value verbatim when there is no metadata_field" do
      m = Metadatum.new(raw_value: "freeform text")
      allow(m).to receive(:metadata_field).and_return(nil)
      m.check_and_set_string_type
      expect(m.string_validated_value).to eq("freeform text")
    end

    it "stores the raw_value verbatim when options are not forced" do
      field = double("metadata_field", force_options: 0)
      m = Metadatum.new(raw_value: "freeform text")
      allow(m).to receive(:metadata_field).and_return(field)
      m.check_and_set_string_type
      expect(m.string_validated_value).to eq("freeform text")
    end

    it "canonicalizes a fuzzy match to the forced option" do
      field = double("metadata_field", force_options: 1, options: '["NEB Ultra II FS DNA"]')
      m = Metadatum.new(raw_value: "neb ultra-iifs dna")
      allow(m).to receive(:metadata_field).and_return(field)
      m.check_and_set_string_type
      expect(m.string_validated_value).to eq("NEB Ultra II FS DNA")
      expect(m.errors[:raw_value]).to be_empty
    end

    it "adds an INVALID_OPTION error when a forced value matches nothing" do
      field = double("metadata_field", force_options: 1, options: '["DNA","RNA"]')
      m = Metadatum.new(raw_value: "protein")
      allow(m).to receive(:metadata_field).and_return(field)
      m.check_and_set_string_type
      expect(m.errors[:raw_value]).to include(errors_module::INVALID_OPTION)
    end
  end

  describe "#validated_value" do
    it "returns the typed *_validated_value column for a non-location field" do
      field = double("metadata_field", base_type: MetadataField::STRING_TYPE)
      m = Metadatum.new(string_validated_value: "hello")
      allow(m).to receive(:metadata_field).and_return(field)
      expect(m.validated_value).to eq("hello")
    end

    it "returns string_validated_value for a location field with no location_id" do
      field = double("metadata_field", base_type: MetadataField::LOCATION_TYPE)
      m = Metadatum.new(string_validated_value: "Somewhere", location_id: nil)
      allow(m).to receive(:metadata_field).and_return(field)
      expect(m.validated_value).to eq("Somewhere")
    end

    it "returns an empty string when accessing the field raises" do
      m = Metadatum.new
      allow(m).to receive(:metadata_field).and_return(nil)
      expect(m.validated_value).to eq("")
    end
  end

  describe "#csv_compatible_value" do
    it "returns string_validated_value for a location field with no location_id" do
      field = double("metadata_field", base_type: MetadataField::LOCATION_TYPE)
      m = Metadatum.new(string_validated_value: "Loc", location_id: nil)
      allow(m).to receive(:metadata_field).and_return(field)
      expect(m.csv_compatible_value).to eq("Loc")
    end

    it "returns the raw_value for a non-location field" do
      field = double("metadata_field", base_type: MetadataField::NUMBER_TYPE)
      m = Metadatum.new(raw_value: "3.14")
      allow(m).to receive(:metadata_field).and_return(field)
      expect(m.csv_compatible_value).to eq("3.14")
    end
  end
end
