require 'rails_helper'

# Branch-coverage spec for AmrOntologyController#fetch_ontology.
#
# The existing amr_ontology_controller_spec.rb covers a matched entry that HAS a
# description and the no-match error path. It never reaches the arm where a matched
# CARD entry has a "label" but no "description" -> the controller substitutes a
# "No description available" placeholder.
#
# TEST-ONLY. Mutation-checked.
RSpec.describe AmrOntologyController, type: :controller do
  create_users

  before { sign_in @joe }

  describe "GET #fetch_ontology when the matched entry has no description" do
    before do
      # An entry that keys "label" (so it is treated as a real match) but omits
      # "description". S3 always appends the JSON delimiter comma.
      entry = { "label" => "oqxb", "accession" => "3003923" }
      allow(S3Util).to receive(:s3_select_json).and_return(entry.to_json + ",")
      stub_const("S3_DATABASE_BUCKET", "czid-public-references")
    end

    it "substitutes a 'No description available' placeholder" do
      get :fetch_ontology, params: { geneName: "oqxb" }

      expect(response).to have_http_status(:ok)
      json_response = JSON.parse(response.body)
      expect(json_response["description"]).to eq("No description available for oqxb.")
      # It still copied the other properties over (proving the match arm ran).
      expect(json_response["accession"]).to eq("3003923")
      expect(json_response["error"]).to eq("")
    end
  end
end
