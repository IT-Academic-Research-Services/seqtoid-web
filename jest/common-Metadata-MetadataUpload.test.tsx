// CZID-586 (#586) frontend coverage:
// app/assets/src/components/common/Metadata/MetadataUpload.tsx
//
// MetadataUpload is the two-tab (Manual Input / CSV Upload) container for the
// upload flow's metadata step. Its uncovered weight is almost entirely in the
// container logic rather than markup: fetching + ordering + workflow-filtering
// the project metadata fields, the CSV -> geosearch -> locations-menu handoff
// (including its failure arm), and the issues renderer with its group/plain and
// error/warning arms. The heavy leaf children (manual grid, CSV dropzone,
// locations menu) are stubbed so those paths can be driven deterministically.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { getAllHostGenomes, getAllSampleTypes } from "~/api";
import { getProjectMetadataFields } from "~/api/metadata";
import MetadataUpload from "~/components/common/Metadata/MetadataUpload";
import { geosearchCSVLocations } from "~/components/common/Metadata/utils";
import { generateClientDownloadFromEndpoint } from "~/components/utils/clientDownload";
import { WorkflowType } from "~/components/utils/workflows";

// Keep prettier's organize-imports plugin from dropping the React import that
// the classic JSX runtime needs in scope (see jest/uiControls.test.tsx).
const _React: typeof React = React;

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

// Stub the heavy leaf children. Each stub renders the props the container cares
// about plus a button that fires the callback the container passed down, so the
// container's handlers can be driven from a real click.
jest.mock("~/components/common/Metadata/MetadataManualInput", () => ({
  __esModule: true,
  default: (props: any) => (
    <div data-testid="manual-input-stub">
      {`fields:${Object.keys(props.projectMetadataFields || {}).join(",")}`}
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
  default: (props: any) => (
    <div data-testid="csv-upload-stub">
      <button
        data-testid="csv-validating"
        onClick={() =>
          props.onMetadataChange({
            metadata: null,
            issues: { errors: [], warnings: [] },
            validatingCSV: true,
          })
        }
      />
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
      <button
        data-testid="csv-with-errors"
        onClick={() =>
          props.onMetadataChange({
            metadata: { headers: [], rows: [] },
            issues: {
              errors: ["Row 1 is missing a sample name"],
              warnings: [],
            },
            validatingCSV: false,
          })
        }
      />
    </div>
  ),
}));

jest.mock("~/components/common/Metadata/MetadataCSVLocationsMenu", () => ({
  __esModule: true,
  default: (props: any) => (
    <div data-testid="locations-menu-stub">
      {`locationField:${props.locationMetadataType?.key ?? "none"}`}
      <button
        data-testid="locations-change"
        onClick={() =>
          props.onMetadataChange({ metadata: { headers: [], rows: [] } })
        }
      />
    </div>
  ),
}));

const mockedFields = getProjectMetadataFields as jest.MockedFunction<any>;
const mockedHostGenomes = getAllHostGenomes as jest.MockedFunction<any>;
const mockedSampleTypes = getAllSampleTypes as jest.MockedFunction<any>;
const mockedGeosearch = geosearchCSVLocations as jest.MockedFunction<any>;
const mockedDownload =
  generateClientDownloadFromEndpoint as jest.MockedFunction<any>;

// Deliberately NOT in `ordering` order -- the component sorts by its own
// affinity ordering and drops fields unavailable for the active workflow.
const PROJECT_FIELDS = [
  { key: "comorbidity", name: "Comorbidity", dataType: "string" },
  { key: "ct_value", name: "Ct Value", dataType: "number" },
  {
    key: "collection_location_v2",
    name: "Collection Location",
    dataType: "location",
    is_required: 1,
  },
  { key: "sample_type", name: "Sample Type", dataType: "string" },
];

const HOST_GENOMES = [
  { id: 1, name: "Human", ercc_only: false, showAsOption: true },
  { id: 2, name: "Mosquito", ercc_only: false, showAsOption: true },
  { id: 3, name: "ERCC only", ercc_only: true, showAsOption: true },
  { id: 4, name: "Hidden", ercc_only: false, showAsOption: false },
];

const renderUpload = (props: Record<string, unknown> = {}) =>
  render(
    <MetadataUpload
      project={{ id: 5, name: "Malaria Study" } as any}
      samples={[{ name: "sample_one" }] as any}
      onMetadataChange={jest.fn()}
      onShowCSVInstructions={jest.fn()}
      workflows={new Set([WorkflowType.SHORT_READ_MNGS])}
      samplesAreNew
      visible
      {...(props as any)}
    />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockedFields.mockResolvedValue(PROJECT_FIELDS);
  mockedHostGenomes.mockResolvedValue(HOST_GENOMES);
  mockedSampleTypes.mockResolvedValue([{ name: "CSF" }]);
  mockedGeosearch.mockResolvedValue({ headers: ["loc"], rows: [] });
});

