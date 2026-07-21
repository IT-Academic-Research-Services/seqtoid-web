require "rails_helper"

# Branch coverage for SnapshotSamplesHelper#snapshot_pipeline_run_info. The existing
# spec drives the branch where a pipeline_run is present; this covers the ELSE arm of
# the L19 ternary, where a nil pipeline_run yields the 'WAITING' placeholder status.
RSpec.describe SnapshotSamplesHelper, type: :helper do
  describe "#snapshot_pipeline_run_info" do
    it "reports WAITING when the pipeline_run is nil" do
      entry = helper.snapshot_pipeline_run_info(nil, {})
      expect(entry[:result_status_description]).to eq("WAITING")
    end
  end
end
