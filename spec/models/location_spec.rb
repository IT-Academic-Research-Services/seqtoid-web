require 'rails_helper'

RSpec.describe Location, type: :model do
  context "#location_api_request" do
    let(:query) { "search.php?addressdetails=1&normalizecity=1&q=UCSF" }
    let!(:api_geosearch_response) do
      [{
        "place_id" => "89640023",
        "osm_type" => "relation",
        "osm_id" => "34324395",
        "lat" => 37.76,
        # LocationIQ uses 'lon'
        "lon" => -122.45,
        "display_name" => "University of California, San Francisco, Parnassus Avenue, Inner Sunset, San Francisco, San Francisco City and County, California, 94131, USA",
        "address" => {
          "university" => "University of California, San Francisco",
          "city" => "San Francisco",
          "county" => "San Francisco City and County",
          "state" => "California",
          "country" => "USA",
          "country_code" => "us",
        },
      }]
    end

    context "when ENV does not have LOCATION_IQ_API_KEY set" do
      it "raises an error" do
        expect { Location.location_api_request(query) }.to raise_error(RuntimeError, "No location API key")
      end
    end

    context "when LOCATION_IQ_API_KEY is set" do
      before do
        allow(ENV).to receive(:[]).and_return("test_env_var_val")
        allow(ENV).to receive(:[]).with('LOCATION_IQ_API_KEY').and_return("location_iq_api_key")
        # The :location_iq circuit breaker is process-global; reset so a prior test's
        # failures can't leave it open and short-circuit these examples.
        HttpResilience.reset!
      end

      context "when location api request response is success" do
        before do
          resp = double("Net::HTTPSuccess")
          allow(resp).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)
          allow(resp).to receive(:body).and_return(api_geosearch_response.to_json)
          # #467c: location_api_request now goes through HttpResilience.request (bounded
          # timeouts + circuit breaker), which uses Net::HTTP.new(...).start (instance),
          # not the class method Net::HTTP.start — so stub the resilience seam instead.
          allow(HttpResilience).to receive(:request).and_return(resp)
        end

        it "receives a response from the location API" do
          location_resp = Location.location_api_request(query)
          expect(location_resp).to eq([true, api_geosearch_response])
        end
      end

      context "when location api request response is not found" do
        before do
          resp = double("Net::HTTPNotFound")
          allow(resp).to receive(:is_a?).with(Net::HTTPSuccess).and_return(false)
          allow(resp).to receive(:is_a?).with(Net::HTTPNotFound).and_return(true)
          allow(resp).to receive(:body).and_return({}.to_json)
          # #467c: location_api_request now goes through HttpResilience.request (bounded
          # timeouts + circuit breaker), which uses Net::HTTP.new(...).start (instance),
          # not the class method Net::HTTP.start — so stub the resilience seam instead.
          allow(HttpResilience).to receive(:request).and_return(resp)
        end

        it "receives a response from the location API" do
          location_resp = Location.location_api_request(query)
          expect(location_resp).to eq([true, {}])
        end
      end

      # Regression: Net::HTTP requires a stdlib URI. Building the request from an
      # Addressable::URI leaves the request target as an Addressable object, and Net::HTTP
      # then calls String#split on it -> NoMethodError under Ruby 3.3, surfacing as a 500
      # from LocationsController#external_search on every geosearch (web UI + CLI upload).
      # The other examples stub HttpResilience.request and so never exercise the request
      # object itself; this one captures it and asserts the target Net::HTTP will accept.
      context "request construction" do
        it "hands Net::HTTP a plain String request path, not an Addressable::URI" do
          captured_request = nil
          resp = double("Net::HTTPSuccess")
          allow(resp).to receive(:is_a?).with(Net::HTTPSuccess).and_return(true)
          allow(resp).to receive(:is_a?).with(Net::HTTPNotFound).and_return(false)
          allow(resp).to receive(:body).and_return("[]")
          allow(HttpResilience).to receive(:request) do |request, _origin, **_opts|
            captured_request = request
            resp
          end

          Location.location_api_request(query)

          expect(captured_request).to be_a(Net::HTTP::Get)
          expect(captured_request.path).to be_a(String)
          expect(captured_request.path).to include("q=UCSF")
        end
      end
    end
  end

  context "#find_or_new_by_fields" do
    before do
      user = create(:user)
      @project = create(:project, users: [user])
      @location_metadata_field = create(
        :metadata_field, name: 'mock_collection_location', base_type: MetadataField::LOCATION_TYPE
      )
      host_genome = create(:host_genome, name: "mock_host_genome")
      host_genome.metadata_fields << @location_metadata_field
      @sample = create(:sample, project: @project, name: "Mock sample", host_genome: host_genome)
    end

    it "should return existing location if it exists" do
      mock_location = create(:location, country_name: "USA", osm_id: 123, locationiq_id: 89_640_023)

      loc_info = { country_name: "USA" }
      location = Location.find_or_new_by_fields(loc_info)

      expect(location.new_record?).to eq(false)
      expect(location.id).to eq(mock_location.id)
    end

    it "should return newly created location if no osm_id or osm_type" do
      loc_info = { country_name: "USA" }
      location = Location.find_or_new_by_fields(loc_info)

      expect(location.new_record?).to eq(true)
      expect(location.country_name).to eq("USA")
    end

    it "should perform geosearch if osm_id or osm_type provided" do
      loc_info = { country_name: "USA", osm_id: 123, osm_type: "Relation" }

      expect(Location).to receive(:geosearch_by_osm_id).with(123, "Relation").exactly(1).times
                                                       .and_return([true, ["mock_response"]])
      expect(LocationHelper).to receive(:adapt_location_iq_response).with("mock_response").exactly(1).times
                                                                    .and_return(country_name: "Mock Country", osm_id: 123, osm_type: "Relation")

      location = Location.find_or_new_by_fields(loc_info)
      expect(location.new_record?).to eq(true)
      expect(location.country_name).to eq("Mock Country")
    end

    it "should return existing location if it matches geosearch response" do
      # There is an existing location for USA, but not California.
      mock_location = create(:location, country_name: "USA", osm_id: 123, locationiq_id: 89_640_023)
      loc_info = { country_name: "USA", state_name: "California", osm_id: 123, osm_type: "Relation" }

      expect(Location).to receive(:geosearch_by_osm_id).with(123, "Relation").exactly(1).times
                                                       .and_return([true, ["mock_response"]])
      expect(LocationHelper).to receive(:adapt_location_iq_response).with("mock_response").exactly(1).times
                                                                    .and_return(country_name: "USA", osm_id: 123, osm_type: "Relation")

      location = Location.find_or_new_by_fields(loc_info)
      expect(location.new_record?).to eq(false)
      expect(location.id).to eq(mock_location.id)
    end

    it "falls back to client-supplied fields when the OSM re-fetch returns an error (#672)" do
      # LocationIQ reverse-by-osm_id can return {"error": ...}; with an empty locations table
      # every selection hits this path. It must NOT crash / raise -- fall back to loc_info.
      loc_info = { name: "Metropole de Lyon, France", geo_level: "subdivision", country_name: "France", osm_id: 123, osm_type: "Relation" }

      expect(Location).to receive(:geosearch_by_osm_id).with(123, "Relation").exactly(1).times
                                                       .and_return([true, { "error" => "Unable to geocode" }])
      expect(LocationHelper).not_to receive(:adapt_location_iq_response)

      location = Location.find_or_new_by_fields(loc_info)
      expect(location.new_record?).to eq(true)
      expect(location.country_name).to eq("France")
    end
  end

  context "#specificity_valid?" do
    it "should return true for non-human genomes non-specific locations" do
      is_valid = Location.specificity_valid?({
                                               geo_level: "country",
                                               country_name: "USA",
                                             }, "Mosquito")

      expect(is_valid).to eq(true)
    end

    it "should return true for non-human genomes and city-level locations" do
      is_valid = Location.specificity_valid?({
                                               geo_level: "city",
                                               country_name: "USA",
                                               state_name: "California",
                                               city_name: "San Francisco",
                                             }, "Mosquito")

      expect(is_valid).to eq(true)
    end

    it "should return false for human genomes and city-level locations" do
      is_valid = Location.specificity_valid?({
                                               geo_level: "city",
                                               country_name: "USA",
                                               state_name: "California",
                                               city_name: "San Francisco",
                                             }, "Human")

      expect(is_valid).to eq(false)
    end

    it "should return true for human genomes and non-specific locations" do
      is_valid = Location.specificity_valid?({
                                               geo_level: "country",
                                               country_name: "USA",
                                             }, "Human")

      expect(is_valid).to eq(true)
    end
  end

  context "#coarsen_location_for_human" do
    it "drops the city and falls back to subdivision level" do
      coarsened = Location.coarsen_location_for_human({
                                                        name: "Ugena, Toledo, Castile-La Mancha, Spain",
                                                        geo_level: "city",
                                                        country_name: "Spain",
                                                        state_name: "Castile-La Mancha",
                                                        subdivision_name: "Toledo",
                                                        city_name: "Ugena",
                                                      })

      expect(coarsened[:city_name]).to eq("")
      expect(coarsened[:geo_level]).to eq("subdivision")
      expect(coarsened[:name]).to eq("Toledo, Castile-La Mancha, Spain")
      expect(coarsened[:refetch_adjusted_location]).to eq(true)
      # The specificity rule is now satisfied for a Human host.
      expect(Location.specificity_valid?(coarsened, "Human")).to eq(true)
    end

    it "drops a subdivision that merely repeats the city and falls back to state level" do
      coarsened = Location.coarsen_location_for_human({
                                                        name: "San Francisco, San Francisco, California, USA",
                                                        geo_level: "city",
                                                        country_name: "USA",
                                                        state_name: "California",
                                                        subdivision_name: "San Francisco",
                                                        city_name: "San Francisco",
                                                      })

      expect(coarsened[:city_name]).to eq("")
      expect(coarsened[:subdivision_name]).to eq("")
      expect(coarsened[:geo_level]).to eq("state")
      expect(coarsened[:name]).to eq("California, USA")
      expect(coarsened[:refetch_adjusted_location]).to eq(true)
      expect(Location.specificity_valid?(coarsened, "Human")).to eq(true)
    end

    it "falls back to country level when only the country remains" do
      coarsened = Location.coarsen_location_for_human({
                                                        name: "Some City, Country",
                                                        geo_level: "city",
                                                        country_name: "Country",
                                                        city_name: "Some City",
                                                      })

      expect(coarsened[:geo_level]).to eq("country")
      expect(coarsened[:name]).to eq("Country")
      expect(Location.specificity_valid?(coarsened, "Human")).to eq(true)
    end

    it "does not mutate the input location" do
      original = {
        geo_level: "city",
        country_name: "Spain",
        state_name: "Castile-La Mancha",
        subdivision_name: "Toledo",
        city_name: "Ugena",
      }

      Location.coarsen_location_for_human(original)

      expect(original[:city_name]).to eq("Ugena")
      expect(original[:geo_level]).to eq("city")
      expect(original[:refetch_adjusted_location]).to be_nil
    end
  end
end
