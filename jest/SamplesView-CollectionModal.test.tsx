// Coverage for CollectionModal, the "Create a Background Model" dialog. The
// component owns real behaviour worth pinning down: it validates the selected
// samples on mount, refuses reserved background names, warns when the selected
// samples span multiple NCBI index versions, truncates the sample list, and
// renders a success or error notification after the create call resolves or
// throws.
const mockCreateBackground = jest.fn();
const mockGetMassNormalizedBackgroundAvailability = jest.fn();
const mockValidateSampleIds = jest.fn();

jest.mock("~/api", () => ({
  createBackground: (...args: unknown[]) => mockCreateBackground(...args),
  getMassNormalizedBackgroundAvailability: (...args: unknown[]) =>
    mockGetMassNormalizedBackgroundAvailability(...args),
}));

jest.mock("~/api/access_control", () => ({
  validateSampleIds: (...args: unknown[]) => mockValidateSampleIds(...args),
}));

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import CollectionModal from "~/components/views/DiscoveryView/components/SamplesView/components/CollectionModal/CollectionModal";

// Keeps prettier's organize-imports from dropping the React import that the
// classic JSX runtime needs in scope.
const _React: typeof React = React;

const sample = (id: number, ncbiIndexVersion = "2021-01-22") => ({
  id,
  sample: {
    name: `sample-${id}`,
    project: `project-${id}`,
    ncbiIndexVersion,
  },
});

const renderModal = (props: $TSFixMe = {}) =>
  render(
    <CollectionModal
      allowedFeatures={[]}
      fetchedSamples={[sample(1), sample(2)]}
      selectedSampleIds={new Set([1, 2])}
      trigger={<span>open-collection-modal</span>}
      workflow="short-read-mngs"
      {...props}
    />,
  );

const openModal = async () => {
  fireEvent.click(screen.getByText("open-collection-modal"));
  await screen.findByText("Create a Background Model");
};

beforeEach(() => {
  jest.clearAllMocks();
  mockCreateBackground.mockResolvedValue({ status: "ok" });
  mockGetMassNormalizedBackgroundAvailability.mockResolvedValue({
    massNormalizedBackgroundsAvailable: false,
  });
  mockValidateSampleIds.mockResolvedValue({
    validIds: [1, 2],
    invalidSampleNames: [],
  });
});

describe("CollectionModal mounting", () => {
  it("validates the selected samples and checks mass-normalized availability on mount", async () => {
    renderModal();
    await waitFor(() =>
      expect(mockValidateSampleIds).toHaveBeenCalledWith({
        sampleIds: [1, 2],
        workflow: "short-read-mngs",
      }),
    );
    expect(mockGetMassNormalizedBackgroundAvailability).toHaveBeenCalledWith([
      1, 2,
    ]);
  });

  it("re-validates when the selected sample ids change", async () => {
    const { rerender } = renderModal();
    await waitFor(() => expect(mockValidateSampleIds).toHaveBeenCalledTimes(1));
    rerender(
      <CollectionModal
        allowedFeatures={[]}
        fetchedSamples={[sample(1), sample(2), sample(3)]}
        selectedSampleIds={new Set([1, 2, 3])}
        trigger={<span>open-collection-modal</span>}
        workflow="short-read-mngs"
      />,
    );
    await waitFor(() => expect(mockValidateSampleIds).toHaveBeenCalledTimes(2));
    expect(mockValidateSampleIds).toHaveBeenLastCalledWith({
      sampleIds: [1, 2, 3],
      workflow: "short-read-mngs",
    });
  });

  it("keeps the modal closed until the trigger is clicked", async () => {
    renderModal();
    await waitFor(() => expect(mockValidateSampleIds).toHaveBeenCalled());
    expect(screen.queryByText("Create a Background Model")).toBeNull();
    await openModal();
    expect(screen.getByText("Create a Background Model")).toBeTruthy();
  });

  it("closes the modal again when Cancel is clicked", async () => {
    renderModal();
    await openModal();
    fireEvent.click(
      screen.getByText("Cancel").closest("button") as HTMLElement,
    );
    await waitFor(() =>
      expect(screen.queryByText("Create a Background Model")).toBeNull(),
    );
  });
});

describe("CollectionModal sample list", () => {
  it("lists every selected sample with its project", async () => {
    renderModal();
    await openModal();
    expect(screen.getByText("sample-1")).toBeTruthy();
    expect(screen.getByText("(Project: project-1)")).toBeTruthy();
    expect(screen.getByText("sample-2")).toBeTruthy();
  });

  it("truncates the list and counts the remainder", async () => {
    renderModal({
      fetchedSamples: [sample(1), sample(2), sample(3)],
      selectedSampleIds: new Set([1, 2, 3]),
      maxSamplesShown: 1,
    });
    await openModal();
    expect(screen.getByText("sample-1")).toBeTruthy();
    expect(screen.queryByText("sample-2")).toBeNull();
    expect(screen.getByText(/and 2 more/)).toBeTruthy();
  });
});

