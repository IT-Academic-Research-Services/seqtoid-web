// Coverage: app/assets/src/components/views/MetadataDictionary/MetadataDictionary.tsx
// The dictionary loads the official metadata fields and public host genomes on
// mount, then groups + sorts the fields for the currently selected host genome.
// We stub the heavy presentational children (LandingHeader / NarrowContainer /
// DataTable / Dropdown) and capture the DataTable props so we can assert the
// grouping, required-first ordering, example resolution (host-specific vs
// "all" vs empty "--") and the host-genome change branch.
import React from "react";

const mockGetOfficialMetadataFields = jest.fn();
const mockGetAllHostGenomesPublic = jest.fn();

jest.mock("~/api/metadata", () => ({
  getOfficialMetadataFields: (...args: unknown[]) =>
    mockGetOfficialMetadataFields(...args),
}));

jest.mock("~/api", () => ({
  getAllHostGenomesPublic: (...args: unknown[]) =>
    mockGetAllHostGenomesPublic(...args),
}));

jest.mock("~/components/common/LandingHeader", () => ({
  LandingHeader: () => <div data-testid="landing-header" />,
}));

jest.mock("~/components/layout/NarrowContainer", () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="narrow-container">{children}</div>
  ),
}));

const mockDataTableCalls: Array<Record<string, unknown>> = [];
jest.mock("~/components/visualizations/table/DataTable", () => ({
  __esModule: true,
  default: (props: Record<string, unknown>) => {
    mockDataTableCalls.push(props);
    return <div data-testid="data-table" />;
  },
}));

const mockDropdownState: { props: Record<string, unknown> | null } = {
  props: null,
};
jest.mock("~ui/controls/dropdowns", () => ({
  Dropdown: (props: Record<string, unknown>) => {
    mockDropdownState.props = props;
    return (
      <button
        data-testid="host-genome-dropdown"
        onClick={() => (props.onChange as CallableFunction)(2)}
      >
        {props.label as string}
      </button>
    );
  },
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MetadataDictionary } from "~/components/views/MetadataDictionary/MetadataDictionary";

const officialFields = [
  {
    name: "Zeta",
    description: "z desc",
    group: "Sample",
    host_genome_ids: [1],
    is_required: false,
    examples: { all: ["ex1"] },
    options: ["o1", "o2"],
  },
  {
    name: "Alpha",
    description: "a desc",
    group: "Sample",
    host_genome_ids: [1],
    is_required: true,
    examples: { 1: ["hostex"] },
  },
  {
    name: "Beta",
    description: "b desc",
    group: "Host",
    host_genome_ids: [1],
    is_required: false,
    examples: {},
  },
  {
    name: "OnlyMosquito",
    description: "m desc",
    group: "Sequencing",
    host_genome_ids: [2],
    is_required: false,
    examples: { all: ["x"] },
  },
];

const hostGenomes = [
  { id: 1, name: "Human", showAsOption: true },
  { id: 2, name: "Mosquito", showAsOption: true },
  { id: 3, name: "Hidden", showAsOption: false },
];

beforeEach(() => {
  mockDataTableCalls.length = 0;
  mockDropdownState.props = null;
  mockGetOfficialMetadataFields.mockReset();
  mockGetAllHostGenomesPublic.mockReset();
});

describe("MetadataDictionary", () => {
  it("shows a loading state before the fields resolve", () => {
    // Never-resolving promises keep the component in its loading branch.
    mockGetOfficialMetadataFields.mockReturnValue(new Promise(() => undefined));
    mockGetAllHostGenomesPublic.mockReturnValue(new Promise(() => undefined));
    render(<MetadataDictionary />);
    expect(screen.getByText("Metadata Dictionary")).toBeTruthy();
    expect(screen.getByText("Loading...")).toBeTruthy();
    expect(screen.queryByTestId("host-genome-dropdown")).toBeNull();
  });

  it("groups fields for the default host genome, required-first and ordered", async () => {
    mockGetOfficialMetadataFields.mockResolvedValue(
      officialFields.map(f => ({ ...f })),
    );
    mockGetAllHostGenomesPublic.mockResolvedValue(hostGenomes);
    render(<MetadataDictionary />);

    await waitFor(() =>
      expect(screen.getByTestId("host-genome-dropdown")).toBeTruthy(),
    );

    // Human (id 1) has a Sample group (Zeta, Alpha) and a Host group (Beta).
    expect(screen.getByText("Sample Fields")).toBeTruthy();
    expect(screen.getByText("Host Fields")).toBeTruthy();
    expect(screen.queryByText("Sequencing Fields")).toBeNull();

    // Sample group table: required Alpha is moved ahead of non-required Zeta.
    const sampleTable = mockDataTableCalls.find(
      c =>
        (c.data as Array<{ description: string }>)[0].description === "a desc",
    );
    expect(sampleTable).toBeTruthy();
    const sampleData = sampleTable!.data as Array<{ examples: string }>;
    expect(sampleData).toHaveLength(2);
    // Alpha resolves its host-specific example; Zeta falls back to "all".
    expect(sampleData[0].examples).toBe("hostex");
    expect(sampleData[1].examples).toBe("ex1");

    // Beta has empty examples -> the "--" fallback.
    const hostTable = mockDataTableCalls.find(
      c =>
        (c.data as Array<{ description: string }>)[0].description === "b desc",
    );
    expect((hostTable!.data as Array<{ examples: string }>)[0].examples).toBe(
      "--",
    );
  });

  it("exposes sorted host-genome options and defaults to the first genome", async () => {
    mockGetOfficialMetadataFields.mockResolvedValue(
      officialFields.map(f => ({ ...f })),
    );
    mockGetAllHostGenomesPublic.mockResolvedValue(hostGenomes);
    render(<MetadataDictionary />);

    await waitFor(() => expect(mockDropdownState.props).not.toBeNull());
    // Hidden (showAsOption false) is filtered out; options sorted by text.
    expect(mockDropdownState.props!.options).toEqual([
      { text: "Human", value: 1 },
      { text: "Mosquito", value: 2 },
    ]);
    expect(mockDropdownState.props!.value).toBe(1);
  });

  it("re-groups fields when the host genome changes", async () => {
    mockGetOfficialMetadataFields.mockResolvedValue(
      officialFields.map(f => ({ ...f })),
    );
    mockGetAllHostGenomesPublic.mockResolvedValue(hostGenomes);
    render(<MetadataDictionary />);

    await waitFor(() => expect(screen.getByText("Sample Fields")).toBeTruthy());

    // Switch to Mosquito (id 2): only the Sequencing field applies now.
    fireEvent.click(screen.getByTestId("host-genome-dropdown"));
    await waitFor(() =>
      expect(screen.getByText("Sequencing Fields")).toBeTruthy(),
    );
    expect(screen.queryByText("Sample Fields")).toBeNull();
  });
});
