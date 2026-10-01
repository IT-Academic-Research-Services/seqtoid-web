require "rails_helper"

RSpec.describe IndexTaxons, type: :job do
  describe "#perform" do
    let(:background_id) { 42 }
    let(:pipeline_run_id) { 99 }

    before do
      allow(HeatmapIndexing).to receive(:release)
      allow(ElasticsearchQueryHelper).to receive(:find_complete_pipeline_runs).and_return([])
    end

    it "calls the taxon indexing lambda once (no in-job retry) and releases the pending marker" do
      expect(ElasticsearchQueryHelper).to receive(:call_taxon_indexing_lambda)
        .with(background_id, [pipeline_run_id], max_attempts: 1)
      IndexTaxons.perform(background_id, pipeline_run_id)
      expect(HeatmapIndexing).to have_received(:release).with(background_id, pipeline_run_id)
    end

    it "skips a run that is already complete for the background, and releases the marker" do
      allow(ElasticsearchQueryHelper).to receive(:find_complete_pipeline_runs)
        .with(background_id, [pipeline_run_id]).and_return([pipeline_run_id])
      expect(ElasticsearchQueryHelper).not_to receive(:call_taxon_indexing_lambda)
      IndexTaxons.perform(background_id, pipeline_run_id)
      expect(HeatmapIndexing).to have_received(:release).with(background_id, pipeline_run_id)
    end

    it "re-indexes a complete run when forced (results were just reloaded)" do
      allow(ElasticsearchQueryHelper).to receive(:find_complete_pipeline_runs).and_return([pipeline_run_id])
      expect(ElasticsearchQueryHelper).to receive(:call_taxon_indexing_lambda)
        .with(background_id, [pipeline_run_id], max_attempts: 1)
      IndexTaxons.perform(background_id, pipeline_run_id, true)
    end

    it "propagates errors and keeps the marker so retries are not duplicated" do
      allow(ElasticsearchQueryHelper).to receive(:call_taxon_indexing_lambda).and_raise(StandardError.new("lambda down"))
      expect do
        IndexTaxons.perform(background_id, pipeline_run_id)
      end.to raise_error(StandardError, "lambda down")
      expect(HeatmapIndexing).not_to have_received(:release)
    end
  end

  it "retries 3 times with 30 s / 2 min / 10 min backoff" do
    expect(IndexTaxons.instance_variable_get(:@backoff_strategy)).to eq([30, 120, 600])
  end
end