describe("CollectionModal warnings", () => {
  it("warns when the selected samples span multiple NCBI index versions", async () => {
    mockValidateSampleIds.mockResolvedValue({
      validIds: [1, 2],
      invalidSampleNames: [],
    });
    renderModal({
      fetchedSamples: [sample(1, "2021-01-22"), sample(2, "2024-02-06")],
    });
    await openModal();
    await waitFor(() =>
      expect(
        screen.getByText(/were run using different versions of our NCBI index/),
      ).toBeTruthy(),
    );
    expect(document.body.textContent).toContain("2021-01-22, 2024-02-06");
  });

  it("does not warn when every sample shares an NCBI index version", async () => {
    renderModal();
    await openModal();
    await waitFor(() => expect(mockValidateSampleIds).toHaveBeenCalled());
    expect(
      screen.queryByText(/were run using different versions of our NCBI index/),
    ).toBeNull();
  });

  it("warns about samples that failed validation", async () => {
    mockValidateSampleIds.mockResolvedValue({
      validIds: [1],
      invalidSampleNames: ["broken-a", "broken-b"],
    });
    renderModal();
    await openModal();
    const header = await screen.findByText(
      /won.t be included in the background model/,
    );
    expect(header.textContent).toContain("2 samples");
    // The names live in a collapsed accordion body.
    expect(screen.queryByText("broken-a")).toBeNull();
    fireEvent.click(header);
    expect(screen.getByText("broken-a")).toBeTruthy();
    expect(screen.getByText("broken-b")).toBeTruthy();
  });

  it("uses the singular form for a single invalid sample", async () => {
    mockValidateSampleIds.mockResolvedValue({
      validIds: [2],
      invalidSampleNames: ["broken-a"],
    });
    renderModal();
    await openModal();
    const header = await screen.findByText(
      /won.t be included in the background model/,
    );
    expect(header.textContent).toContain("1 sample won");
    expect(header.textContent).not.toContain("1 samples");
  });

  it("shows no invalid-sample warning when everything validated", async () => {
    renderModal();
    await openModal();
    await waitFor(() => expect(mockValidateSampleIds).toHaveBeenCalled());
    expect(
      screen.queryByText(/won.t be included in the background model/),
    ).toBeNull();
  });
});

describe("CollectionModal background creation", () => {
  const typeName = (name: string) => {
    const input = document.querySelector(".ui.input input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: name } });
    return input;
  };

  const clickCreate = () =>
    fireEvent.click(
      screen.getByText("Create").closest("button") as HTMLElement,
    );

  it("rejects a reserved background name without calling the API", async () => {
    renderModal();
    await openModal();
    typeName("  None  ");
    clickCreate();
    expect(
      await screen.findByText(/Background model cannot be named/),
    ).toBeTruthy();
    expect(document.body.textContent).toContain("none");
    expect(mockCreateBackground).not.toHaveBeenCalled();
  });

  it("clears the reserved-name error once the name is changed", async () => {
    renderModal();
    await openModal();
    typeName("none");
    clickCreate();
    await screen.findByText(/Background model cannot be named/);
    typeName("a better name");
    await waitFor(() =>
      expect(screen.queryByText(/Background model cannot be named/)).toBeNull(),
    );
  });

  it("creates a standard background and reports success", async () => {
    renderModal();
    await openModal();
    typeName("my background");
    const textarea = document.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "a description" } });
    clickCreate();
    await waitFor(() => expect(mockCreateBackground).toHaveBeenCalled());
    expect(mockCreateBackground).toHaveBeenCalledWith({
      name: "my background",
      description: "a description",
      sampleIds: [1, 2],
      massNormalized: false,
    });
    expect(
      await screen.findByText(/Your Background Model is being created/),
    ).toBeTruthy();
  });

  it("renders the server-supplied message when creation is rejected", async () => {
    mockCreateBackground.mockResolvedValue({
      status: "error",
      message: "name already taken",
    });
    renderModal();
    await openModal();
    typeName("dupe");
    clickCreate();
    expect(await screen.findByText("name already taken")).toBeTruthy();
    expect(
      screen.queryByText(/Your Background Model is being created/),
    ).toBeNull();
  });

  it("falls back to a generic message when the create call throws", async () => {
    mockCreateBackground.mockRejectedValue(new Error("network down"));
    renderModal();
    await openModal();
    typeName("boom");
    clickCreate();
    expect(await screen.findByText("Something went wrong.")).toBeTruthy();
  });

  it("marks the background as mass normalized when that method is available", async () => {
    mockGetMassNormalizedBackgroundAvailability.mockResolvedValue({
      massNormalizedBackgroundsAvailable: true,
    });
    renderModal();
    await waitFor(() =>
      expect(mockGetMassNormalizedBackgroundAvailability).toHaveBeenCalled(),
    );
    await openModal();
    typeName("mass normalized background");
    clickCreate();
    await waitFor(() => expect(mockCreateBackground).toHaveBeenCalled());
    expect(mockCreateBackground).toHaveBeenCalledWith(
      expect.objectContaining({ massNormalized: true }),
    );
  });
});
