// Frontend coverage: workflowTypeConfig maps each workflow to whether the
// coverage viz supports read-level display and to the message shown when the
// viz is unavailable. The long-read arm branches on a pipeline-version feature
// flag (LONG_READ_MNGS_COV_VIS_WITH_ONE_READ, min version 0.7.5), so exercise
// both sides of that version comparison.
import { CoverageVizBottomSidebarConfig } from "~/components/common/CoverageVizBottomSidebar/workflowTypeConfig";
import { WorkflowType } from "~/components/utils/workflows";

const CONTIG_REQUIRED =
  "Sorry, the coverage visualization is only available for taxa with at least one assembled contig in NT.";
const READ_REQUIRED =
  "Sorry, the coverage visualization is only available for taxa with at least one assembled NT read.";

describe("CoverageVizBottomSidebarConfig", () => {
  it("has an entry for every workflow type", () => {
    Object.values(WorkflowType).forEach(workflow => {
      expect(CoverageVizBottomSidebarConfig[workflow]).toBeDefined();
    });
  });

  it("enables read-level viz only for short-read mNGS", () => {
    const readLevelEnabled = Object.values(WorkflowType).filter(
      workflow =>
        CoverageVizBottomSidebarConfig[workflow].isReadLevelVizAvailable,
    );
    expect(readLevelEnabled).toEqual([WorkflowType.SHORT_READ_MNGS]);
  });

  it("has no unavailable-message builder for non-mNGS workflows", () => {
    [
      WorkflowType.AMR,
      WorkflowType.AMR_DEPRECATED,
      WorkflowType.BENCHMARK,
      WorkflowType.CONSENSUS_GENOME,
    ].forEach(workflow => {
      expect(
        CoverageVizBottomSidebarConfig[workflow].getUnavailableMessage,
      ).toBeNull();
    });
  });

  it("always asks short-read mNGS for a contig, regardless of version", () => {
    const getMessage =
      CoverageVizBottomSidebarConfig[WorkflowType.SHORT_READ_MNGS]
        .getUnavailableMessage;
    expect(getMessage).not.toBeNull();
    expect(getMessage && getMessage("8.0.0")).toBe(CONTIG_REQUIRED);
    // The short-read builder ignores its argument entirely.
    expect(getMessage && getMessage(undefined)).toBe(CONTIG_REQUIRED);
  });

  describe("long-read mNGS unavailable message", () => {
    const getMessage =
      CoverageVizBottomSidebarConfig[WorkflowType.LONG_READ_MNGS]
        .getUnavailableMessage;

    it("asks for a read once the one-read feature is available (>= 0.7.5)", () => {
      expect(getMessage && getMessage("0.7.5")).toBe(READ_REQUIRED);
      expect(getMessage && getMessage("1.0.0")).toBe(READ_REQUIRED);
    });

    it("asks for a contig on older pipelines (< 0.7.5)", () => {
      expect(getMessage && getMessage("0.7.4")).toBe(CONTIG_REQUIRED);
      expect(getMessage && getMessage("0.6.0")).toBe(CONTIG_REQUIRED);
    });
  });
});
