require "rails_helper"

# Second branch sweep for ElasticsearchQueryHelper, companion to
# elasticsearch_query_helper_spec.rb and elasticsearch_query_helper_branches_spec.rb.
#
# The OpenSearch client constant is not defined in the test environment (the module
# skips it with `unless Rails.env.test?`), so every example that reaches a query
# installs a double via stub_const, exactly as the main spec does.
#
# Arms covered here:
#   * update_es_for_missing_data: missing ids present vs. none.
#   * update_last_read_at: bulk reports errors / reports none / raises.
#   * lcrp_viral_pathogens_for_pipeline_runs: the `unless background_id.nil?`
#     zscore filter, both ways.
#   * top_n_taxa_per_sample: the highest -> DESC / lowest -> ASC sort ternary.
#   * find_complete_pipeline_runs: the >10_000 split-and-recurse arm.
#   * invoke_lambda: local-HTTP mode (success and failure) vs. the AWS client arm.
#   * call_lambda: the non-200 raise, the successful pass-through, and the
#     bounded retry (retry once, then give up).
#   * call_taxon_indexing_lambda: the nil-response / nil-payload safe-navigation
#     arms feeding the empty-response raise.
#   * build_taxon_tags_filter_clause: the known_pathogens arm.
#   * samples_taxons_details: alignment_config present vs. missing, and the
#     "sample had no matching taxons" fill-in arm.
#
# NOT covered (deliberately, per the no-app-changes rule):
#   * LAMBDA_ENV's `||` fallback and the `ES_CLIENT = ... unless Rails.env.test?`
#     guard are evaluated once at module load, under RAILS_ENV=test. Neither arm
#     can be re-driven from a spec without reloading the module.
RSpec.describe ElasticsearchQueryHelper, type: :helper do
  let(:es_client) { double("es_client") }
  let(:empty_page) { { "hits" => { "hits" => [] } } }

  describe ".update_es_for_missing_data" do
    it "invokes the taxon-indexing lambda for the pipeline runs missing from ES" do
      allow(described_class).to receive(:find_pipeline_runs_missing_from_es).and_return([7, 8])
      expect(described_class).to receive(:call_taxon_indexing_lambda).with(3, [7, 8])

      described_class.update_es_for_missing_data(3, [7, 8, 9])
    end

    it "does not invoke the lambda when nothing is missing" do
      allow(described_class).to receive(:find_pipeline_runs_missing_from_es).and_return([])
      expect(described_class).not_to receive(:call_taxon_indexing_lambda)

      described_class.update_es_for_missing_data(3, [7, 8, 9])
    end

    context "when async: true (heatmap first-load path, SMP-1788)" do
      it "enqueues an IndexTaxons job per missing run instead of blocking on the synchronous lambda" do
        allow(described_class).to receive(:find_pipeline_runs_missing_from_es).and_return([7, 8])
        # the request path must NOT make the blocking RequestResponse invoke itself
        expect(described_class).not_to receive(:call_taxon_indexing_lambda)
        expect(Resque).to receive(:enqueue).with(IndexTaxons, 3, 7).ordered
        expect(Resque).to receive(:enqueue).with(IndexTaxons, 3, 8).ordered

        expect(described_class.update_es_for_missing_data(3, [7, 8, 9], async: true)).to eq([7, 8])
      end

      it "enqueues nothing when no runs are missing" do
        allow(described_class).to receive(:find_pipeline_runs_missing_from_es).and_return([])
        expect(described_class).not_to receive(:call_taxon_indexing_lambda)
        expect(Resque).not_to receive(:enqueue)

        expect(described_class.update_es_for_missing_data(3, [7, 8, 9], async: true)).to eq([])
      end
    end
  end

  describe ".update_last_read_at" do
    before { stub_const("ElasticsearchQueryHelper::ES_CLIENT", es_client) }

    it "sends one bulk update doc per pipeline run and logs nothing on success" do
      captured = nil
      allow(es_client).to receive(:bulk) do |args|
        captured = args[:body]
        { "errors" => false }
      end
      expect(LogUtil).not_to receive(:log_message)

      described_class.update_last_read_at(5, [11, 12])

      expect(captured.length).to eq(2)
      expect(captured.first[:update][:_id]).to eq("11_5")
      expect(captured.first[:update][:_index]).to eq("pipeline_runs")
      expect(captured.first[:update][:data][:doc][:last_read_at]).to be_present
    end

    it "logs a message when the bulk response reports partial errors" do
      allow(es_client).to receive(:bulk).and_return("errors" => true, "items" => [{ "update" => { "status" => 404 } }])
      expect(LogUtil).to receive(:log_message).with(/last_read_at failed/, hash_including(:details))

      described_class.update_last_read_at(5, [11])
    end

    it "swallows and logs a raise from the bulk call" do
      allow(es_client).to receive(:bulk).and_raise(StandardError, "opensearch down")
      expect(LogUtil).to receive(:log_error).with(/Failed to submit bulk update/, hash_including(:exception))

      expect { described_class.update_last_read_at(5, [11]) }.not_to raise_error
    end
  end

  describe ".lcrp_viral_pathogens_for_pipeline_runs background_id arm" do
    before { stub_const("ElasticsearchQueryHelper::ES_CLIENT", es_client) }

    def zscore_filters(body)
      body[:query][:bool][:filter].flat_map do |clause|
        nested = clause.dig(:nested, :query, :bool, :filter)
        nested || []
      end.select { |f| f.is_a?(Hash) && f.key?("range") && f["range"].key?("metric_list.zscore") }
    end

    it "adds a zscore range filter when a background id is supplied" do
      captured = nil
      allow(es_client).to receive(:search) do |args|
        captured = args[:body]
        empty_page
      end

      described_class.lcrp_viral_pathogens_for_pipeline_runs([1], 42, [101])

      expect(captured.to_json).to include("metric_list.zscore")
    end

    it "omits the zscore range filter when the background id is nil" do
      captured = nil
      allow(es_client).to receive(:search) do |args|
        captured = args[:body]
        empty_page
      end

      described_class.lcrp_viral_pathogens_for_pipeline_runs([1], nil, [101])

      expect(captured.to_json).not_to include("metric_list.zscore")
    end
  end

  describe ".top_n_taxa_per_sample sort direction" do
    before { stub_const("ElasticsearchQueryHelper::ES_CLIENT", es_client) }

    def sort_order_for(sort_by)
      captured = nil
      allow(es_client).to receive(:search) do |args|
        captured = args[:body]
        { "aggregations" => { "pipeline_runs" => { "buckets" => [] } } }
      end
      allow(described_class).to receive(:parse_top_n_taxa_per_sample_response).and_return([])

      described_class.top_n_taxa_per_sample(
        {
          sort_by: sort_by,
          background_id: 26,
          taxon_level: 1,
          taxons_per_sample: 5,
          threshold_filters: nil,
          categories: [],
          include_phage: false,
          read_specificity: 0,
          taxon_tags: [],
        },
        [1, 2]
      )
      captured[:aggs][:pipeline_runs][:aggs][:top_taxa][:top_hits][:sort].first.values.first[:order]
    end

    it "sorts DESC for a 'highest' sort_by" do
      expect(sort_order_for("highest_nt_rpm")).to eq("DESC")
    end

    it "sorts ASC for a 'lowest' sort_by" do
      expect(sort_order_for("lowest_nt_rpm")).to eq("ASC")
    end
  end

  describe ".find_complete_pipeline_runs batching arm" do
    before { stub_const("ElasticsearchQueryHelper::ES_CLIENT", es_client) }

    it "splits a >10_000 id list in half and concatenates both halves' results" do
      ids = (1..10_001).to_a
      # Each half comes back with a single (different) complete run so we can see
      # that BOTH halves were queried and their results concatenated.
      responses = [
        { "hits" => { "hits" => [{ "_source" => { "pipeline_run_id" => 1 } }] } },
        { "hits" => { "hits" => [{ "_source" => { "pipeline_run_id" => 9_999 } }] } },
      ]
      expect(es_client).to(receive(:search).twice { responses.shift })

      expect(described_class.find_complete_pipeline_runs(1, ids)).to eq([1, 9_999])
    end

    it "issues a single query when the id list fits in one page" do
      expect(es_client).to receive(:search).once.and_return(
        { "hits" => { "hits" => [{ "_source" => { "pipeline_run_id" => 3 } }] } }
      )

      expect(described_class.find_complete_pipeline_runs(1, [3, 4])).to eq([3])
    end
  end

  describe ".invoke_lambda" do
    it "posts to the local lambda host when INDEXING_LAMBDA_MODE is 'local'" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with('INDEXING_LAMBDA_MODE').and_return('local')
      allow(ENV).to receive(:[]).with('LOCAL_TAXON_INDEXING_URL').and_return('localhost:9000')
      http_response = double("http_response", code: 200, body: '{"ok":true}')
      expect(HTTP).to receive(:post).with(%r{http://localhost:9000/}, json: { a: 1 }).and_return(http_response)

      resp = described_class.invoke_lambda("taxon-indexing-concurrency-manager-#{ElasticsearchQueryHelper::LAMBDA_ENV}", { a: 1 })

      expect(resp["status_code"]).to eq(200)
      expect(resp.payload.string).to eq('{"ok":true}')
    end

    it "wraps a local HTTP failure in a Lambda invocation failure" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with('INDEXING_LAMBDA_MODE').and_return('local')
      allow(ENV).to receive(:[]).with('LOCAL_TAXON_INDEXING_URL').and_return('localhost:9000')
      allow(HTTP).to receive(:post).and_raise(StandardError, "connection refused")

      expect do
        described_class.invoke_lambda("taxon-indexing-concurrency-manager-#{ElasticsearchQueryHelper::LAMBDA_ENV}", {})
      end.to raise_error(/Lambda invocation failure: connection refused/)
    end

    it "calls the AWS Lambda client when not in local mode" do
      allow(ENV).to receive(:[]).and_call_original
      allow(ENV).to receive(:[]).with('INDEXING_LAMBDA_MODE').and_return(nil)
      lambda_client = double("lambda_client")
      stub_const("ElasticsearchQueryHelper::LAMBDA_CLIENT", lambda_client)
      expect(lambda_client).to receive(:invoke).with(
        hash_including(function_name: "fn", invocation_type: 'RequestResponse', payload: '{"a":1}')
      ).and_return("ok")

      expect(described_class.invoke_lambda("fn", { a: 1 })).to eq("ok")
    end
  end

  describe ".call_lambda" do
    it "returns the response untouched on a 200 with no function error" do
      resp = { "status_code" => 200, "function_error" => nil }
      allow(described_class).to receive(:invoke_lambda).and_return(resp)

      expect(described_class.call_lambda("fn", {})).to eq(resp)
    end

    it "retries once and then re-raises when the lambda keeps failing" do
      resp = double("resp", payload: double(string: "boom"))
      allow(resp).to receive(:[]).with("status_code").and_return(500)
      allow(resp).to receive(:[]).with("function_error").and_return(nil)
      allow(described_class).to receive(:invoke_lambda).and_return(resp)
      allow(described_class).to receive(:sleep) # keep the bounded retry instant
      allow(LogUtil).to receive(:log_error)

      expect { described_class.call_lambda("fn", {}) }.to raise_error(/invocation failed with status_code: 500/)
      # attempts starts at 1, retries once (attempts 2), gives up at 3.
      expect(described_class).to have_received(:invoke_lambda).twice
      expect(described_class).to have_received(:sleep).once
    end

    it "raises when the lambda reports a function_error even on a 200" do
      resp = double("resp", payload: double(string: "handler blew up"))
      allow(resp).to receive(:[]).with("status_code").and_return(200)
      allow(resp).to receive(:[]).with("function_error").and_return("Unhandled")
      allow(described_class).to receive(:invoke_lambda).and_return(resp)
      allow(described_class).to receive(:sleep)
      allow(LogUtil).to receive(:log_error)

      expect { described_class.call_lambda("fn", {}) }.to raise_error(/function_error: handler blew up/)
    end
  end

  describe ".call_taxon_indexing_lambda empty-response arms" do
    before { allow(LogUtil).to receive(:log_error) }

    it "raises when call_lambda yields no response at all" do
      allow(described_class).to receive(:call_lambda).and_return(nil)

      expect { described_class.call_taxon_indexing_lambda(1, [2]) }
        .to raise_error(/empty response from taxon-indexing-concurrency-manager/)
      expect(LogUtil).to have_received(:log_error).with(/empty response/, hash_including(background_id: 1))
    end

    it "raises when the response carries no payload" do
      allow(described_class).to receive(:call_lambda).and_return(OpenStruct.new(payload: nil))

      expect { described_class.call_taxon_indexing_lambda(1, [2]) }
        .to raise_error(/empty response from taxon-indexing-concurrency-manager/)
    end

    it "accepts a well-formed array payload with no failures" do
      allow(described_class).to receive(:call_lambda)
        .and_return(OpenStruct.new(payload: OpenStruct.new(string: '[{"StatusCode":200}]')))

      expect { described_class.call_taxon_indexing_lambda(1, [2]) }.not_to raise_error
    end
  end

  describe ".build_taxon_tags_filter_clause known_pathogens arm" do
    it "filters to the global pathogen list's tax ids" do
      pathogens = double("pathogens_info")
      allow(pathogens).to receive(:pluck).with(:tax_id).and_return([101, 202])
      list_version = double("list_version")
      allow(list_version).to receive(:fetch_pathogens_info).and_return(pathogens)
      allow(PathogenList).to receive(:find_by).with(is_global: true)
                                              .and_return(double("list", fetch_list_version: list_version))

      clause = described_class.build_taxon_tags_filter_clause(["known_pathogens"])

      expect(clause).to eq([{ "terms": { "tax_id": [101, 202] } }])
    end

    it "returns an empty clause for any other tag set" do
      expect(described_class.build_taxon_tags_filter_clause(["something_else"])).to eq([])
    end
  end

  describe ".samples_taxons_details" do
    let(:project) { create(:project) }

    it "reports the alignment config name and fills in samples with no taxon results" do
      sample_with = create(:sample, project: project, name: "Has Results")
      sample_without = create(:sample, project: project, name: "No Results")
      pr = create(:pipeline_run, sample: sample_with, pipeline_version: "6.10")

      results = described_class.samples_taxons_details(
        { pr.id => { "pr" => pr, "taxon_counts" => [] } },
        [sample_with, sample_without]
      )

      by_id = results.index_by { |r| r[:sample_id] }
      expect(by_id[sample_with.id][:alignment_config_name]).to eq(pr.alignment_config.name)
      expect(by_id[sample_with.id][:pipeline_version]).to eq("6.10")
      expect(by_id[sample_with.id][:taxons]).to eq([])
      # The fill-in arm: no pipeline-run entry, so only the metadata shell.
      expect(by_id[sample_without.id][:ercc_count]).to eq(0)
      expect(by_id[sample_without.id]).not_to have_key(:alignment_config_name)
      expect(by_id[sample_without.id][:name]).to eq("No Results")
    end

    it "leaves alignment_config_name nil when the run has no alignment config" do
      sample = create(:sample, project: project, name: "No Alignment Config")
      pr = create(:pipeline_run, sample: sample)
      allow(pr).to receive(:alignment_config).and_return(nil)

      results = described_class.samples_taxons_details({ pr.id => { "pr" => pr, "taxon_counts" => [] } }, [sample])

      expect(results.first[:alignment_config_name]).to be_nil
      expect(results.first[:sample_id]).to eq(sample.id)
    end
  end
end