describe("MetadataUpload -- project metadata field loading", () => {
  it("shows a loading placeholder until the project fields resolve", async () => {
    renderUpload();
    expect(screen.getByText("Loading...")).toBeTruthy();
    await screen.findByTestId("manual-input-stub");
  });

  it("orders fields by upload affinity and drops workflow-unavailable fields", async () => {
    renderUpload({ workflows: new Set([WorkflowType.SHORT_READ_MNGS]) });
    const stub = await screen.findByTestId("manual-input-stub");
    // ct_value is unavailable for mNGS, and sample_type (ordering 2) sorts
    // ahead of the unranked comorbidity.
    expect(stub.textContent).toContain(
      "fields:sample_type,collection_location_v2,comorbidity",
    );
    expect(stub.textContent).not.toContain("ct_value");
  });

  it("keeps ct_value for a workflow that does not exclude it", async () => {
    renderUpload({ workflows: new Set([WorkflowType.CONSENSUS_GENOME]) });
    const stub = await screen.findByTestId("manual-input-stub");
    expect(stub.textContent).toContain("ct_value");
  });

  it("re-fetches the fields when the project changes", async () => {
    const { rerender } = renderUpload();
    await screen.findByTestId("manual-input-stub");
    expect(mockedFields).toHaveBeenCalledTimes(1);
    expect(mockedFields).toHaveBeenCalledWith(5);

    mockedFields.mockResolvedValue([
      { key: "sample_type", name: "Sample Type", dataType: "string" },
    ]);
    rerender(
      <MetadataUpload
        project={{ id: 6, name: "Other Study" } as any}
        samples={[{ name: "sample_one" }] as any}
        onMetadataChange={jest.fn()}
        onShowCSVInstructions={jest.fn()}
        workflows={new Set([WorkflowType.SHORT_READ_MNGS])}
        samplesAreNew
        visible
      />,
    );

    await waitFor(() => expect(mockedFields).toHaveBeenCalledTimes(2));
    expect(mockedFields).toHaveBeenLastCalledWith(6);
    const stub = await screen.findByTestId("manual-input-stub");
    expect(stub.textContent).toContain("fields:sample_type");
  });

  it("re-filters (without re-fetching) when only the workflow changes", async () => {
    const commonProps = {
      project: { id: 5, name: "Malaria Study" } as any,
      samples: [{ name: "sample_one" }] as any,
      onMetadataChange: jest.fn(),
      onShowCSVInstructions: jest.fn(),
      samplesAreNew: true,
      visible: true,
    };
    const { rerender } = render(
      <MetadataUpload
        {...commonProps}
        workflows={new Set([WorkflowType.SHORT_READ_MNGS])}
      />,
    );
    await screen.findByTestId("manual-input-stub");
    expect(mockedFields).toHaveBeenCalledTimes(1);

    rerender(
      <MetadataUpload
        {...commonProps}
        workflows={new Set([WorkflowType.CONSENSUS_GENOME])}
      />,
    );

    await waitFor(() =>
      expect(screen.getByTestId("manual-input-stub").textContent).toContain(
        "ct_value",
      ),
    );
    // No second network round-trip: the already-fetched fields were re-filtered.
    expect(mockedFields).toHaveBeenCalledTimes(1);
  });
});

describe("MetadataUpload -- header copy", () => {
  it("lists the required fields and the selectable host organisms for new samples", async () => {
    const { container } = renderUpload();
    await screen.findByTestId("manual-input-stub");
    // "Host Organism" is always required, plus the is_required project fields.
    expect(container.textContent).toContain(
      "Host Organism, Collection Location",
    );
    // ercc_only and showAsOption=false genomes are filtered out of the list.
    expect(container.textContent).toContain("Human, Mosquito");
    expect(container.textContent).not.toContain("ERCC only");
    expect(container.textContent).not.toContain("Hidden");
    expect(screen.getByText("View Full Metadata Dictionary")).toBeTruthy();
  });

  it("says 'Human only' for consensus genome uploads", async () => {
    const { container } = renderUpload({
      workflows: new Set([WorkflowType.CONSENSUS_GENOME]),
    });
    await screen.findByTestId("manual-input-stub");
    expect(container.textContent).toContain("Human only");
    expect(container.textContent).not.toContain("Mosquito");
  });

  it("shows the short dictionary link (and no requirements blurb) for existing samples", async () => {
    const { container } = renderUpload({ samplesAreNew: false });
    await screen.findByTestId("manual-input-stub");
    expect(screen.getByText("View Metadata Dictionary")).toBeTruthy();
    expect(container.textContent).not.toContain(
      "We require the following metadata",
    );
  });
});

