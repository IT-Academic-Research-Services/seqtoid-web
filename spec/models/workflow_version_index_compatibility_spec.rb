require "rails_helper"

# CZID-977 -- a pipeline version may only run against NCBI index vintages it is recorded as
# compatible with.
#
# The failure this prevents is SILENT: an old pipeline on a new index runs to completion and can
# simply be wrong. Version and index are pinned independently, so nothing else checks the pairing.
RSpec.describe WorkflowVersion, type: :model do
  let(:workflow) { WorkflowRun::WORKFLOW[:short_read_mngs] }

  def version_with(bounds)
    create(:workflow_version, { workflow: workflow, version: "8.3.15" }.merge(bounds))
  end

  describe "#compatible_with_index?" do
    context "when no bounds are recorded" do
      # Unrecorded means UNCONSTRAINED, not incompatible -- the boundaries are a scientific judgment
      # this codebase does not record, so an unpopulated catalog behaves exactly as it does today.
      it "accepts any index" do
        wv = version_with({})

        expect(wv.compatible_with_index?("2018-02-15")).to be true
        expect(wv.compatible_with_index?("2026-07-09")).to be true
      end
    end

    context "with a lower bound" do
      it "rejects an index older than the bound" do
        wv = version_with(min_index_version: "2024-02-06")

        expect(wv.compatible_with_index?("2021-01-22")).to be false
      end

      it "accepts the bound itself and anything newer" do
        wv = version_with(min_index_version: "2024-02-06")

        expect(wv.compatible_with_index?("2024-02-06")).to be true
        expect(wv.compatible_with_index?("2026-07-09")).to be true
      end
    end

    context "with an upper bound" do
      it "rejects an index newer than the bound" do
        wv = version_with(max_index_version: "2024-02-06")

        expect(wv.compatible_with_index?("2026-07-09")).to be false
      end

      it "accepts the bound itself and anything older" do
        wv = version_with(max_index_version: "2024-02-06")

        expect(wv.compatible_with_index?("2024-02-06")).to be true
        expect(wv.compatible_with_index?("2021-01-22")).to be true
      end
    end

    context "with both bounds" do
      # The real shape: dev's 8.3.15 has run against BOTH 2024-02-06 and 2026-07-09, so a version
      # spans several vintages and a range is the right model rather than a single pairing.
      it "accepts the whole recorded range and rejects outside it" do
        wv = version_with(min_index_version: "2024-02-06", max_index_version: "2026-07-09")

        expect(wv.compatible_with_index?("2024-02-06")).to be true
        expect(wv.compatible_with_index?("2026-07-09")).to be true
        expect(wv.compatible_with_index?("2021-01-22")).to be false
        expect(wv.compatible_with_index?("2027-01-01")).to be false
      end
    end

    it "compares dates numerically, not lexically" do
      # Reuses the CZID-972 ordering. A string compare would get single- vs double-digit months
      # wrong, e.g. "2024-9-01" vs "2024-10-01".
      wv = version_with(min_index_version: "2024-9-01")

      expect(wv.compatible_with_index?("2024-10-01")).to be true
      expect(wv.compatible_with_index?("2024-8-01")).to be false
    end

    it "treats a blank index as unconstrained rather than failing the run" do
      wv = version_with(min_index_version: "2024-02-06")

      expect(wv.compatible_with_index?(nil)).to be true
      expect(wv.compatible_with_index?("")).to be true
    end
  end

  describe "#index_compatibility_range" do
    it "is nil when unconstrained, so callers can tell 'no rule' from 'a rule'" do
      expect(version_with({}).index_compatibility_range).to be_nil
    end

    it "describes a one-sided bound" do
      expect(version_with(min_index_version: "2024-02-06").index_compatibility_range)
        .to eq("2024-02-06 to any")
    end

    it "describes a full range" do
      wv = version_with(min_index_version: "2024-02-06", max_index_version: "2026-07-09")

      expect(wv.index_compatibility_range).to eq("2024-02-06 to 2026-07-09")
    end
  end
end
