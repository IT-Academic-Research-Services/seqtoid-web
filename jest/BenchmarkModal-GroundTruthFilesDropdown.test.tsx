// Coverage: .../SamplesView/components/BenchmarkModal/GroundTruthFilesDropdown/
//   assets/src/components/views/samples/SamplesView/BenchmarkModal/
//   GroundTruthFilesDropdown/GroundTruthFilesDropdown.tsx
//
// The dropdown fetches the truth-file list on mount, flips a loading flag
// around the request, derives its label from the selected option (?? fallback
// when nothing is selected), maps the file names into {id, name} options, and
// guards its onChange against a null selection. The sds Dropdown is stubbed so
// each of those computed props can be inspected and its callbacks invoked.
import { render, screen, waitFor } from "@testing-library/react";

const mockGetFiles = jest.fn();
jest.mock("~/api", () => ({
  getBenchmarkGroundTruthFiles: (...args: unknown[]) => mockGetFiles(...args),
}));

const mockDropdown: { props: $TSFixMe } = { props: null };

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    Dropdown: (props: $TSFixMe) => {
      mockDropdown.props = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "sds-dropdown" },
        props.label,
      );
    },
    LoadingIndicator: (props: $TSFixMe) =>
      ReactLib.createElement("span", {
        "data-testid": "loading-indicator",
        "data-style": props.sdsStyle,
      }),
  };
});

import { GroundTruthFilesDropdown } from "~/components/views/DiscoveryView/components/SamplesView/components/BenchmarkModal/GroundTruthFilesDropdown/assets/src/components/views/samples/SamplesView/BenchmarkModal/GroundTruthFilesDropdown/GroundTruthFilesDropdown";

const renderDropdown = (props: $TSFixMe = {}) =>
  render(
    <GroundTruthFilesDropdown
      onGroundTruthFileSelection={props.onGroundTruthFileSelection ?? jest.fn()}
      selectedGroundTruthFileOption={
        props.selectedGroundTruthFileOption ?? (null as $TSFixMe)
      }
    />,
  );

const waitForOptions = async () =>
  waitFor(() => expect(mockDropdown.props.options.length).toBeGreaterThan(0));

beforeEach(() => {
  jest.clearAllMocks();
  mockDropdown.props = null;
  mockGetFiles.mockResolvedValue({
    groundTruthFileNames: ["truth_a.tsv", "truth_b.tsv"],
    groundTruthFilesS3Bucket: "s3://benchmarks/truth/",
  });
});

describe("GroundTruthFilesDropdown fetching", () => {
  it("requests the truth files exactly once on mount", async () => {
    renderDropdown();
    await waitForOptions();
    expect(mockGetFiles).toHaveBeenCalledTimes(1);
  });

  it("starts with no options and an empty list while the request is pending", () => {
    let resolve: (v: $TSFixMe) => void = () => undefined;
    mockGetFiles.mockReturnValue(
      new Promise(res => {
        resolve = res;
      }),
    );
    renderDropdown();
    expect(mockDropdown.props.options).toEqual([]);
    expect(mockDropdown.props.DropdownMenuProps.loading).toBe(true);
    resolve({
      groundTruthFileNames: [],
      groundTruthFilesS3Bucket: "",
    });
  });

  it("clears the loading flag once the files arrive", async () => {
    renderDropdown();
    await waitForOptions();
    expect(mockDropdown.props.DropdownMenuProps.loading).toBe(false);
  });

  it("maps each file name to an indexed option", async () => {
    renderDropdown();
    await waitForOptions();
    expect(mockDropdown.props.options).toEqual([
      { id: 0, name: "truth_a.tsv" },
      { id: 1, name: "truth_b.tsv" },
    ]);
  });

  it("renders an empty option list when the API returns no files", async () => {
    mockGetFiles.mockResolvedValue({
      groundTruthFileNames: [],
      groundTruthFilesS3Bucket: "s3://empty/",
    });
    renderDropdown();
    await waitFor(() =>
      expect(mockDropdown.props.DropdownMenuProps.loading).toBe(false),
    );
    expect(mockDropdown.props.options).toEqual([]);
  });
});

describe("GroundTruthFilesDropdown label", () => {
  it("falls back to the optional-selection copy when nothing is selected", async () => {
    renderDropdown();
    await waitForOptions();
    expect(mockDropdown.props.label).toBe("Select a truth file (optional)");
    expect(screen.getByText("Select a truth file (optional)")).toBeTruthy();
  });

  it("uses the selected option's name once one is chosen", async () => {
    renderDropdown({
      selectedGroundTruthFileOption: { id: 1, name: "truth_b.tsv" },
    });
    await waitForOptions();
    expect(mockDropdown.props.label).toBe("truth_b.tsv");
    expect(mockDropdown.props.InputDropdownProps.label).toBe("truth_b.tsv");
    expect(mockDropdown.props.value).toEqual({ id: 1, name: "truth_b.tsv" });
  });

  it("falls back when the selected option carries no name", async () => {
    renderDropdown({
      selectedGroundTruthFileOption: { id: 3 } as $TSFixMe,
    });
    await waitForOptions();
    expect(mockDropdown.props.label).toBe("Select a truth file (optional)");
  });
});

describe("GroundTruthFilesDropdown selection", () => {
  it("reports the chosen option together with the fetched bucket path", async () => {
    const onGroundTruthFileSelection = jest.fn();
    renderDropdown({ onGroundTruthFileSelection });
    await waitForOptions();
    mockDropdown.props.onChange({ id: 1, name: "truth_b.tsv" });
    expect(onGroundTruthFileSelection).toHaveBeenCalledWith({
      groundTruthFileOption: { id: 1, name: "truth_b.tsv" },
      s3BucketPath: "s3://benchmarks/truth/",
    });
  });

  it("ignores a cleared (null) selection", async () => {
    const onGroundTruthFileSelection = jest.fn();
    renderDropdown({ onGroundTruthFileSelection });
    await waitForOptions();
    mockDropdown.props.onChange(null);
    expect(onGroundTruthFileSelection).not.toHaveBeenCalled();
  });
});

describe("GroundTruthFilesDropdown menu wiring", () => {
  it("compares options to the current value by file name", async () => {
    renderDropdown();
    await waitForOptions();
    const { isOptionEqualToValue } = mockDropdown.props.DropdownMenuProps;
    expect(
      isOptionEqualToValue(
        { id: 0, name: "truth_a.tsv" },
        { name: "truth_a.tsv" },
      ),
    ).toBe(true);
    expect(
      isOptionEqualToValue(
        { id: 0, name: "truth_a.tsv" },
        { name: "other.tsv" },
      ),
    ).toBe(false);
  });

  it("keeps the search text on select and renders a minimal loading indicator", async () => {
    renderDropdown();
    await waitForOptions();
    expect(mockDropdown.props.DropdownMenuProps.keepSearchOnSelect).toBe(true);
    render(mockDropdown.props.DropdownMenuProps.loadingText);
    expect(
      screen.getByTestId("loading-indicator").getAttribute("data-style"),
    ).toBe("minimal");
  });
});
