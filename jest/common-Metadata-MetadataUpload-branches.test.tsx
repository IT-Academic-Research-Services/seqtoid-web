// Coverage: app/assets/src/components/common/Metadata/MetadataUpload.tsx
//
// Branch-only companion to jest/common-Metadata-MetadataUpload.test.tsx. That
// spec drives the container's happy paths with an onDirty callback always
// supplied and a project that always returns fields; the conditionals left dark
// are all the "other" arm of a guard:
//
//   * processProjectMetadataFields' isEmpty() guard, when the project has no
//     metadata fields at all -- the helper falls off the end and the manual
//     grid never mounts.
//   * getCSVLocationMatches' `if (!metadata) return`, reached when a CSV
//     validates clean but carries no parsed metadata, so no geosearch is fired.
//   * `if (this.props.onDirty)` in onMetadataChangeCSVLocationsMenu, when the
//     parent did not pass onDirty -- the metadata change must still be
//     forwarded. (The matching guard in onMetadataChangeManual is covered too,
//     for symmetry.)
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { getAllHostGenomes, getAllSampleTypes } from "~/api";
import { getProjectMetadataFields } from "~/api/metadata";
import MetadataUpload from "~/components/common/Metadata/MetadataUpload";
import { geosearchCSVLocations } from "~/components/common/Metadata/utils";
import { WorkflowType } from "~/components/utils/workflows";

jest.mock("~/api", () => ({
  getAllHostGenomes: jest.fn(),
  getAllSampleTypes: jest.fn(),
}));
jest.mock("~/api/metadata", () => ({
  getProjectMetadataFields: jest.fn(),
}));
jest.mock("~/components/utils/clientDownload", () => ({
  generateClientDownloadFromEndpoint: jest.fn(),
}));
jest.mock("~/components/common/Metadata/utils", () => ({
  geosearchCSVLocations: jest.fn(),
}));

jest.mock("~/components/common/Metadata/MetadataManualInput", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="manual-input-stub">
      <button
        data-testid="manual-change"
        onClick={() =>
          props.onMetadataChange({ metadata: { headers: ["a"], rows: [] } })
        }
      />
    </div>
  ),
}));

jest.mock("~/components/common/Metadata/MetadataCSVUpload", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="csv-upload-stub">
      <button
        data-testid="csv-clean"
        onClick={() =>
          props.onMetadataChange({
            metadata: { headers: ["collection_location_v2"], rows: [{}] },
            issues: { errors: [], warnings: [] },
            validatingCSV: false,
            newHostGenomes: [],
          })
        }
      />
      {/* Validated clean, but nothing was parsed out of the file. */}
      <button
        data-testid="csv-clean-but-empty"
        onClick={() =>
          props.onMetadataChange({
            metadata: null,
            issues: { errors: [], warnings: [] },
            validatingCSV: false,
            newHostGenomes: [],
          })
        }
      />
    </div>
  ),
}));

jest.mock("~/components/common/Metadata/MetadataCSVLocationsMenu", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="locations-menu-stub">
      <button
        data-testid="locations-change"
        onClick={() =>
          props.onMetadataChange({ metadata: { headers: [], rows: [] } })
        }
      />
    </div>
  ),
}));

// MetadataUpload mounts a fairly deep tree (Tabs + the metadata dictionary
// blurb) on every render, which is slow enough under a loaded CI box to trip
// the 5s default. Everything here is still fully deterministic; only the
// patience is raised.
jest.setTimeout(60000);
const FIND_OPTS = { timeout: 20000 };

const mockedFields = getProjectMetadataFields as jest.MockedFunction<$TSFixMe>;
const mockedHostGenomes = getAllHostGenomes as jest.MockedFunction<$TSFixMe>;
const mockedSampleTypes = getAllSampleTypes as jest.MockedFunction<$TSFixMe>;
const mockedGeosearch = geosearchCSVLocations as jest.MockedFunction<$TSFixMe>;

const PROJECT_FIELDS = [
  {
    key: "collection_location_v2",
    name: "Collection Location",
    dataType: "location",
    is_required: 1,
  },
  { key: "sample_type", name: "Sample Type", dataType: "string" },
];

const renderUpload = (props: Record<string, unknown> = {}) =>
  render(
    <MetadataUpload
      project={{ id: 5, name: "Malaria Study" } as $TSFixMe}
      samples={[{ name: "sample_one" }] as $TSFixMe}
      onMetadataChange={jest.fn()}
      onShowCSVInstructions={jest.fn()}
      workflows={new Set([WorkflowType.SHORT_READ_MNGS])}
      samplesAreNew
      visible
      {...(props as $TSFixMe)}
    />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockedFields.mockResolvedValue(PROJECT_FIELDS);
  mockedHostGenomes.mockResolvedValue([
    { id: 1, name: "Human", ercc_only: false, showAsOption: true },
  ]);
  mockedSampleTypes.mockResolvedValue([{ name: "CSF" }]);
  mockedGeosearch.mockResolvedValue({ headers: ["loc"], rows: [] });
});

