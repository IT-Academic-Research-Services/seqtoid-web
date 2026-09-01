// Coverage for BulkDownloadModalFooter, the footer of the bulk download modal.
// Almost all of its logic is branch logic: which warning notifications render,
// whether the "Start Generating Download" button is enabled, and which sample
// ids get handed to onDownloadRequest for the human-host-only download type.
// Both arms of every conditional are exercised deliberately.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { BulkDownloadModalFooter } from "~/components/views/DiscoveryView/components/SamplesView/components/BulkDownloadModal/components/BulkDownloadModalFooter/BulkDownloadModalFooter";

// Keeps prettier's organize-imports from dropping the React import that the
// classic JSX runtime needs in scope.
const _React: typeof React = React;

const BUTTON_TEXT = "Start Generating Download";

const humanSample = { id: "1", name: "human-sample", hostGenome: "Human" };
const mouseSample = { id: "2", name: "mouse-sample", hostGenome: "Mouse" };

const sampleMetadataType = {
  type: "sample_metadata",
  display_name: "Sample Metadata",
  fields: [],
} as $TSFixMe;

const readsNonHostType = {
  type: "reads_non_host",
  display_name: "Reads (Non-host)",
  fields: [{ type: "taxa_with_reads" }, { type: "file_format" }],
} as $TSFixMe;

const biomFormatType = {
  type: "biom_format",
  display_name: "Biom",
  fields: [{ type: "metric" }, { type: "filter_by" }, { type: "background" }],
} as $TSFixMe;

const hostGeneCountsType = {
  type: "host_gene_counts",
  display_name: "Host Gene Counts",
  fields: [],
} as $TSFixMe;

const renderFooter = (props: $TSFixMe = {}) =>
  render(
    <BulkDownloadModalFooter
      downloadTypes={[
        sampleMetadataType,
        readsNonHostType,
        biomFormatType,
        hostGeneCountsType,
      ]}
      validObjectIds={new Set(["1", "2"])}
      sampleHostGenomes={[humanSample, mouseSample]}
      selectedDownloadTypeName="sample_metadata"
      onDownloadRequest={jest.fn()}
      workflow="short-read-mngs"
      {...props}
    />,
  );

const downloadButton = () =>
  screen.getByText(BUTTON_TEXT).closest("button") as HTMLButtonElement;

describe("BulkDownloadModalFooter button validity", () => {
  it("enables the button when the download type has no required fields", () => {
    renderFooter();
    expect(downloadButton().disabled).toBe(false);
  });

  it("disables the button when no download type is selected", () => {
    renderFooter({ selectedDownloadTypeName: null });
    expect(downloadButton().disabled).toBe(true);
  });

  it("disables the button when the selected type is not in downloadTypes", () => {
    renderFooter({ selectedDownloadTypeName: "does_not_exist" });
    expect(downloadButton().disabled).toBe(true);
  });

  it("disables the button when there are no valid object ids", () => {
    renderFooter({ validObjectIds: new Set() });
    expect(downloadButton().disabled).toBe(true);
  });

  it("disables the button when a required field has not been chosen", () => {
    renderFooter({
      selectedDownloadTypeName: "reads_non_host",
      selectedFields: { reads_non_host: { taxa_with_reads: "all" } },
    });
    // taxa_with_reads === "all" triggers the file_format conditional field, so
    // file_format stays required -- and it is unset.
    expect(downloadButton().disabled).toBe(true);
  });

  it("drops a conditional field that is not triggered from the required list", () => {
    renderFooter({
      selectedDownloadTypeName: "reads_non_host",
      // A specific taxon (not "all") does NOT trigger file_format, so the only
      // required field is taxa_with_reads, which is set.
      selectedFields: { reads_non_host: { taxa_with_reads: 573 } },
    });
    expect(downloadButton().disabled).toBe(false);
  });

  it("keeps a conditional field required when a filter_by metric triggers it", () => {
    renderFooter({
      selectedDownloadTypeName: "biom_format",
      selectedFields: {
        biom_format: {
          metric: "NT.rpm",
          filter_by: [{ metric: "NT_zscore" }],
        },
      },
    });
    // filter_by contains a z-score metric, which triggers the `background`
    // conditional field; background is unset, so the download is invalid.
    expect(downloadButton().disabled).toBe(true);
  });

  it("treats the download as valid when no filter_by metric triggers the conditional field", () => {
    renderFooter({
      selectedDownloadTypeName: "biom_format",
      selectedFields: {
        biom_format: {
          metric: "NT.rpm",
          filter_by: [{ metric: "NT_rpm" }],
        },
      },
    });
    expect(downloadButton().disabled).toBe(false);
  });
});

