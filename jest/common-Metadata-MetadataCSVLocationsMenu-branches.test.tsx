// Branch coverage for
// app/assets/src/components/common/Metadata/MetadataCSVLocationsMenu.tsx
//
// The main spec drives well-formed CSV metadata, which leaves three conditionals
// unexercised:
//
//   * `(find({ [NAME_COLUMN]: sample }, metadata.rows) || {})` -- the `|| {}`
//     fallback when no row matches the sample that "Apply to All" was marked for
//   * `row["Host Organism"] || row["Host Genome"]` -- the second operand, used by
//     CSVs that carry the legacy "Host Genome" column instead
//   * `getColumnWidth={column => column === NAME_COLUMN && 240}` -- never invoked,
//     because the real IssueGroup is stubbed out
import { fireEvent, render, screen } from "@testing-library/react";
import MetadataCSVLocationsMenu from "~/components/common/Metadata/MetadataCSVLocationsMenu";
import { processLocationSelection } from "~/components/ui/controls/GeoSearchInputBox";

jest.mock("~/components/ui/controls/GeoSearchInputBox", () => ({
  processLocationSelection: jest.fn(
    (value: $TSFixMe, isHuman: boolean) =>
      `${value}${isHuman ? "-human" : "-nonhuman"}`,
  ),
}));

// Capture IssueGroup's props so the getColumnWidth callback can be called
// directly -- the real IssueGroup is what would normally invoke it.
let mockIssueGroupProps: $TSFixMe = null;
jest.mock("~ui/notifications/IssueGroup", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockIssueGroupProps = props;
    return (
      <div data-testid="issue-group">
        {props.rows.map((cells: $TSFixMe[], i: number) => (
          <div data-testid={`row-${i}`} key={i}>
            {cells}
          </div>
        ))}
      </div>
    );
  },
}));

// Surface taxaCategory so the host-genome lookup can be asserted on.
jest.mock("~/components/common/Metadata/MetadataInput", () => ({
  __esModule: true,
  default: ({ value, onChange, taxaCategory }: $TSFixMe) => (
    <input
      data-testid="metadata-input"
      data-taxa-category={taxaCategory ?? ""}
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

const renderMenu = (metadata: $TSFixMe) => {
  const props = {
    metadata,
    locationMetadataType,
    hostGenomes,
    onMetadataChange: jest.fn(),
  } as $TSFixMe;
  return { ...render(<MetadataCSVLocationsMenu {...props} />), props };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockIssueGroupProps = null;
});

describe("MetadataCSVLocationsMenu column sizing", () => {
  it("widens only the sample-name column", () => {
    renderMenu({
      headers: ["Sample Name", "Collection Location"],
      rows: [
        {
          "Sample Name": "sample_a",
          "Host Organism": "Human",
          "Collection Location": "Lima, Peru",
        },
      ],
    });

    expect(mockIssueGroupProps.getColumnWidth("Sample Name")).toBe(240);
    // Any other column falls through to the falsy left-hand side.
    expect(mockIssueGroupProps.getColumnWidth("Collection Location")).toBe(
      false,
    );
  });
});

describe("MetadataCSVLocationsMenu host genome lookup", () => {
  it("falls back to the legacy Host Genome column", () => {
    renderMenu({
      headers: ["Sample Name", "Collection Location"],
      rows: [
        {
          "Sample Name": "legacy_row",
          // No "Host Organism" key at all -- older CSVs used "Host Genome".
          "Host Genome": "Mosquito",
          "Collection Location": "Nairobi, Kenya",
        },
      ],
    });

    expect(
      screen.getByTestId("metadata-input").getAttribute("data-taxa-category"),
    ).toBe("non_human");
  });

  it("passes no taxa category when neither host column matches a genome", () => {
    renderMenu({
      headers: ["Sample Name", "Collection Location"],
      rows: [
        {
          "Sample Name": "unknown_host",
          "Host Genome": "Tardigrade",
          "Collection Location": "Nairobi, Kenya",
        },
      ],
    });

    expect(
      screen.getByTestId("metadata-input").getAttribute("data-taxa-category"),
    ).toBe("");
  });
});

describe("MetadataCSVLocationsMenu Apply to All with an unmatched sample", () => {
  it("applies an empty value when no row matches the marked sample", () => {
    // Rows without a Sample Name column: the marked "sample" is undefined, so
    // the lookup finds nothing and the `|| {}` fallback supplies the value.
    const { props } = renderMenu({
      headers: ["Collection Location"],
      rows: [
        {
          "Host Organism": "Mosquito",
          "Collection Location": "Nairobi, Kenya",
        },
        { "Host Organism": "Mosquito", "Collection Location": "Lima, Peru" },
      ],
    });

    const inputs = screen.getAllByTestId("metadata-input");
    fireEvent.change(inputs[0], { target: { value: "Tokyo, Japan" } });

    // With >1 row and the (undefined) sample marked, Apply to All is offered.
    // Every row carries the same undefined name, so each one shows the button.
    const applyButtons = screen.getAllByText("Apply to All");
    expect(applyButtons).toHaveLength(2);
    fireEvent.click(applyButtons[0]);

    // Every row is written from the fallback empty object -> undefined value.
    expect(mockedProcess).toHaveBeenCalledTimes(2);
    expect(mockedProcess).toHaveBeenCalledWith(undefined, undefined);

    const calls = props.onMetadataChange.mock.calls;
    const finalMeta = calls[calls.length - 1][0].metadata;
    expect(finalMeta.rows[0]["Collection Location"]).toBe("undefined-nonhuman");
    expect(finalMeta.rows[1]["Collection Location"]).toBe("undefined-nonhuman");
    // Applying clears the marker again.
    expect(screen.queryAllByText("Apply to All")).toHaveLength(0);
  });
});