describe("MetadataUpload -- a project with no metadata fields", () => {
  it("never leaves the loading placeholder when the field list comes back empty", async () => {
    mockedFields.mockResolvedValue([]);
    const { rerender } = renderUpload();

    await waitFor(
      () => expect(mockedFields).toHaveBeenCalledTimes(1),
      FIND_OPTS,
    );
    // Let the componentDidMount promises settle.
    await act(async () => {
      await Promise.resolve();
    });

    // isEmpty() short-circuits, so no field map is ever produced and the manual
    // grid cannot mount.
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByTestId("manual-input-stub")).toBeNull();

    // Proof this is the empty-list branch and not just a slow first render:
    // switching to a project that does have fields mounts the grid.
    mockedFields.mockResolvedValue(PROJECT_FIELDS);
    rerender(
      <MetadataUpload
        project={{ id: 6, name: "Other Study" } as $TSFixMe}
        samples={[{ name: "sample_one" }] as $TSFixMe}
        onMetadataChange={jest.fn()}
        onShowCSVInstructions={jest.fn()}
        workflows={new Set([WorkflowType.SHORT_READ_MNGS])}
        samplesAreNew
        visible
      />,
    );

    await screen.findByTestId("manual-input-stub", undefined, FIND_OPTS);
  });
});

describe("MetadataUpload -- a clean CSV that parsed to nothing", () => {
  it("skips the location geosearch when there is no metadata to search", async () => {
    const onMetadataChange = jest.fn();
    renderUpload({ onMetadataChange });
    await screen.findByTestId("manual-input-stub", undefined, FIND_OPTS);
    fireEvent.click(screen.getByTestId("csv-upload"));

    fireEvent.click(screen.getByTestId("csv-clean-but-empty"));

    // The change is still reported upward...
    expect(onMetadataChange).toHaveBeenLastCalledWith({
      metadata: null,
      issues: { errors: [], warnings: [] },
      wasManual: false,
      newHostGenomes: [],
    });
    // ...but the geosearch never runs, so neither the "verifying" message nor
    // the locations menu appears.
    await act(async () => {
      await Promise.resolve();
    });
    expect(mockedGeosearch).not.toHaveBeenCalled();
    expect(screen.queryByText("Verifying collection locations...")).toBeNull();
    expect(screen.queryByTestId("locations-menu-stub")).toBeNull();
  });

  it("does run the geosearch when the CSV did parse to metadata", async () => {
    // Contrast case, so the guard above is demonstrably the thing that stopped
    // the geosearch rather than the stubbing.
    renderUpload();
    await screen.findByTestId("manual-input-stub", undefined, FIND_OPTS);
    fireEvent.click(screen.getByTestId("csv-upload"));

    fireEvent.click(screen.getByTestId("csv-clean"));

    await screen.findByTestId("locations-menu-stub", undefined, FIND_OPTS);
    expect(mockedGeosearch).toHaveBeenCalledTimes(1);
  });
});

describe("MetadataUpload -- parents that do not pass onDirty", () => {
  it("forwards a manual-grid change without an onDirty callback", async () => {
    const onMetadataChange = jest.fn();
    renderUpload({ onMetadataChange, onDirty: undefined });
    await screen.findByTestId("manual-input-stub", undefined, FIND_OPTS);

    expect(() =>
      fireEvent.click(screen.getByTestId("manual-change")),
    ).not.toThrow();

    expect(onMetadataChange).toHaveBeenLastCalledWith({
      metadata: { headers: ["a"], rows: [] },
      wasManual: true,
    });
  });

  it("forwards a locations-menu change without an onDirty callback", async () => {
    const onMetadataChange = jest.fn();
    renderUpload({ onMetadataChange, onDirty: undefined });
    await screen.findByTestId("manual-input-stub", undefined, FIND_OPTS);
    fireEvent.click(screen.getByTestId("csv-upload"));
    fireEvent.click(screen.getByTestId("csv-clean"));
    await screen.findByTestId("locations-menu-stub", undefined, FIND_OPTS);

    expect(() =>
      fireEvent.click(screen.getByTestId("locations-change")),
    ).not.toThrow();

    expect(onMetadataChange).toHaveBeenLastCalledWith({
      metadata: { headers: [], rows: [] },
      wasManual: true,
    });
  });
});