describe("MetadataUpload -- tab switching", () => {
  it("resets metadata state and reports wasManual per tab", async () => {
    const onMetadataChange = jest.fn();
    renderUpload({ onMetadataChange });
    await screen.findByTestId("manual-input-stub");

    fireEvent.click(screen.getByTestId("csv-upload"));
    expect(onMetadataChange).toHaveBeenLastCalledWith({
      metadata: null,
      issues: null,
      wasManual: false,
    });
    expect(screen.getByTestId("csv-upload-stub")).toBeTruthy();
    expect(screen.queryByTestId("manual-input-stub")).toBeNull();

    fireEvent.click(screen.getByTestId("manual-input"));
    expect(onMetadataChange).toHaveBeenLastCalledWith({
      metadata: null,
      issues: null,
      wasManual: true,
    });
    expect(screen.getByTestId("manual-input-stub")).toBeTruthy();
  });
});

describe("MetadataUpload -- CSV tab handoff", () => {
  const openCsvTab = async () => {
    await screen.findByTestId("manual-input-stub");
    fireEvent.click(screen.getByTestId("csv-upload"));
    await screen.findByTestId("csv-upload-stub");
  };

  it("shows the validating message and hides the locations menu while validating", async () => {
    renderUpload();
    await openCsvTab();

    fireEvent.click(screen.getByTestId("csv-validating"));

    expect(screen.getByText("Validating metadata...")).toBeTruthy();
    expect(screen.queryByTestId("locations-menu-stub")).toBeNull();
    // No geosearch is kicked off while the CSV is still being validated.
    expect(mockedGeosearch).not.toHaveBeenCalled();
  });

  it("geosearches locations for a clean CSV and then reveals the locations menu", async () => {
    const onMetadataChange = jest.fn();
    renderUpload({ onMetadataChange });
    await openCsvTab();

    fireEvent.click(screen.getByTestId("csv-clean"));

    await waitFor(() => expect(mockedGeosearch).toHaveBeenCalledTimes(1));
    // The required location MetadataField is what gets geosearched.
    expect(mockedGeosearch.mock.calls[0][1]).toMatchObject({
      key: "collection_location_v2",
    });
    const menu = await screen.findByTestId("locations-menu-stub");
    expect(menu.textContent).toContain("locationField:collection_location_v2");
    expect(onMetadataChange).toHaveBeenLastCalledWith({
      metadata: { headers: ["loc"], rows: [] },
      wasManual: true,
      issues: null,
    });
  });

  it("skips the geosearch when the CSV has errors and renders those errors", async () => {
    renderUpload();
    await openCsvTab();

    fireEvent.click(screen.getByTestId("csv-with-errors"));

    expect(mockedGeosearch).not.toHaveBeenCalled();
    expect(screen.getByText("Fix the following errors.")).toBeTruthy();
    expect(screen.getByText("Row 1 is missing a sample name")).toBeTruthy();
  });

  it("leaves locations as plain text (and logs) when the geosearch fails", async () => {
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockedGeosearch.mockRejectedValue(new Error("geosearch down"));
    renderUpload();
    await openCsvTab();

    fireEvent.click(screen.getByTestId("csv-clean"));

    await waitFor(() => expect(consoleError).toHaveBeenCalled());
    // The menu is never revealed, so the user keeps their plain-text values.
    expect(screen.queryByTestId("locations-menu-stub")).toBeNull();
    consoleError.mockRestore();
  });

  it("downloads the metadata template CSV with the new sample names", async () => {
    renderUpload();
    await openCsvTab();

    fireEvent.click(screen.getByText("Download Metadata CSV Template"));

    expect(mockedDownload).toHaveBeenCalledWith({
      endpoint: "/metadata/metadata_template_csv",
      params: { new_sample_names: ["sample_one"], project_id: 5 },
      fileName: "metadata_template.csv",
      fileType: "text/csv",
    });
  });

  it("omits the sample names from the template request for existing samples", async () => {
    renderUpload({ samplesAreNew: false });
    await openCsvTab();

    fireEvent.click(screen.getByText("Download Metadata CSV Template"));

    expect(mockedDownload.mock.calls[0][0].params).toEqual({ project_id: 5 });
  });
});

