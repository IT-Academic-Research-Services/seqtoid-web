// Coverage:
// app/assets/src/components/common/Metadata/MetadataCSVLocationsMenu.tsx
//
// MetadataCSVLocationsMenu confirms auto-matched collection locations. It bails
// to null without metadata rows, otherwise builds one MetadataInput per row and
// wires two mutation paths: editing a cell (onChange -> onMetadataChange, and
// marks that row for an "Apply to All" button when there is more than one row)
// and clicking "Apply to All" (copies the marked sample's value into every row
// via processLocationSelection, keyed by isRowHuman). The location control,
// IssueGroup and MetadataInput are stubbed so the assertions land on this menu's
// own logic.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import MetadataCSVLocationsMenu from "~/components/common/Metadata/MetadataCSVLocationsMenu";
import { processLocationSelection } from "~/components/ui/controls/GeoSearchInputBox";

const _React: typeof React = React;

jest.mock("~/components/ui/controls/GeoSearchInputBox", () => ({
  processLocationSelection: jest.fn(
    (value: $TSFixMe, isHuman: boolean) =>
      `${value}${isHuman ? "-human" : "-nonhuman"}`,
  ),
}));

// IssueGroup renders a header/caption plus a grid of cell arrays; reproduce
// enough of that so the rows (which contain our MetadataInputs) reach the DOM.
jest.mock("~ui/notifications/IssueGroup", () => ({
  __esModule: true,
  default: ({ caption, headers, rows }: $TSFixMe) => (
    <div data-testid="issue-group">
      <div data-testid="caption">{caption}</div>
      <div data-testid="headers">{headers.join(",")}</div>
      {rows.map((cells: $TSFixMe[], i: number) => (
        <div data-testid={`row-${i}`} key={i}>
          {cells}
        </div>
      ))}
    </div>
  ),
}));

// MetadataInput here is a plain text box that surfaces its current value and
// forwards edits through the onChange contract (_, value) the menu expects.
jest.mock("~/components/common/Metadata/MetadataInput", () => ({
  __esModule: true,
  default: ({ value, onChange }: $TSFixMe) => (
    <input
      data-testid="metadata-input"
      value={value ?? ""}
      onChange={e => onChange(null, e.target.value)}
    />
  ),
}));

const mockedProcess = processLocationSelection as jest.MockedFunction<
  typeof processLocationSelection
>;

const locationMetadataType = {
  dataType: "location",
  key: "collection_location_v2",
  name: "Collection Location",
};

const hostGenomes = [
  { name: "Human", taxa_category: "human" },
  { name: "Mosquito", taxa_category: "non_human" },
] as $TSFixMe;

const makeMetadata = () => ({
  headers: ["Sample Name", "Collection Location"],
  rows: [
    {
      "Sample Name": "sample_a",
      "Host Organism": "Human",
      "Collection Location": "San Francisco, USA",
    },
    {
      "Sample Name": "sample_b",
      "Host Organism": "Mosquito",
      "Collection Location": "Nairobi, Kenya",
    },
  ],
});

const renderMenu = (overrides: $TSFixMe = {}) => {
  const props = {
    metadata: makeMetadata(),
    locationMetadataType,
    hostGenomes,
    onMetadataChange: jest.fn(),
    ...overrides,
  };
  return { ...render(<MetadataCSVLocationsMenu {...props} />), props };
};

describe("MetadataCSVLocationsMenu", () => {
  beforeEach(() => jest.clearAllMocks());

  it("renders nothing when metadata has no rows", () => {
    const { container } = render(
      <MetadataCSVLocationsMenu
        metadata={undefined as $TSFixMe}
        locationMetadataType={locationMetadataType}
        hostGenomes={hostGenomes}
        onMetadataChange={jest.fn()}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders the title and one input per row", () => {
    renderMenu();
    expect(screen.getByText("Confirm Your Collection Locations")).toBeTruthy();
    expect(screen.getByTestId("headers").textContent).toBe(
      "Sample Name,Collection Location",
    );
    expect(screen.getAllByTestId("metadata-input").length).toBe(2);
    // No cell has been edited yet, so no Apply to All button is present.
    expect(screen.queryByText("Apply to All")).toBeNull();
  });

  it("editing a cell notifies the parent and reveals Apply to All", () => {
    const { props } = renderMenu();
    const firstInput = screen.getAllByTestId("metadata-input")[0];

    fireEvent.change(firstInput, { target: { value: "Berlin, Germany" } });

    expect(props.onMetadataChange).toHaveBeenCalledTimes(1);
    // The edited value is written into that row's location field.
    const passed = props.onMetadataChange.mock.calls[0][0].metadata;
    expect(passed.rows[0]["Collection Location"]).toBe("Berlin, Germany");
    // With >1 row and this sample marked, the Apply to All button shows up.
    expect(screen.getByText("Apply to All")).toBeTruthy();
  });

  it("Apply to All copies the marked sample's value into every row", () => {
    const { props } = renderMenu();
    const inputs = screen.getAllByTestId("metadata-input");

    // Mark sample_a and give it a new value.
    fireEvent.change(inputs[0], { target: { value: "Tokyo, Japan" } });
    fireEvent.click(screen.getByText("Apply to All"));

    // processLocationSelection runs once per row, keyed by human-ness.
    expect(mockedProcess).toHaveBeenCalledTimes(2);
    expect(mockedProcess).toHaveBeenCalledWith("Tokyo, Japan", true); // human row
    // isRowHuman yields a falsy `undefined` (no Host Genome) for the non-human
    // mosquito row, so processLocationSelection is called with the non-human arg.
    expect(mockedProcess).toHaveBeenCalledWith("Tokyo, Japan", undefined);

    // Last onMetadataChange carries the processed values for both rows.
    const calls = props.onMetadataChange.mock.calls;
    const finalMeta = calls[calls.length - 1][0].metadata;
    expect(finalMeta.rows[0]["Collection Location"]).toBe("Tokyo, Japan-human");
    expect(finalMeta.rows[1]["Collection Location"]).toBe(
      "Tokyo, Japan-nonhuman",
    );
    // Applying clears the marker, hiding the button again.
    expect(screen.queryByText("Apply to All")).toBeNull();
  });

  it("does not offer Apply to All when there is only a single row", () => {
    const single = {
      headers: ["Sample Name", "Collection Location"],
      rows: [
        {
          "Sample Name": "only_sample",
          "Host Organism": "Human",
          "Collection Location": "Lima, Peru",
        },
      ],
    };
    renderMenu({ metadata: single });

    fireEvent.change(screen.getAllByTestId("metadata-input")[0], {
      target: { value: "Cusco, Peru" },
    });
    // metadata.rows.length > 1 is false -> no Apply to All even after an edit.
    expect(screen.queryByText("Apply to All")).toBeNull();
  });
});
