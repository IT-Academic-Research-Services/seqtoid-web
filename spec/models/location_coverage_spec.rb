require 'rails_helper'

# Supplementary coverage for Location model (Coverage Wave 4b). Focuses on the
# class-method geosearch surface and parent-resolution logic that location_spec.rb
# does not exercise. External LocationIQ HTTP is stubbed at the
# location_api_request seam.
RSpec.describe Location, type: :model do
  describe ".new_from_params" do
    it "builds an unsaved Location dropping unknown attributes" do
      location = Location.new_from_params(country_name: "USA", bogus_field: "ignored", name: "  Spacey  ")
      expect(location).to be_a(Location)
      expect(location.new_record?).to eq(true)
      expect(location.country_name).to eq("USA")
      expect(location.respond_to?(:bogus_field)).to eq(false)
    end
  end

  describe ".geosearch" do
    it "delegates to the geosearch base with the geosearch base query" do
      expect(Location).to receive(:location_api_request)
        .with(a_string_including(Location::GEOSEARCH_BASE_QUERY))
        .and_return([true, []])
      Location.geosearch("San Francisco")
    end

    it "raises when the query is blank" do
      expect { Location.geosearch("") }.to raise_error(ArgumentError)
    end
  end

  describe ".autocomplete" do
    it "delegates to the geosearch base with the autocomplete base query" do
      expect(Location).to receive(:location_api_request)
        .with(a_string_including(Location::AUTOCOMPLETE_BASE_QUERY))
        .and_return([true, []])
      Location.autocomplete("San")
    end

    it "includes the limit param when provided" do
      expect(Location).to receive(:location_api_request)
        .with(a_string_including("limit=5"))
        .and_return([true, []])
      Location.autocomplete("San", 5)
    end
  end

  describe ".geosearch_by_levels" do
    it "builds an endpoint query from country/state/subdivision" do
      expect(Location).to receive(:location_api_request)
        .with(a_string_including("country=USA").and(including("state=California")).and(including("county=Alameda")))
        .and_return([true, []])
      Location.geosearch_by_levels("USA", "California", "Alameda")
    end

    it "omits absent levels" do
      expect(Location).to receive(:location_api_request) do |query|
        expect(query).to include("country=USA")
        expect(query).not_to include("state=")
        expect(query).not_to include("county=")
        [true, []]
      end
      Location.geosearch_by_levels("USA")
    end
  end

  describe ".geosearch_by_osm_id" do
    it "capitalizes the first letter of the osm type and builds a reverse query" do
      expect(Location).to receive(:location_api_request)
        .with("lookup?osm_ids=R123")
        .and_return([true, []])
      Location.geosearch_by_osm_id(123, "relation")
    end
  end

  describe ".find_with_fields" do
    it "matches on the full set of name fields" do
      existing = create(:location, name: "California, USA", geo_level: "state",
                                   country_name: "USA", state_name: "California", osm_id: 1, locationiq_id: 1)
      found = Location.find_with_fields(
        name: "California, USA", geo_level: "state", country_name: "USA", state_name: "California"
      )
      expect(found).to eq(existing)
    end

    it "returns nil when no match" do
      expect(Location.find_with_fields(name: "Nowhere")).to be_nil
    end
  end

  describe ".specificity_valid?" do
    it "returns false for a human genome with a present city_name" do
      valid = Location.specificity_valid?({ geo_level: "state", city_name: "San Francisco" }, "Human")
      expect(valid).to eq(false)
    end
  end

  describe ".refetch_adjusted_location" do
    it "returns an existing matching subdivision-level location without a service call" do
      existing = create(:location, country_name: "USA", state_name: "California",
                                   subdivision_name: "Alameda", city_name: "", osm_id: 1, locationiq_id: 1)
      expect(Location).not_to receive(:geosearch_by_levels)
      result = Location.refetch_adjusted_location(
        country_name: "USA", state_name: "California", subdivision_name: "Alameda"
      )
      expect(result).to eq(existing)
    end

    it "re-searches the coarser levels when no match exists" do
      expect(Location).to receive(:geosearch_by_levels).and_return([true, [{ "some" => "resp" }]])
      expect(LocationHelper).to receive(:adapt_location_iq_response)
        .and_return(country_name: "USA", state_name: "California", subdivision_name: "Alameda")
      result = Location.refetch_adjusted_location(
        country_name: "USA", state_name: "California", subdivision_name: "Alameda"
      )
      expect(result.country_name).to eq("USA")
    end

    it "raises when the coarser search returns nothing" do
      expect(Location).to receive(:geosearch_by_levels).and_return([false, []])
      expect do
        Location.refetch_adjusted_location(country_name: "USA", state_name: "California", subdivision_name: "Alameda")
      end.to raise_error(/Couldn't find/)
    end
  end

  describe ".present_and_missing_parents" do
    it "reports the state parent as missing when only a city-level location exists" do
      location = build(:location, geo_level: Location::CITY_LEVEL, country_name: "USA",
                                  state_name: "California", city_name: "San Francisco", osm_id: 1, locationiq_id: 1)
      _present_ids, missing = Location.present_and_missing_parents(location)
      expect(missing).to include(Location::COUNTRY_LEVEL, Location::STATE_LEVEL)
    end

    it "reports no missing parents when country and state already exist" do
      create(:location, geo_level: Location::COUNTRY_LEVEL, country_name: "USA", osm_id: 1, locationiq_id: 1)
      create(:location, geo_level: Location::STATE_LEVEL, country_name: "USA", state_name: "California", osm_id: 2, locationiq_id: 2)
      location = build(:location, geo_level: Location::CITY_LEVEL, country_name: "USA",
                                  state_name: "California", city_name: "San Francisco", osm_id: 3, locationiq_id: 3)
      _present_ids, missing = Location.present_and_missing_parents(location)
      expect(missing).to be_empty
    end
  end

  describe ".set_parent_ids" do
    it "assigns parent ids only for levels at or above the location's own level" do
      location = build(:location, geo_level: Location::STATE_LEVEL, osm_id: 1, locationiq_id: 1)
      updated = Location.set_parent_ids(location, Location::COUNTRY_LEVEL => 42, Location::STATE_LEVEL => 43, Location::CITY_LEVEL => 99)
      expect(updated.country_id).to eq(42)
      expect(updated.state_id).to eq(43)
      # City is below state, so it must not be applied.
      expect(updated.city_id).to be_nil
    end
  end
end
