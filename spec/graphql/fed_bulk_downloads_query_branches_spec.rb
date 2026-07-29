# frozen_string_literal: true

require "rails_helper"

# Coverage Wave: branch sweep for Queries::FedBulkDownloadsQuery. The main spec
# (fed_bulk_downloads_query_spec.rb) only queries as a NON-admin with no input, so
# the whole admin narrowing block and most of the params filter are untaken. This
# spec drives:
#
#   - resolve_fed_bulk_downloads: admin true/false, `input&.search_by` with input
#     nil / input present-but-blank / input present-with-a-term, and `input&.limit`
#     with and without a limit
#   - bulk_download_params: the non-Hash early return, the excluded-key skip, the
#     nil-param skip, the nil-value skip, the empty-array skip, and both arms of
#     the `value.is_a?(String) ? value : value.to_json` ternary
RSpec.describe GraphqlController, type: :request do
  create_users

  FED_BD_BRANCH_QUERY = <<~GQL
    query BulkDownloadListQuery($input: queryInput_fedBulkDownloads_input_Input) {
      fedBulkDownloads(input: $input) {
        id
        ownerUserId
        status
        params {
          paramType
          value
          displayName
        }
      }
    }
  GQL

  def post_query(variables = {})
    post "/graphql",
         headers: { "Content-Type" => "application/json" },
         params: { query: FED_BD_BRANCH_QUERY, variables: variables }.to_json
  end

  def data
    parsed = JSON.parse(response.body)
    expect(parsed["errors"]).to(be_nil, "GraphQL errors: #{parsed['errors']}")
    parsed.dig("data", "fedBulkDownloads")
  end

  before do
    allow_any_instance_of(BulkDownload).to receive(:output_file_presigned_url).and_return(nil)
  end

  context "as an admin" do
    before { sign_in @admin }

    let!(:joe_download) do
      create(:bulk_download, download_type: "sample_overview", status: "success", user: @joe)
    end
    let!(:admin_download) do
      create(:bulk_download, download_type: "sample_overview", status: "running", user: @admin)
    end

    it "returns every viewable download when no input is supplied (both &.-nil arms)" do
      post_query

      expect(data.pluck("id")).to contain_exactly(joe_download.id.to_s, admin_download.id.to_s)
    end

    it "returns every viewable download when the input is supplied but empty (present? false arms)" do
      post_query(input: {})

      expect(data.pluck("id")).to contain_exactly(joe_download.id.to_s, admin_download.id.to_s)
    end

    it "narrows to the matching owner when searchBy is present (the search_by then-arm)" do
      post_query(input: { searchBy: @joe.email })

      expect(data.pluck("id")).to eq([joe_download.id.to_s])
      expect(data.first["ownerUserId"]).to eq(@joe.id)
    end

    it "returns nothing when searchBy matches no user" do
      post_query(input: { searchBy: "nobody-at-all@example.invalid" })

      expect(data).to eq([])
    end

    it "applies the newest-first limit when limit is present (the limit then-arm)" do
      post_query(input: { limit: 1 })

      expect(data.length).to eq(1)
      expect(data.first["id"]).to eq([joe_download.id, admin_download.id].max.to_s)
    end

    it "maps the rails status strings onto the NextGen status enum" do
      post_query

      statuses = data.each_with_object({}) { |bd, acc| acc[bd["id"]] = bd["status"] }
      expect(statuses[joe_download.id.to_s]).to eq("SUCCEEDED")
      expect(statuses[admin_download.id.to_s]).to eq("RUNNING")
    end
  end

  context "as a non-admin" do
    before { sign_in @joe }

    it "ignores admin-only searchBy narrowing entirely (the admin if-arm not taken)" do
      mine = create(:bulk_download, download_type: "sample_overview", status: "error", user: @joe)

      post_query(input: { searchBy: "definitely-not-a-match" })

      expect(data.pluck("id")).to eq([mine.id.to_s])
      expect(data.first["status"]).to eq("FAILED")
    end
  end

  describe "params filtering" do
    before { sign_in @joe }

    it "drops plumbing keys, nil params, nil/empty values and json-encodes non-string values" do
      create(:bulk_download,
             download_type: "sample_overview",
             status: "success",
             user: @joe,
             params: {
               "workflow" => { "displayName" => "Workflow", "value" => "short-read-mngs" },
               "sample_ids" => { "displayName" => "Samples", "value" => [1, 2] },
               "nil_param" => nil,
               "nil_value" => { "displayName" => "Nil Value", "value" => nil },
               "empty_list" => { "displayName" => "Empty List", "value" => [] },
               "taxa_with_reads" => { "displayName" => "Taxa With Reads", "value" => [1, 2] },
               "download_format" => { "displayName" => "Download Format", "value" => "Single File" },
             })

      post_query

      params = data.first["params"]
      expect(params.pluck("paramType")).to contain_exactly("taxaWithReads", "downloadFormat")
      expect(params.find { |p| p["paramType"] == "downloadFormat" }["value"]).to eq("Single File")
      expect(params.find { |p| p["paramType"] == "taxaWithReads" }["value"]).to eq("[1,2]")
    end

    it "returns an empty params list when the download has no params hash (the early return)" do
      create(:bulk_download, download_type: "sample_overview", status: "success", user: @joe, params: nil)

      post_query

      expect(data.first["params"]).to eq([])
    end
  end
end
