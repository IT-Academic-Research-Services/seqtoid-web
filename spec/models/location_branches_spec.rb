require 'rails_helper'

# Coverage Wave 2 (branch): exercises the *opposite* branches of Location's
# class-method conditionals that location_spec.rb / location_coverage_spec.rb
# leave untaken: the location_api_request success/rescue split, the three-way
# find_or_new_by_fields dispatch, specificity_valid? true path, and
# check_and_fetch_parents' missing-parent geosearch loop. External LocationIQ
# HTTP is stubbed at the location_api_request / geosearch_by_levels seams.
RSpec.describe Location, type: :model do
  describe ".location_api_request" do
    around do |example|
      old = ENV["LOCATION_IQ_API_KEY"]
      ENV["LOCATION_IQ_API_KEY"] = "test-key"
      example.run
      ENV["LOCATION_IQ_API_KEY"] = old
    end

    it "raises when no API key is configured" do
      ENV["LOCATION_IQ_API_KEY"] = nil
      expect { Location.location_api_request("search.php?q=x") }.to raise_error(/No location API key/)
    end

    # We let the real circuit breaker run and only stub the HTTP request seam
    # (HttpResilience.request) it wraps, so both the success/NotFound classification
    # and the rescue paths are exercised faithfully.
    it "returns [true, parsed] for an HTTP success" do
      resp = instance_double(Net::HTTPOK, body: '[{"a":1}]')
      allow(resp).to receive(:is_a?) { |klass| klass == Net::HTTPSuccess }
      allow(HttpResilience).to receive(:request).and_return(resp)

      success, body = Location.location_api_request("search.php?q=x")
      expect(success).to eq(true)
      expect(body).to eq([{ "a" => 1 }])
    end

    it "treats an HTTPNotFound (0 results) as a successful request" do
      resp = instance_double(Net::HTTPNotFound, body: '[]')
      allow(resp).to receive(:is_a?) { |klass| klass == Net::HTTPNotFound }
      allow(HttpResilience).to receive(:request).and_return(resp)

      success, body = Location.location_api_request("search.php?q=x")
      expect(success).to eq(true)
      expect(body).to eq([])
    end

    it "degrades gracefully to [false, ...] on an open circuit" do
      allow(HttpResilience).to receive(:request)
        .and_raise(HttpResilience::CircuitOpenError.new("open"))
      expect(LogUtil).to receive(:log_error)
        .with(
          "[Location] LocationIQ request failed",
          exception: HttpResilience::CircuitOpenError,
          endpoint_query: "search.php?q=x"
        )

      expect(Location.location_api_request("search.php?q=x")).to eq([false, { error: "open" }])
    end

    it "degrades gracefully to [false, ...] on a timeout" do
      allow(HttpResilience).to receive(:request).and_raise(Timeout::Error)
      allow(Rails.logger).to receive(:warn)
      expect(LogUtil).to receive(:log_error)
        .with(
          "[Location] LocationIQ request failed",
          exception: Timeout::Error,
          endpoint_query: "search.php?q=x"
        )

      expect(Location.location_api_request("search.php?q=x")).to eq([false, { error: "Timeout::Error" }])
    end

    it "degrades gracefully to [false, ...] on malformed JSON" do
      resp = instance_double(Net::HTTPOK, body: "not json")
      allow(resp).to receive(:is_a?).and_return(true)
      allow(HttpResilience).to receive(:request).and_return(resp)
      expect(LogUtil).to receive(:log_error)
        .with(
          "[Location] LocationIQ request failed",
          exception: JSON::ParserError,
          endpoint_query: "search.php?q=x"
        )

      expect(Location.location_api_request("search.php?q=x")).to eq([false, { error: "unexpected token 'not' at line 1 column 1" }])
    end
  end

  describe ".new_from_params" do
    it "wraps and re-raises when Location.new blows up" do
      allow(Location).to receive(:new).and_raise(StandardError.new("bad col"))
      expect { Location.new_from_params(name: "X") }.to raise_error(/Couldn't make new Location/)
    end
  end

  describe ".geo_search_request_base" do
    it "uses the geosearch base query for the :geosearch action (else branch)" do
      expect(Location).to receive(:location_api_request)
        .with(a_string_including(Location::GEOSEARCH_BASE_QUERY))
        .and_return([true, []])
      Location.geo_search_request_base(:geosearch, "San Francisco")
    end

    it "omits the limit param when limit is absent" do
      expect(Location).to receive(:location_api_request) do |query|
        expect(query).not_to include("limit=")
        [true, []]
      end
      Location.geo_search_request_base(:geosearch, "San Francisco")
    end
  end

  describe ".find_or_new_by_fields" do
    it "returns the existing location when one already matches (first branch)" do
      existing = create(:location, name: "SF", geo_level: "city", city_name: "SF",
                                   osm_id: 1, locationiq_id: 1)
      expect(Location).not_to receive(:geosearch_by_osm_id)
      result = Location.find_or_new_by_fields(name: "SF", geo_level: "city", city_name: "SF")
      expect(result).to eq(existing)
    end

    it "fetches via OSM id/type when no match exists and osm data is present (elsif branch)" do
      allow(Location).to receive(:geosearch_by_osm_id).and_return([true, { "raw" => "x" }])
      allow(LocationHelper).to receive(:adapt_location_iq_response)
        .and_return(name: "New City", geo_level: "city")

      result = Location.find_or_new_by_fields(osm_id: 42, osm_type: "relation", name: "New City")
      expect(result.name).to eq("New City")
    end

    it "falls back to client-supplied fields when the OSM fetch is unsuccessful (#672)" do
      # Resilience: the OSM re-fetch is best-effort. A failed reverse lookup must NOT raise /
      # crash the save -- fall back to the client-supplied (already geocoded) fields.
      allow(Location).to receive(:geosearch_by_osm_id).and_return([false, {}])
      result = Location.find_or_new_by_fields(osm_id: 42, osm_type: "relation", name: "Client City", country_name: "France")
      expect(result).to be_a(Location)
      expect(result.new_record?).to eq(true)
      expect(result.name).to eq("Client City")
    end

    it "falls back to new_from_params when osm data is missing (else branch)" do
      expect(Location).not_to receive(:geosearch_by_osm_id)
      result = Location.find_or_new_by_fields(name: "Plain", osm_id: 0)
      expect(result).to be_a(Location)
      expect(result.new_record?).to eq(true)
    end
  end

  describe ".specificity_valid?" do
    it "returns true for a non-human host genome even at city level" do
      valid = Location.specificity_valid?({ geo_level: "city", city_name: "SF" }, "Mosquito")
      expect(valid).to eq(true)
    end

    it "returns true for a human genome that is not city-specific" do
      valid = Location.specificity_valid?({ geo_level: "state", city_name: "" }, "Human")
      expect(valid).to eq(true)
    end
  end

  describe ".refetch_adjusted_location" do
    it "returns a newly-built location when the coarse search yields a non-matching result" do
      allow(Location).to receive(:geosearch_by_levels).and_return([true, [{ "raw" => "x" }]])
      allow(LocationHelper).to receive(:adapt_location_iq_response)
        .and_return(country_name: "USA", state_name: "Oregon", subdivision_name: "")

      result = Location.refetch_adjusted_location(
        country_name: "USA", state_name: "Oregon", subdivision_name: ""
      )
      expect(result).to be_a(Location)
      expect(result.state_name).to eq("Oregon")
    end
  end

  describe ".check_and_fetch_parents" do
    it "geosearches only for the country parent then sets ids (country branch)" do
      # Existing state parent, so only COUNTRY is missing.
      create(:location, geo_level: Location::STATE_LEVEL, country_name: "USA",
                        state_name: "California", osm_id: 10, locationiq_id: 10)
      city = create(:location, geo_level: Location::CITY_LEVEL, country_name: "USA",
                               state_name: "California", city_name: "SF", osm_id: 11, locationiq_id: 11)

      # geosearch_by_levels called with just the country (single arg) for COUNTRY_LEVEL.
      expect(Location).to receive(:geosearch_by_levels).with("USA").and_return([true, [{ "raw" => "c" }]])
      allow(LocationHelper).to receive(:adapt_location_iq_response)
        .and_return(geo_level: Location::COUNTRY_LEVEL, country_name: "USA", osm_id: 12, locationiq_id: 12)

      result = Location.check_and_fetch_parents(city)
      expect(result.country_id).to be_present
    end

    it "raises when a parent-level geosearch fails" do
      city = create(:location, geo_level: Location::CITY_LEVEL, country_name: "USA",
                               state_name: "California", city_name: "SF", osm_id: 21, locationiq_id: 21)
      allow(Location).to receive(:geosearch_by_levels).and_return([false, []])
      expect { Location.check_and_fetch_parents(city) }.to raise_error(/Geosearch for parent level failed/)
    end
  end
end
