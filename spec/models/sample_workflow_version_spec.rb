require "rails_helper"

# CZID-975/CZID-976 -- the user's version selections, keyed by workflow.
#
# Validated at the UPLOAD boundary so a malformed selection is a 4xx on the request rather than a 500
# later at dispatch (dispatch resolves the version well after the upload response has returned).
#
# The map replaced a single string. One upload can run several workflows -- the upload flow supports
# short-read-mngs and amr together -- so a single value meant an AMR choice was also handed to the
# mNGS dispatch, which would resolve it against the wrong catalog and fail the mNGS run.
RSpec.describe Sample, type: :model do
  let(:project) { create(:project) }
  let(:mngs) { WorkflowRun::WORKFLOW[:short_read_mngs] }
  let(:amr) { WorkflowRun::WORKFLOW[:amr] }

  def sample_with(versions)
    build(:sample, project: project, workflow_versions: versions)
  end

  describe "validation" do
    it "accepts no selection at all -- the overwhelmingly common case" do
      expect(sample_with(nil)).to be_valid
      expect(sample_with({})).to be_valid
    end

    it "accepts a selection for one workflow" do
      expect(sample_with({ mngs => "8.1.2" })).to be_valid
    end

    it "accepts independent selections for several workflows on one upload" do
      # The case the single-string model got wrong.
      expect(sample_with({ mngs => "8.1.2", amr => "1.4.2" })).to be_valid
    end

    ["8", "8.1", "8.1.2"].each do |good|
      it "accepts the version shape #{good.inspect}" do
        expect(sample_with({ mngs => good })).to be_valid
      end
    end

    ["8.1.2.3", "v8.1.2", "eight", "8%", "%", "8; DROP TABLE samples"].each do |bad|
      it "rejects the version shape #{bad.inspect}" do
        sample = sample_with({ mngs => bad })

        expect(sample).not_to be_valid
        expect(sample.errors[:workflow_versions].join).to match(/major.*minor.*full version/)
      end
    end

    it "rejects an unknown workflow key" do
      sample = sample_with({ "not-a-workflow" => "1.0.0" })

      expect(sample).not_to be_valid
      expect(sample.errors[:workflow_versions].join).to match(/unknown workflow/)
    end

    it "rejects a non-map value" do
      sample = sample_with("8.1.2")

      expect(sample).not_to be_valid
      expect(sample.errors[:workflow_versions].join).to match(/map of workflow to version/)
    end
  end

  describe "#selected_workflow_version" do
    it "returns only the selection for the workflow asked about" do
      sample = create(:sample, project: project, workflow_versions: { mngs => "8.1.2", amr => "1.4.2" })

      expect(sample.selected_workflow_version(mngs)).to eq("8.1.2")
      expect(sample.selected_workflow_version(amr)).to eq("1.4.2")
    end

    # The regression that motivated the map: an AMR selection must not reach the mNGS dispatch.
    it "returns nil for a workflow the user did not choose a version for" do
      sample = create(:sample, project: project, workflow_versions: { amr => "1.4.2" })

      expect(sample.selected_workflow_version(mngs)).to be_nil
    end

    it "returns nil when nothing was selected" do
      sample = create(:sample, project: project)

      expect(sample.selected_workflow_version(mngs)).to be_nil
    end

    it "persists the map so dispatch can read it back" do
      sample = create(:sample, project: project, workflow_versions: { mngs => "8.1.2" })

      expect(sample.reload.selected_workflow_version(mngs)).to eq("8.1.2")
    end
  end
end