describe("BulkDownloadModalFooter host_gene_counts handling", () => {
  it("enables the button when at least one sample has a human host", () => {
    renderFooter({ selectedDownloadTypeName: "host_gene_counts" });
    expect(downloadButton().disabled).toBe(false);
  });

  it("disables the button when no sample has a human host", () => {
    renderFooter({
      selectedDownloadTypeName: "host_gene_counts",
      sampleHostGenomes: [mouseSample],
    });
    expect(downloadButton().disabled).toBe(true);
  });

  it("warns about the non-human samples that will be excluded", () => {
    const { container } = renderFooter({
      selectedDownloadTypeName: "host_gene_counts",
    });
    expect(container.textContent).toContain(
      "because currently we only support human hosts",
    );
    // Exactly one of the two samples is non-human, so the header is singular
    // and the collapsed accordion body lists it once expanded.
    expect(container.textContent).toContain("1 sample won");
    expect(container.textContent).not.toContain("mouse-sample");
    fireEvent.click(screen.getByText(/won.t be included in the bulk download/));
    expect(container.textContent).toContain("mouse-sample");
    expect(container.textContent).not.toContain("human-sample");
  });

  it("does not show the human-host warning for other download types", () => {
    const { container } = renderFooter({
      selectedDownloadTypeName: "sample_metadata",
    });
    expect(container.textContent).not.toContain(
      "because currently we only support human hosts",
    );
  });

  it("submits only the human-host sample ids for host_gene_counts", () => {
    const onDownloadRequest = jest.fn();
    renderFooter({
      selectedDownloadTypeName: "host_gene_counts",
      onDownloadRequest,
    });
    fireEvent.click(downloadButton());
    expect(onDownloadRequest).toHaveBeenCalledWith(["1"]);
  });

  it("submits every valid object id for other download types", () => {
    const onDownloadRequest = jest.fn();
    renderFooter({ onDownloadRequest });
    fireEvent.click(downloadButton());
    expect(onDownloadRequest).toHaveBeenCalledWith(new Set(["1", "2"]));
  });
});

describe("BulkDownloadModalFooter notifications", () => {
  it("warns about invalid samples when there are any", () => {
    const { container } = renderFooter({
      invalidSampleNames: ["bad-sample-a", "bad-sample-b"],
    });
    expect(container.textContent).toContain(
      "because they either failed or are still processing",
    );
    // Two named invalid samples: the header reports exactly two and there is no
    // "...and N more" summary row because every invalid sample is listed.
    expect(container.textContent).toContain("2 samples");
    expect(container.textContent).not.toContain("3 samples");
    fireEvent.click(screen.getByText(/won.t be included in the bulk download/));
    expect(container.textContent).toContain("bad-sample-a");
    expect(container.textContent).toContain("bad-sample-b");
    expect(container.textContent).not.toContain("...and");
  });

  it("uses a singular header for a single invalid sample", () => {
    const { container } = renderFooter({
      invalidSampleNames: ["bad-sample-a"],
    });
    // One invalid sample: singular "1 sample" and no "...and N more" row.
    expect(container.textContent).toContain("1 sample won");
    expect(container.textContent).not.toContain("samples");
    fireEvent.click(screen.getByText(/won.t be included in the bulk download/));
    expect(container.textContent).toContain("bad-sample-a");
    expect(container.textContent).not.toContain("...and");
  });

  it("collapses blank (unnamed) invalid samples into an accurate summary row", () => {
    const { container } = renderFooter({
      invalidSampleNames: ["", "bad-sample-a"],
    });
    // Two invalid samples total (one named, one blank): the header still counts
    // both, and the single unnamed sample collapses to "...and 1 more".
    expect(container.textContent).toContain("2 samples");
    fireEvent.click(screen.getByText(/won.t be included in the bulk download/));
    expect(container.textContent).toContain("bad-sample-a");
    expect(container.textContent).toContain("...and 1 more");
    expect(container.textContent).not.toContain("...and 2 more");
  });

  it("does not render the invalid-sample warning for an empty list", () => {
    const { container } = renderFooter({ invalidSampleNames: [] });
    expect(container.textContent).not.toContain(
      "because they either failed or are still processing",
    );
  });

  it("renders a validation error notification when validationError is set", () => {
    const { container } = renderFooter({ validationError: "boom" });
    expect(container.textContent).toContain(
      "An error occurred when verifying your selected samples.",
    );
  });

  it("renders no validation error notification when validationError is null", () => {
    const { container } = renderFooter({ validationError: null });
    expect(container.textContent).not.toContain(
      "An error occurred when verifying your selected samples.",
    );
  });

  it("reports that there are no valid samples once loading finishes", () => {
    const { container } = renderFooter({
      validObjectIds: new Set(),
      loading: false,
    });
    expect(container.textContent).toContain(
      "No valid samples to download data from.",
    );
  });

  it("suppresses the no-valid-samples message while still loading", () => {
    const { container } = renderFooter({
      validObjectIds: new Set(),
      loading: true,
    });
    expect(container.textContent).not.toContain(
      "No valid samples to download data from.",
    );
  });

  it("always renders the slow-download disclaimer", () => {
    const { container } = renderFooter();
    expect(container.textContent).toContain(
      "Downloads for larger files can take multiple hours to generate.",
    );
  });
});

describe("BulkDownloadModalFooter create states", () => {
  it("shows a loading message and hides the button while creating", () => {
    const { container } = renderFooter({ waitingForCreate: true });
    expect(container.textContent).toContain("Starting your download...");
    expect(screen.queryByText(BUTTON_TEXT)).toBeNull();
  });

  it("shows the create error and hides the button when creation failed", () => {
    const { container } = renderFooter({
      createStatus: "error",
      createError: "could not start download",
    });
    expect(container.textContent).toContain("could not start download");
    expect(screen.queryByText(BUTTON_TEXT)).toBeNull();
  });

  it("shows the button when creation succeeded", () => {
    renderFooter({ createStatus: "success" });
    expect(screen.getByText(BUTTON_TEXT)).toBeTruthy();
  });
});
