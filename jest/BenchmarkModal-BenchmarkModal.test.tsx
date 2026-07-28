// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/
//   components/BenchmarkModal/BenchmarkModal.tsx
//
// The modal caps the benchmark at the first two selected samples, holds the
// truth-file selection in local state, and derives fullGroundTruthFilePath from
// it -- null while nothing is selected, `${bucket}${name}` once something is.
// Both arms of that conditional are confirmed through the onConfirm payload,
// along with the confirm-then-close ordering and the cancel path.
import { act, fireEvent, render, screen } from "@testing-library/react";

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    Dialog: (props: $TSFixMe) =>
      props.open
        ? ReactLib.createElement(
            "div",
            { "data-testid": "dialog", "data-size": props.sdsSize },
            props.children,
          )
        : null,
    DialogActions: (props: $TSFixMe) =>
      ReactLib.createElement("div", null, props.children),
    DialogContent: (props: $TSFixMe) =>
      ReactLib.createElement("div", null, props.children),
    DialogTitle: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        null,
        ReactLib.createElement("h1", null, props.title),
        ReactLib.createElement("h2", null, props.subtitle),
      ),
  };
});

jest.mock("~/components/ui/controls/buttons", () => {
  const ReactLib = require("react");
  const mkButton = (testId: string) => (props: $TSFixMe) =>
    ReactLib.createElement(
      "button",
      { type: "button", "data-testid": testId, onClick: props.onClick },
      props.text,
    );
  return {
    __esModule: true,
    PrimaryButton: mkButton("primary-button"),
    SecondaryButton: mkButton("secondary-button"),
  };
});

let lastDropdownProps: $TSFixMe = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BenchmarkModal/GroundTruthFilesDropdown/assets/src/components/views/samples/SamplesView/BenchmarkModal/GroundTruthFilesDropdown",
  () => ({
    __esModule: true,
    GroundTruthFilesDropdown: (props: $TSFixMe) => {
      lastDropdownProps = props;
      const ReactLib = require("react");
      return ReactLib.createElement("div", {
        "data-testid": "truth-dropdown",
        "data-selected": props.selectedGroundTruthFileOption
          ? props.selectedGroundTruthFileOption.name
          : "none",
      });
    },
  }),
);

let lastTableProps: $TSFixMe = null;
jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BenchmarkModal/BenchmarkSamplesTable",
  () => ({
    __esModule: true,
    BenchmarkSamplesTable: (props: $TSFixMe) => {
      lastTableProps = props;
      return require("react").createElement("div", {
        "data-testid": "benchmark-samples-table",
      });
    },
  }),
);

import { WorkflowType } from "~/components/utils/workflows";
import { BenchmarkModal } from "~/components/views/DiscoveryView/components/SamplesView/components/BenchmarkModal/BenchmarkModal";

const entry = (id: number) =>
  ({ id: String(id), sample: { name: `sample-${id}` } } as $TSFixMe);

const renderModal = (props: $TSFixMe = {}) => {
  const onConfirm = props.onConfirm ?? jest.fn();
  const onClose = props.onClose ?? jest.fn();
  const utils = render(
    <BenchmarkModal
      open={props.open ?? true}
      onConfirm={onConfirm}
      onClose={onClose}
      selectedObjects={props.selectedObjects ?? [entry(1), entry(2)]}
      workflow={props.workflow ?? WorkflowType.SHORT_READ_MNGS}
    />,
  );
  return { ...utils, onConfirm, onClose };
};

beforeEach(() => {
  lastDropdownProps = null;
  lastTableProps = null;
});

describe("BenchmarkModal open state", () => {
  it("renders nothing when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByTestId("dialog")).toBeNull();
  });

  it("renders the title, workflow subtitle and destination project when open", () => {
    renderModal({ workflow: WorkflowType.CONSENSUS_GENOME });
    expect(screen.getByText("Benchmark Samples")).toBeTruthy();
    expect(
      screen.getByText(
        `Workflow benchmarked: ${WorkflowType.CONSENSUS_GENOME}`,
      ),
    ).toBeTruthy();
    expect(screen.getByText("SeqtoID Benchmarks")).toBeTruthy();
  });
});

describe("BenchmarkModal sample capping", () => {
  it("passes at most the first two selected samples to the table", () => {
    renderModal({
      selectedObjects: [entry(1), entry(2), entry(3), entry(4)],
    });
    expect(lastTableProps.selectedObjects.map((o: $TSFixMe) => o.id)).toEqual([
      "1",
      "2",
    ]);
  });

  it("passes a single selection through untouched", () => {
    renderModal({ selectedObjects: [entry(9)] });
    expect(lastTableProps.selectedObjects).toHaveLength(1);
  });

  it("tolerates an empty selection", () => {
    renderModal({ selectedObjects: [] });
    expect(lastTableProps.selectedObjects).toEqual([]);
  });
});

describe("BenchmarkModal confirm payload", () => {
  it("sends a null truth-file path when nothing was selected", () => {
    const { onConfirm, onClose } = renderModal();
    fireEvent.click(screen.getByTestId("primary-button"));
    expect(onConfirm).toHaveBeenCalledWith({
      fullGroundTruthFilePath: null,
      samplesToBenchmark: [
        expect.objectContaining({ id: "1" }),
        expect.objectContaining({ id: "2" }),
      ],
    });
    // Confirming also dismisses the modal.
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("joins the bucket path and file name once a truth file is chosen", () => {
    const { onConfirm } = renderModal();
    act(() => {
      lastDropdownProps.onGroundTruthFileSelection({
        groundTruthFileOption: { id: 0, name: "truth_a.tsv" },
        s3BucketPath: "s3://bench/truth/",
      });
    });
    fireEvent.click(screen.getByTestId("primary-button"));
    expect(onConfirm.mock.calls[0][0].fullGroundTruthFilePath).toBe(
      "s3://bench/truth/truth_a.tsv",
    );
  });

  it("forwards the capped sample list in the confirm payload", () => {
    const { onConfirm } = renderModal({
      selectedObjects: [entry(1), entry(2), entry(3)],
    });
    fireEvent.click(screen.getByTestId("primary-button"));
    expect(
      onConfirm.mock.calls[0][0].samplesToBenchmark.map((s: $TSFixMe) => s.id),
    ).toEqual(["1", "2"]);
  });
});

describe("BenchmarkModal truth-file selection state", () => {
  it("starts with no selection handed to the dropdown", () => {
    renderModal();
    expect(
      screen.getByTestId("truth-dropdown").getAttribute("data-selected"),
    ).toBe("none");
  });

  it("feeds the chosen option back down to the dropdown", () => {
    renderModal();
    act(() => {
      lastDropdownProps.onGroundTruthFileSelection({
        groundTruthFileOption: { id: 2, name: "truth_c.tsv" },
        s3BucketPath: "s3://bench/",
      });
    });
    expect(
      screen.getByTestId("truth-dropdown").getAttribute("data-selected"),
    ).toBe("truth_c.tsv");
  });
});

describe("BenchmarkModal cancel", () => {
  it("closes without confirming", () => {
    const { onConfirm, onClose } = renderModal();
    fireEvent.click(screen.getByTestId("secondary-button"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });
});