describe("MetadataUpload -- change propagation", () => {
  it("marks the step dirty and reports manual metadata changes", async () => {
    const onDirty = jest.fn();
    const onMetadataChange = jest.fn();
    renderUpload({ onDirty, onMetadataChange });
    await screen.findByTestId("manual-input-stub");

    fireEvent.click(screen.getByTestId("manual-change"));

    expect(onDirty).toHaveBeenCalledTimes(1);
    expect(onMetadataChange).toHaveBeenLastCalledWith({
      metadata: { headers: ["a"], rows: [] },
      wasManual: true,
    });
  });

  it("still reports manual changes when no onDirty handler was supplied", async () => {
    const onMetadataChange = jest.fn();
    renderUpload({ onDirty: undefined, onMetadataChange });
    await screen.findByTestId("manual-input-stub");

    fireEvent.click(screen.getByTestId("manual-change"));

    expect(onMetadataChange).toHaveBeenLastCalledWith({
      metadata: { headers: ["a"], rows: [] },
      wasManual: true,
    });
  });

  it("marks the step dirty when a location is picked in the locations menu", async () => {
    const onDirty = jest.fn();
    const onMetadataChange = jest.fn();
    renderUpload({ onDirty, onMetadataChange });
    await screen.findByTestId("manual-input-stub");
    fireEvent.click(screen.getByTestId("csv-upload"));
    fireEvent.click(screen.getByTestId("csv-clean"));
    await screen.findByTestId("locations-menu-stub");

    fireEvent.click(screen.getByTestId("locations-change"));

    expect(onDirty).toHaveBeenCalled();
    expect(onMetadataChange).toHaveBeenLastCalledWith({
      metadata: { headers: [], rows: [] },
      wasManual: true,
    });
  });
});

describe("MetadataUpload -- issue rendering", () => {
  it("renders nothing when there are no issues", async () => {
    const { container } = renderUpload({
      issues: { errors: [], warnings: [] },
    });
    await screen.findByTestId("manual-input-stub");
    expect(container.textContent).not.toContain("Fix the following errors.");
    expect(container.textContent).not.toContain("Warnings");
  });

  it("renders plain-string errors and warnings from props", async () => {
    renderUpload({
      issues: {
        errors: ["Missing collection date"],
        warnings: ["Location was made less precise"],
      },
    });
    await screen.findByTestId("manual-input-stub");

    expect(screen.getByText("Fix the following errors.")).toBeTruthy();
    expect(screen.getByText("Missing collection date")).toBeTruthy();
    expect(screen.getByText("Warnings")).toBeTruthy();
    expect(screen.getByText("Location was made less precise")).toBeTruthy();
  });

  it("renders grouped issues as a collapsed accordion that expands to a table", async () => {
    renderUpload({
      issues: {
        errors: [
          {
            isGroup: true,
            caption: "2 samples have invalid host organisms",
            headers: ["Sample Name", "Host Organism"],
            rows: [["sample_one", "Martian"]],
          },
        ],
        warnings: [],
      },
    });
    await screen.findByTestId("manual-input-stub");

    const caption = screen.getByText("2 samples have invalid host organisms");
    expect(caption).toBeTruthy();
    // The offending rows live behind the (initially collapsed) accordion.
    expect(screen.queryByText("Martian")).toBeNull();

    fireEvent.click(caption);
    expect(screen.getByText("Martian")).toBeTruthy();
    expect(screen.getByText("sample_one")).toBeTruthy();
  });

  it("shows the location-specific error headline once the locations menu is up", async () => {
    renderUpload({
      issues: { errors: ["Pick a valid location"], warnings: [] },
    });
    await screen.findByTestId("manual-input-stub");
    fireEvent.click(screen.getByTestId("csv-upload"));
    fireEvent.click(screen.getByTestId("csv-clean"));
    await screen.findByTestId("locations-menu-stub");

    expect(
      screen.getByText("Fix these errors with your location selections."),
    ).toBeTruthy();
  });

  it("shows only warnings when there are no errors", async () => {
    const { container } = renderUpload({
      issues: { errors: [], warnings: ["Heads up"] },
    });
    await screen.findByTestId("manual-input-stub");

    expect(screen.getByText("Warnings")).toBeTruthy();
    expect(screen.getByText("Heads up")).toBeTruthy();
    expect(container.textContent).not.toContain("Fix the following errors.");
  });
});
