# frozen_string_literal: true

require 'rails_helper'

# Branch-coverage companion #3 for app/models/metadatum.rb.
# Companions #1/#2 cover the string/number validators, the plain-text location
# arms and the location_id-present accessors. This file takes what is left:
#   - check_and_set_date_type: the Human vs non-Human host genome arm and the
#     ArgumentError rescue
#   - check_and_set_location_type: the already-resolved guard (both directions),
#     the refetch-adjusted arm, the specificity failure rescue and the
#     "location has no id yet" parent-fetch arm
#   - by_sample_ids: the date-type + use_raw_date_strings arm
RSpec.describe Metadatum, type: :model do
  let(:errors_module) { ErrorHelper::MetadataValidationErrors }

  describe "#check_and_set_date_type" do
    def date_metadatum(host_genome_name:, raw_value:)
      metadatum = Metadatum.new(key: "collection_date", raw_value: raw_value)
      allow(metadatum).to receive(:sample).and_return(instance_double(Sample, host_genome_name: host_genome_name))
      metadatum
    end

    it "keeps the day for a non-human host genome" do
      metadatum = date_metadatum(host_genome_name: "Mosquito", raw_value: "2021-05-04")

      metadatum.check_and_set_date_type

      expect(metadatum.date_validated_value).to eq(Date.new(2021, 5, 4))
      expect(metadatum.errors[:raw_value]).to be_empty
    end

    it "accepts a month-only date for a human host genome" do
      metadatum = date_metadatum(host_genome_name: "Human", raw_value: "2021-05")

      metadatum.check_and_set_date_type

      # Human dates are stored coarsened to the first of the month.
      expect(metadatum.date_validated_value).to eq(Date.new(2021, 5, 1))
      expect(metadatum.errors[:raw_value]).to be_empty
    end

    it "rejects a day-level date for a human host genome" do
      metadatum = date_metadatum(host_genome_name: "Human", raw_value: "2021-05-04")

      metadatum.check_and_set_date_type

      expect(metadatum.date_validated_value).to be_nil
      expect(metadatum.errors[:raw_value]).to include(errors_module::INVALID_DATE)
    end

    it "records an INVALID_DATE error when the value cannot be parsed" do
      metadatum = date_metadatum(host_genome_name: "Mosquito", raw_value: "not a date")

      metadatum.check_and_set_date_type

      expect(metadatum.errors[:raw_value]).to include(errors_module::INVALID_DATE)
    end
  end

  describe "#check_and_set_location_type" do
    let(:location_field) do
      build(:metadata_field, name: "collection_location_v2", base_type: MetadataField::LOCATION_TYPE)
    end

    def location_metadatum(attrs = {})
      metadatum = Metadatum.new({ key: "collection_location_v2" }.merge(attrs))
      allow(metadatum).to receive(:metadata_field).and_return(location_field)
      allow(metadatum).to receive(:sample).and_return(instance_double(Sample, host_genome_name: "Mosquito"))
      metadatum
    end

    before do
      # Rails.cache memoizes per raw_value; a null store keeps each example independent.
      allow(Rails).to receive(:cache).and_return(ActiveSupport::Cache::NullStore.new)
    end

    it "skips validation entirely when the location was already resolved" do
      metadatum = location_metadatum(string_validated_value: "Already Resolved", raw_value: nil)
      expect(metadatum).not_to receive(:_determine_location_params)

      metadatum.check_and_set_location_type

      expect(metadatum.string_validated_value).to eq("Already Resolved")
    end

    it "re-resolves when a raw_value is present alongside a resolved value" do
      metadatum = location_metadatum(string_validated_value: "Stale", raw_value: "Redwood City, CA")

      metadatum.check_and_set_location_type

      expect(metadatum.string_validated_value).to eq("Redwood City, CA")
      expect(metadatum.raw_value).to be_nil
    end

    it "refetches an adjusted location when the blob asks for it" do
      location = Location.create!(name: "California, USA", country_name: "USA", state_name: "California",
                                  osm_id: 321, locationiq_id: 654)
      blob = { locationiq_id: 654, refetch_adjusted_location: true, name: "California, USA" }.to_json
      metadatum = location_metadatum(raw_value: blob)
      expect(Location).to receive(:refetch_adjusted_location).and_return(location)
      allow(Location).to receive(:specificity_valid?).and_return(true)

      metadatum.check_and_set_location_type

      expect(metadatum.location_id).to eq(location.id)
      expect(metadatum.string_validated_value).to be_nil
    end

    it "fetches the parent lineage and saves a location that is not yet persisted" do
      unsaved = Location.new(name: "New City, California, USA", country_name: "USA", state_name: "California",
                             osm_id: 999, locationiq_id: 888)
      saved = Location.create!(name: "New City, California, USA", country_name: "USA", state_name: "California",
                               osm_id: 999, locationiq_id: 888)
      blob = { locationiq_id: 888, name: "New City, California, USA" }.to_json
      metadatum = location_metadatum(raw_value: blob)
      allow(Location).to receive(:find_or_new_by_fields).and_return(unsaved)
      allow(Location).to receive(:specificity_valid?).and_return(true)
      expect(Location).to receive(:check_and_fetch_parents).with(unsaved).and_return(saved)

      metadatum.check_and_set_location_type

      expect(metadatum.location_id).to eq(saved.id)
    end

    it "records an INVALID_LOCATION error when the location is too specific for the host genome" do
      blob = { locationiq_id: 777, name: "123 Main St, Springfield" }.to_json
      metadatum = location_metadatum(raw_value: blob)
      allow(Location).to receive(:find_or_new_by_fields).and_return(Location.new)
      allow(Location).to receive(:specificity_valid?).and_return(false)
      allow(LogUtil).to receive(:log_error)

      metadatum.check_and_set_location_type

      expect(metadatum.errors[:raw_value]).to include(errors_module::INVALID_LOCATION)
    end
  end

  describe ".by_sample_ids with date metadata" do
    let(:project) { create(:project) }
    let!(:sample) do
      create(:sample, project: project, host_genome_name: "BranchDateHost")
    end
    let!(:date_field) do
      field = create(:metadata_field, name: "branch_collection_date", display_name: "Branch Collection Date",
                                      base_type: MetadataField::DATE_TYPE)
      sample.host_genome.metadata_fields << field
      field
    end

    before do
      create(:metadatum, sample: sample, key: "branch_collection_date", raw_value: "2021-05-04",
                         metadata_field: date_field)
    end

    it "returns the original raw string when raw date strings are requested" do
      result = described_class.by_sample_ids([sample.id], use_raw_date_strings: true)

      expect(result[sample.id][:branch_collection_date]).to eq("2021-05-04")
    end

    it "returns the parsed Date when raw date strings are not requested" do
      result = described_class.by_sample_ids([sample.id])

      expect(result[sample.id][:branch_collection_date]).to eq(Date.new(2021, 5, 4))
    end
  end
end
