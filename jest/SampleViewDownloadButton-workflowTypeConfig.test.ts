// Coverage for the SampleViewDownloadButton per-workflow config map. Each entry
// is a factory that picks the download component and computes `readyToDownload`,
// so every arm is invoked with both a satisfying and a non-satisfying argument:
// the run-status workflows (AMR / consensus genome) with SUCCEEDED, a non-final
// status and a missing run, and the reportMetadata workflows (short/long read
// mNGS + deprecated AMR) with a populated and an empty metadata object.
//
// The four download components are stubbed because the real modules pull in
// Relay, svgsaver and scss; the config only ever passes the component reference
// through, so identity against the stub is exactly what needs asserting.
jest.mock(
  "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/AmrDownloadDropdown",
  () => ({ AmrDownloadDropdown: function AmrDownloadDropdown() {} }),
);
jest.mock(
  "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/BenchmarkDownloadDropdown",
  () => ({
    BenchmarkDownloadDropdown: function BenchmarkDownloadDropdown() {},
  }),
);
jest.mock(
  "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/DownloadAllButton",
  () => ({ DownloadAllButton: function DownloadAllButton() {} }),
);
jest.mock(
  "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/MngsDownloadDropdown",
  () => ({ MngsDownloadDropdown: function MngsDownloadDropdown() {} }),
);

import { WorkflowType } from "~/components/utils/workflows";
import { AmrDownloadDropdown } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/AmrDownloadDropdown";
import { BenchmarkDownloadDropdown } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/BenchmarkDownloadDropdown";
import { DownloadAllButton } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/DownloadAllButton";
import { MngsDownloadDropdown } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/components/MngsDownloadDropdown";
import { SampleViewDownloadButtonConfig } from "~/components/views/SampleView/components/SampleViewHeader/components/PrimaryHeaderControls/components/SampleViewDownloadButton/workflowTypeConfig";

// The factories are typed against WorkflowRun / ReportMetadata / CurrentTabSample;
// only `status` and the emptiness of the metadata are read, so partials are cast
// at the call site.
const args = (currentRun: unknown, reportMetadata: unknown) =>
  ({
    currentRun,
    reportMetadata,
    currentTab: "Antimicrobial Resistance",
  } as $TSFixMe);

describe("SampleViewDownloadButtonConfig", () => {
  it("has an entry for every workflow type", () => {
    expect(Object.keys(SampleViewDownloadButtonConfig).sort()).toEqual(
      Object.values(WorkflowType).sort(),
    );
  });

  describe("run-status driven workflows", () => {
    it.each([
      [WorkflowType.AMR, AmrDownloadDropdown],
      [WorkflowType.CONSENSUS_GENOME, DownloadAllButton],
    ] as const)(
      "%s is ready only when the current run has SUCCEEDED",
      (workflow, component) => {
        const factory = SampleViewDownloadButtonConfig[workflow];

        const succeeded = factory(args({ id: 1, status: "SUCCEEDED" }, {}));
        expect(succeeded.component).toBe(component);
        expect(succeeded.readyToDownload).toBe(true);

        const running = factory(args({ id: 1, status: "RUNNING" }, {}));
        expect(running.component).toBe(component);
        expect(running.readyToDownload).toBe(false);
      },
    );

    it.each([WorkflowType.AMR, WorkflowType.CONSENSUS_GENOME] as const)(
      "%s is not ready when there is no current run at all",
      workflow => {
        // `currentRun && ...` short-circuits, so the falsy run itself is
        // returned rather than `false` -- assert falsiness, not identity.
        const result = SampleViewDownloadButtonConfig[workflow](
          args(null, { known_user_error: null }),
        );
        expect(result.readyToDownload).toBeFalsy();
      },
    );
  });

  describe("report-metadata driven workflows", () => {
    it.each([
      [WorkflowType.SHORT_READ_MNGS],
      [WorkflowType.LONG_READ_MNGS],
      [WorkflowType.AMR_DEPRECATED],
    ] as const)(
      "%s uses the mNGS dropdown and is ready once report metadata arrives",
      workflow => {
        const factory = SampleViewDownloadButtonConfig[workflow];

        const populated = factory(args(null, { pipelineRunStatus: "SUCCESS" }));
        expect(populated.component).toBe(MngsDownloadDropdown);
        expect(populated.readyToDownload).toBe(true);

        // An empty metadata object means the report has not loaded yet.
        const empty = factory(args({ status: "SUCCEEDED" }, {}));
        expect(empty.component).toBe(MngsDownloadDropdown);
        expect(empty.readyToDownload).toBe(false);
      },
    );
  });

  describe("benchmark", () => {
    it("uses the benchmark dropdown", () => {
      const result = SampleViewDownloadButtonConfig[WorkflowType.BENCHMARK](
        args({ id: 4, status: "SUCCEEDED" }, {}),
      );
      expect(result.component).toBe(BenchmarkDownloadDropdown);
    });

    it("never reports ready because its factory does not destructure its argument", () => {
      // The benchmark arm is written `currentRun => ...` while every caller
      // passes the `{ currentRun, reportMetadata, currentTab }` bag, so the
      // status lookup reads `status` off the bag and always misses. Locked in
      // here so the behaviour cannot change silently.
      const succeeded = SampleViewDownloadButtonConfig[WorkflowType.BENCHMARK](
        args({ id: 4, status: "SUCCEEDED" }, {}),
      );
      expect(succeeded.readyToDownload).toBeFalsy();

      const failed = SampleViewDownloadButtonConfig[WorkflowType.BENCHMARK](
        args({ id: 4, status: "FAILED" }, {}),
      );
      expect(failed.readyToDownload).toBeFalsy();
    });
  });
});
