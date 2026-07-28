// Coverage: app/assets/src/components/common/Metadata/MetadataManualInput.tsx
//
// MetadataManualInput builds the per-sample metadata grid used by the upload
// flow. The two leaf inputs (MetadataInput, HostOrganismSearchBox) are replaced
// with minimal stubs so the tests can drive the component's own logic --
// column selection, per-cell edits, "Apply to All", auto-populate, host-genome
// validity and the CSV-shaped payload pushed to the parent -- without dragging
// in the SDS dropdown/geosearch stack.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("~/components/common/Metadata/MetadataInput", () => ({
  __esModule: true,
  default: ({ metadataType, value, onChange }: $TSFixMe) => (
    <input
      data-testid={`metadata-input-${metadataType.key}`}
      value={value === undefined || value === null ? "" : String(value)}
      onChange={e => onChange(metadataType.key, e.target.value)}
    />
  ),
}));

jest.mock("~/components/common/HostOrganismSearchBox", () => ({
  __esModule: true,
  default: ({ value, onResultSelect }: $TSFixMe) => (
    <button
      data-testid="host-organism-box"
      onClick={() => onResultSelect({ result: { id: 2, name: "Mosquito" } })}
    >
      {value || "unset"}
    </button>
  ),
}));

import MetadataManualInput from "~/components/common/Metadata/MetadataManualInput";
import { UserContext } from "~/components/common/UserContext";

const HUMAN = {
  id: 1,
  name: "Human",
  samples_count: 100,
  taxa_category: "human",
};
const MOSQUITO = {
  id: 2,
  name: "Mosquito",
  samples_count: 5,
  taxa_category: "insect",
};

const projectMetadataFields = {
  sample_type: {
    key: "sample_type",
    name: "Sample Type",
    dataType: "string",
    is_required: 1,
    host_genome_ids: [1, 2],
  },
  collection_date: {
    key: "collection_date",
    name: "Collection Date",
    dataType: "date",
    is_required: 1,
    host_genome_ids: [1, 2],
  },
  // Optional, and only valid for the Human host genome.
  host_age: {
    key: "host_age",
    name: "Host Age",
    dataType: "number",
    is_required: 0,
    host_genome_ids: [1],
  },
};

const sampleA = { name: "Sample A", host_genome_id: 1, metadata: {} };
const sampleB = { name: "Sample B", host_genome_id: 2, metadata: {} };

const defaultProps = {
  samples: [sampleA, sampleB],
  projectMetadataFields,
  hostGenomes: [HUMAN, MOSQUITO],
  sampleTypes: [],
  samplesAreNew: true,
};

const renderInput = (props: Record<string, unknown> = {}, admin = false) => {
  const onMetadataChange = jest.fn();
  const utils = render(
    <UserContext.Provider
      value={
        {
          admin,
          allowedFeatures: [],
          appConfig: {},
          userSignedIn: true,
        } as $TSFixMe
      }
    >
      <MetadataManualInput
        {...(defaultProps as $TSFixMe)}
        onMetadataChange={onMetadataChange}
        {...(props as $TSFixMe)}
      />
    </UserContext.Provider>,
  );
  return { ...utils, onMetadataChange };
};

const lastPayload = (onMetadataChange: jest.Mock) =>
  onMetadataChange.mock.calls[onMetadataChange.mock.calls.length - 1][0]
    .metadata;

describe("MetadataManualInput", () => {
  it("renders one column per required field plus sample name and host organism", () => {
    renderInput();
    const headers = Array.from(document.querySelectorAll("th")).map(
      th => th.textContent,
    );
    expect(headers).toEqual([
      "Sample Name",
      "Host Organism",
      "Sample Type",
      "Collection Date",
    ]);
    // Optional fields are not selected by default.
    expect(headers).not.toContain("Host Age");
  });

  it("renders a row per sample with the sample name and an input per field", () => {
    renderInput();
    expect(screen.getByText("Sample A")).toBeTruthy();
    expect(screen.getByText("Sample B")).toBeTruthy();
    expect(screen.getAllByTestId("metadata-input-sample_type")).toHaveLength(2);
    expect(
      screen.getAllByTestId("metadata-input-collection_date"),
    ).toHaveLength(2);
    expect(screen.getAllByTestId("host-organism-box")).toHaveLength(2);
  });

  it("omits the host organism column when the samples already exist", () => {
    renderInput({ samplesAreNew: false });
    const headers = Array.from(document.querySelectorAll("th")).map(
      th => th.textContent,
    );
    expect(headers).toEqual(["Sample Name", "Sample Type", "Collection Date"]);
    expect(screen.queryByTestId("host-organism-box")).toBeNull();
  });

  it("pushes a CSV-shaped payload to the parent when a cell is edited", () => {
    const { onMetadataChange } = renderInput();
    const inputs = screen.getAllByTestId("metadata-input-sample_type");
    fireEvent.change(inputs[0], { target: { value: "CSF" } });

    const metadata = lastPayload(onMetadataChange);
    expect(metadata.headers).toEqual(["sample_name", "sample_type"]);
    expect(metadata.rows).toEqual([
      { sample_name: "Sample A", sample_type: "CSF" },
      { sample_name: "Sample B" },
    ]);
  });

  it("keeps prior edits when a second field is edited", () => {
    const { onMetadataChange } = renderInput();
    fireEvent.change(screen.getAllByTestId("metadata-input-sample_type")[0], {
      target: { value: "CSF" },
    });
    fireEvent.change(
      screen.getAllByTestId("metadata-input-collection_date")[0],
      { target: { value: "2024-05" } },
    );

    const metadata = lastPayload(onMetadataChange);
    expect(metadata.headers).toEqual([
      "sample_name",
      "sample_type",
      "collection_date",
    ]);
    expect(metadata.rows[0]).toEqual({
      sample_name: "Sample A",
      sample_type: "CSF",
      collection_date: "2024-05",
    });
  });

  it("shows 'Apply to All' on the edited cell and copies the value to every sample", () => {
    const { onMetadataChange } = renderInput();
    expect(screen.queryByText("Apply to All")).toBeNull();

    fireEvent.change(screen.getAllByTestId("metadata-input-sample_type")[0], {
      target: { value: "CSF" },
    });
    // The button only appears on the cell that was just edited.
    expect(screen.getAllByText("Apply to All")).toHaveLength(1);

    fireEvent.click(screen.getByText("Apply to All"));

    const metadata = lastPayload(onMetadataChange);
    expect(metadata.rows).toEqual([
      { sample_name: "Sample A", sample_type: "CSF" },
      { sample_name: "Sample B", sample_type: "CSF" },
    ]);
    // Applying clears the per-cell button.
    expect(screen.queryByText("Apply to All")).toBeNull();
  });

  it("does not offer 'Apply to All' when there is only one sample", () => {
    renderInput({ samples: [sampleA] });
    fireEvent.change(screen.getAllByTestId("metadata-input-sample_type")[0], {
      target: { value: "CSF" },
    });
    expect(screen.queryByText("Apply to All")).toBeNull();
  });

  it("renders an input for a required field on every sample, whatever its host genome", () => {
    // host_age is limited to host genome 1, but a *required* field is always
    // considered valid -- so both samples still get an input.
    renderInput({
      samplesAreNew: false,
      projectMetadataFields: {
        ...projectMetadataFields,
        host_age: { ...projectMetadataFields.host_age, is_required: 1 },
      },
    });

    expect(screen.getAllByTestId("metadata-input-host_age")).toHaveLength(2);
    expect(screen.queryByText("--")).toBeNull();
  });

  it("renders '--' for an optional field that the sample's host genome does not support", () => {
    renderInput({ samplesAreNew: false });
    // Add the optional, human-only host_age column via the column picker.
    fireEvent.click(screen.getAllByTestId("select-columns")[0]);
    fireEvent.click(screen.getByText("Host Age"));

    // Sample A is human -> input; Sample B is a mosquito -> placeholder.
    expect(screen.getAllByTestId("metadata-input-host_age")).toHaveLength(1);
    expect(screen.getAllByText("--")).toHaveLength(1);
  });

  it("converts a selected host genome id to its name", () => {
    const { onMetadataChange } = renderInput();
    fireEvent.click(screen.getAllByTestId("host-organism-box")[0]);

    const metadata = lastPayload(onMetadataChange);
    expect(metadata.headers).toEqual(["sample_name", "Host Organism"]);
    expect(metadata.rows[0]).toEqual({
      sample_name: "Sample A",
      "Host Organism": "Mosquito",
    });
  });

  it("defaults water_control to No for new samples", () => {
    const { onMetadataChange } = renderInput({
      projectMetadataFields: {
        ...projectMetadataFields,
        water_control: {
          key: "water_control",
          name: "Water Control",
          dataType: "string",
          is_required: 0,
          host_genome_ids: [1, 2],
        },
      },
    });

    const metadata = lastPayload(onMetadataChange);
    expect(metadata.headers).toEqual(["sample_name", "water_control"]);
    expect(metadata.rows).toEqual([
      { sample_name: "Sample A", water_control: "No" },
      { sample_name: "Sample B", water_control: "No" },
    ]);
  });

  it("hides the admin auto-populate button from non-admins", () => {
    renderInput();
    expect(screen.queryByText(/Auto-populate metadata/)).toBeNull();
  });

  it("hides the admin auto-populate button when the samples are not new", () => {
    renderInput({ samplesAreNew: false }, true);
    expect(screen.queryByText(/Auto-populate metadata/)).toBeNull();
  });

  it("auto-populates every sample when an admin clicks the button", () => {
    const { onMetadataChange } = renderInput({}, true);
    fireEvent.click(screen.getByText(/Auto-populate metadata/));

    const metadata = lastPayload(onMetadataChange);
    expect(metadata.headers).toEqual(
      expect.arrayContaining([
        "sample_name",
        "Host Organism",
        "sample_type",
        "collection_date",
        "collection_location_v2",
        "nucleotide_type",
      ]),
    );
    expect(metadata.rows).toHaveLength(2);
    metadata.rows.forEach((row: Record<string, string>) => {
      expect(row.sample_type).toBe("CSF");
      expect(row["Host Organism"]).toBe("Human");
      expect(row.collection_date).toBe("2020-05");
    });
  });

  it("re-syncs the metadata with the parent when the sample list changes", () => {
    const onMetadataChange = jest.fn();
    const { rerender } = render(
      <MetadataManualInput
        {...(defaultProps as $TSFixMe)}
        samplesAreNew={false}
        onMetadataChange={onMetadataChange}
      />,
    );
    onMetadataChange.mockClear();

    rerender(
      <MetadataManualInput
        {...(defaultProps as $TSFixMe)}
        samplesAreNew={false}
        samples={[sampleA]}
        onMetadataChange={onMetadataChange}
      />,
    );

    expect(onMetadataChange).toHaveBeenCalled();
    // Existing samples with no edits are dropped from the payload entirely.
    expect(lastPayload(onMetadataChange).rows).toEqual([]);
  });

  it("keeps empty rows for new samples so validation can report them", () => {
    const onMetadataChange = jest.fn();
    const { rerender } = render(
      <MetadataManualInput
        {...(defaultProps as $TSFixMe)}
        onMetadataChange={onMetadataChange}
      />,
    );
    onMetadataChange.mockClear();

    rerender(
      <MetadataManualInput
        {...(defaultProps as $TSFixMe)}
        samples={[sampleA]}
        onMetadataChange={onMetadataChange}
      />,
    );

    expect(lastPayload(onMetadataChange).rows).toEqual([
      { sample_name: "Sample A" },
    ]);
  });

  it("re-derives the columns when the project metadata fields change", () => {
    const onMetadataChange = jest.fn();
    const { rerender } = render(
      <MetadataManualInput
        {...(defaultProps as $TSFixMe)}
        onMetadataChange={onMetadataChange}
      />,
    );
    expect(
      Array.from(document.querySelectorAll("th")).map(th => th.textContent),
    ).toContain("Collection Date");

    rerender(
      <MetadataManualInput
        {...(defaultProps as $TSFixMe)}
        projectMetadataFields={{
          sample_type: projectMetadataFields.sample_type,
        }}
        onMetadataChange={onMetadataChange}
      />,
    );

    const headers = Array.from(document.querySelectorAll("th")).map(
      th => th.textContent,
    );
    expect(headers).toEqual(["Sample Name", "Host Organism", "Sample Type"]);
  });

  it("shows the pre-existing server value for a sample when it has not been edited", () => {
    renderInput({
      samplesAreNew: false,
      samples: [
        { ...sampleA, metadata: { sample_type: "Serum" } },
        { ...sampleB, metadata: {} },
      ],
    });
    const inputs = screen.getAllByTestId(
      "metadata-input-sample_type",
    ) as HTMLInputElement[];
    expect(inputs[0].value).toBe("Serum");
    expect(inputs[1].value).toBe("");
  });
});
