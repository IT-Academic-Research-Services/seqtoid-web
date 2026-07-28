// Coverage for the shared static cell renderers used by every discovery /
// samples table. These are pure render + format helpers with a lot of
// short-circuit branches (missing sample, public vs private, uploadError vs
// pipeline status, accession id vs name, ...), so both arms of each are
// exercised deliberately.
import { render, screen } from "@testing-library/react";
import React from "react";
import {
  STATUS_TYPE,
  TableRenderers,
} from "~/components/common/TableRenderers/TableRenderers";

// Keeps prettier's organize-imports from dropping the React import that the
// classic JSX runtime needs in scope.
const _React: typeof React = React;

const renderNode = (node: React.ReactNode) => render(<div>{node}</div>);

describe("TableRenderers.baseRenderer / renderList", () => {
  it("renders the raw value", () => {
    renderNode(TableRenderers.baseRenderer("hello"));
    expect(screen.getByTestId("hello").textContent).toBe("hello");
  });

  it("joins a non-empty list with commas", () => {
    const { container } = renderNode(
      TableRenderers.renderList({ cellData: ["a", "b", "c"] }),
    );
    expect(container.textContent).toBe("a, b, c");
  });

  it("renders an empty string for an empty list", () => {
    const { container } = renderNode(
      TableRenderers.renderList({ cellData: [] }),
    );
    expect(container.textContent).toBe("");
  });

  it("renders an empty string for a missing list", () => {
    const { container } = renderNode(
      TableRenderers.renderList({ cellData: null }),
    );
    expect(container.textContent).toBe("");
  });
});

describe("TableRenderers.renderDate / renderDateWithElapsed", () => {
  it("formats a date as YYYY-MM-DD", () => {
    renderNode(TableRenderers.renderDate({ cellData: "2021-03-04T10:00:00Z" }));
    expect(screen.getByTestId("date-created").textContent).toBe("2021-03-04");
  });

  it("renders nothing for a missing date", () => {
    renderNode(TableRenderers.renderDate({ cellData: null }));
    expect(screen.getByTestId("date-created").textContent).toBe("");
  });

  it("adds a relative elapsed string alongside the date", () => {
    renderNode(
      TableRenderers.renderDateWithElapsed({ cellData: "2021-03-04" }),
    );
    expect(screen.getByTestId("date-created").textContent).toBe("2021-03-04");
    // moment().fromNow() always contains "ago" for a past date.
    expect(screen.getByTestId("days-elapsed").textContent).toContain("ago");
  });

  it("leaves the elapsed string empty when there is no date", () => {
    renderNode(TableRenderers.renderDateWithElapsed({ cellData: undefined }));
    expect(screen.getByTestId("days-elapsed").textContent).toBe("");
  });
});

describe("TableRenderers.renderItemDetails", () => {
  const baseArgs = {
    detailsRenderer: (item: $TSFixMe) => `by ${item.owner}`,
    nameRenderer: (item: $TSFixMe) => item.name,
    visibilityIconRenderer: () => <i className="lock" />,
  };

  it("renders name, description and details when a description exists", () => {
    render(
      <div>
        {TableRenderers.renderItemDetails({
          ...baseArgs,
          cellData: { name: "Project X", description: "desc", owner: "Tom" },
          descriptionRenderer: (item: $TSFixMe) => item.description,
        })}
      </div>,
    );
    expect(screen.getByTestId("project-name").textContent).toBe("Project X");
    expect(screen.getByTestId("project-description").textContent).toBe("desc");
    expect(screen.getByTestId("created-by").textContent).toBe("by Tom");
  });

  it("omits the description block when there is no description", () => {
    render(
      <div>
        {TableRenderers.renderItemDetails({
          ...baseArgs,
          cellData: { name: "Project Y", owner: "Tom" },
          descriptionRenderer: (item: $TSFixMe) => item.description,
        })}
      </div>,
    );
    expect(screen.queryByTestId("project-description")).toBeNull();
    expect(screen.getByTestId("project-name").textContent).toBe("Project Y");
  });

  it("tolerates a null visibility icon", () => {
    render(
      <div>
        {TableRenderers.renderItemDetails({
          ...baseArgs,
          visibilityIconRenderer: () => null,
          cellData: { name: "Project Z", owner: "Tom" },
          descriptionRenderer: undefined,
        })}
      </div>,
    );
    expect(screen.getByTestId("project-name").textContent).toBe("Project Z");
  });
});

describe("TableRenderers.renderSampleCounts", () => {
  it("renders workflow counts when cellData is present", () => {
    render(
      <div>
        {TableRenderers.renderSampleCounts({
          cellData: { number_of_samples: 4, projectId: 12 },
          workflowRunsProjectAggregates: undefined,
        })}
      </div>,
    );
    // Counts are still loading (no aggregates), but the container renders.
    expect(screen.queryByTestId("sample-counts")).toBeNull();
  });

  it("renders nothing when cellData is missing", () => {
    const { container } = render(
      <div>
        {TableRenderers.renderSampleCounts({
          cellData: null,
        })}
      </div>,
    );
    expect(container.textContent).toBe("");
  });
});

describe("TableRenderers.renderSampleInfo", () => {
  const sample = {
    name: "Sample A",
    user: "Owner",
    project: "Proj",
    publicAccess: true,
  };

  it("shows the workflow run status when there is no upload error", () => {
    render(
      <div>
        {TableRenderers.renderSampleInfo({
          rowData: { sample, status: "complete" },
          full: true,
          basicIcon: false,
          showSampleOwnerName: true,
        })}
      </div>,
    );
    expect(screen.getByTestId("complete").textContent).toBe("complete");
    expect(screen.getByText("Sample A")).toBeTruthy();
    expect(screen.getByText("Owner")).toBeTruthy();
  });

  it("prefers the sample upload error over the run status", () => {
    render(
      <div>
        {TableRenderers.renderSampleInfo({
          rowData: {
            sample: { ...sample, uploadError: "failed" },
            status: "complete",
          },
          full: true,
          basicIcon: true,
          showSampleOwnerName: true,
        })}
      </div>,
    );
    expect(screen.getByTestId("failed").textContent).toBe("failed");
    expect(screen.queryByTestId("complete")).toBeNull();
  });

  it("falls back to the workflow initiator name when not showing the owner", () => {
    render(
      <div>
        {TableRenderers.renderSampleInfo({
          rowData: {
            sample: { ...sample, userNameWhoInitiatedWorkflowRun: "Initiator" },
            status: "running",
          },
          full: false,
          basicIcon: false,
          showSampleOwnerName: false,
        })}
      </div>,
    );
    expect(screen.getByText("Initiator")).toBeTruthy();
    expect(screen.queryByText("Owner")).toBeNull();
  });

  it("uses the owner name when there is no workflow initiator", () => {
    render(
      <div>
        {TableRenderers.renderSampleInfo({
          rowData: { sample: { ...sample, publicAccess: false } },
          full: true,
          basicIcon: false,
          showSampleOwnerName: false,
        })}
      </div>,
    );
    expect(screen.getByText("Owner")).toBeTruthy();
  });

  it("renders empty panes when there is no sample", () => {
    const { container } = render(
      <div>
        {TableRenderers.renderSampleInfo({
          rowData: {},
          full: true,
          basicIcon: false,
          showSampleOwnerName: true,
        })}
      </div>,
    );
    expect(container.textContent).toBe("");
  });
});

describe("TableRenderers.renderSample", () => {
  const sample = {
    name: "Sample B",
    user: "Uploader",
    project: "Proj B",
    publicAccess: false,
    pipelineRunStatus: "complete",
  };

  it("renders the pipeline run status, name, uploader and project", () => {
    render(<div>{TableRenderers.renderSample({ sample })}</div>);
    expect(screen.getByTestId("sample-name").textContent).toBe("Sample B");
    expect(screen.getByTestId("uploaded-by").textContent).toBe("Uploader");
    expect(screen.getByTestId("sample-project").textContent).toBe("Proj B");
    expect(screen.getByTestId("complete").textContent).toBe("complete");
  });

  it("prefers the upload error over the pipeline run status", () => {
    render(
      <div>
        {TableRenderers.renderSample({
          sample: { ...sample, uploadError: "aborted", publicAccess: true },
          basicIcon: false,
        })}
      </div>,
    );
    expect(screen.getByTestId("aborted").textContent).toBe("aborted");
  });

  it("renders the basic flask icon variant without a visibility icon", () => {
    render(
      <div>{TableRenderers.renderSample({ sample, basicIcon: true })}</div>,
    );
    expect(screen.getByTestId("sample-name").textContent).toBe("Sample B");
  });

  it("hides the visibility column when full is false", () => {
    render(<div>{TableRenderers.renderSample({ sample, full: false })}</div>);
    expect(screen.getByTestId("sample-name").textContent).toBe("Sample B");
  });

  it("renders empty placeholders when the sample is missing", () => {
    render(<div>{TableRenderers.renderSample({ sample: null })}</div>);
    expect(screen.getByTestId("uploaded-by").textContent).toBe("");
    expect(screen.queryByTestId("sample-name")).toBeNull();
  });
});

describe("TableRenderers.renderReferenceAccession", () => {
  it("joins the accession id and name when both are present", () => {
    const { container } = renderNode(
      TableRenderers.renderReferenceAccession({
        accessionName: "Some virus",
        referenceAccessionId: "MN908947",
        taxonName: "SARS-CoV-2",
      }),
    );
    expect(container.textContent).toContain("MN908947 - Some virus");
    expect(container.textContent).toContain("SARS-CoV-2");
  });

  it("shows only the id when there is no accession name", () => {
    const { container } = renderNode(
      TableRenderers.renderReferenceAccession({
        referenceAccessionId: "MN908947",
        taxonName: "SARS-CoV-2",
      }),
    );
    expect(container.textContent).toContain("MN908947");
    expect(container.textContent).not.toContain(" - ");
  });

  it("shows only the name when there is no id", () => {
    const { container } = renderNode(
      TableRenderers.renderReferenceAccession({
        accessionName: "Some virus",
        taxonName: "SARS-CoV-2",
      }),
    );
    expect(container.textContent).toContain("Some virus");
  });

  it("falls back to a dash for both accession and taxon when empty", () => {
    const { container } = renderNode(
      TableRenderers.renderReferenceAccession({}),
    );
    // Two em-dash placeholders: one for the accession, one for the taxon.
    expect(container.textContent).toBe("——");
  });
});

describe("TableRenderers.renderVisualization", () => {
  const args = {
    detailsRenderer: (item: $TSFixMe) => `details:${item.id}`,
    nameRenderer: (item: $TSFixMe) => item.name,
    visibilityIconRenderer: () => <i className="lock" />,
  };

  it("renders the status when a status renderer and status exist", () => {
    const { container } = renderNode(
      TableRenderers.renderVisualization({
        ...args,
        cellData: { id: 1, name: "Heatmap", status: "done" },
        statusRenderer: (item: $TSFixMe) => item.status,
      }),
    );
    expect(container.textContent).toContain("Heatmap");
    expect(container.textContent).toContain("done");
    expect(container.textContent).toContain("details:1");
  });

  it("omits the status block when the item has no status", () => {
    const { container } = renderNode(
      TableRenderers.renderVisualization({
        ...args,
        cellData: { id: 2, name: "Tree" },
        statusRenderer: (item: $TSFixMe) => item.status,
      }),
    );
    expect(container.textContent).toContain("Tree");
    expect(container.textContent).toBe("Treedetails:2");
  });

  it("omits the status block when no status renderer is given", () => {
    const { container } = renderNode(
      TableRenderers.renderVisualization({
        ...args,
        visibilityIconRenderer: () => null,
        cellData: { id: 3, name: "Phylo", status: "done" },
        statusRenderer: undefined,
      }),
    );
    expect(container.textContent).toBe("Phylodetails:3");
  });
});

describe("TableRenderers.renderNtNrValue", () => {
  it("renders both NT and NR values to three decimals", () => {
    const { container } = renderNode(
      TableRenderers.renderNtNrValue({ cellData: { nt: 1.23456, nr: 2 } }),
    );
    expect(container.textContent).toContain("1.235");
    expect(container.textContent).toContain("2.000");
  });

  it("renders nothing when only one of NT/NR is present", () => {
    const { container } = renderNode(
      TableRenderers.renderNtNrValue({ cellData: { nt: 1 } }),
    );
    expect(container.textContent).toBe("");
  });

  it("renders nothing when cellData is missing entirely", () => {
    const { container } = renderNode(
      TableRenderers.renderNtNrValue({ cellData: undefined }),
    );
    expect(container.textContent).toBe("");
  });
});

describe("TableRenderers.renderNumberAndPercentage", () => {
  it("renders the comma-formatted value and its percentage", () => {
    const { container } = renderNode(
      TableRenderers.renderNumberAndPercentage({
        cellData: { value: 1234567, percent: 12.3456 },
      }),
    );
    expect(container.textContent).toContain("1,234,567");
    expect(container.textContent).toContain("12.35%");
  });

  it("renders empty cells when the number is missing", () => {
    const { container } = renderNode(
      TableRenderers.renderNumberAndPercentage({ cellData: null }),
    );
    expect(container.textContent).toBe("");
  });
});

describe("TableRenderers numeric formatters", () => {
  it("formats numbers with commas", () => {
    expect(TableRenderers.formatNumberWithCommas(1234567)).toBe("1,234,567");
  });

  it("rounds finite numbers to two decimals", () => {
    expect(TableRenderers.formatNumber(3.14159)).toBe("3.14");
  });

  it("passes through falsy and non-finite values unchanged", () => {
    expect(TableRenderers.formatNumber(0)).toBe(0);
    expect(TableRenderers.formatNumber(null)).toBe(null);
    expect(TableRenderers.formatNumber(Infinity)).toBe(Infinity);
  });

  it("formats percentages, clamping at 100 and flooring below 0.01", () => {
    expect(TableRenderers.formatPercentage(50.456)).toBe("50.46%");
    expect(TableRenderers.formatPercentage(150)).toBe("100%");
    expect(TableRenderers.formatPercentage(0.001)).toBe("<0.01%");
    expect(TableRenderers.formatPercentage(0)).toBe(0);
  });

  it("formats durations with singular and plural units", () => {
    expect(TableRenderers.formatDuration(3660)).toBe("1 hour, 1 minute");
    expect(TableRenderers.formatDuration(7320)).toBe("2 hours, 2 minutes");
    expect(TableRenderers.formatDuration(30)).toBe("");
    expect(TableRenderers.formatDuration(120)).toBe("2 minutes");
  });

  it("renders a rounded base-10 exponent, passing through falsy input", () => {
    const { container } = renderNode(
      TableRenderers.format10BaseExponent(3.4) as React.ReactNode,
    );
    expect(container.textContent).toBe("103");
    expect(container.querySelector("sup")?.textContent).toBe("3");
    expect(TableRenderers.format10BaseExponent(0)).toBe(0);
  });
});

describe("STATUS_TYPE", () => {
  it("maps terminal states to the right SDS label types", () => {
    expect(STATUS_TYPE["complete"]).toBe("success");
    expect(STATUS_TYPE["failed"]).toBe("error");
    expect(STATUS_TYPE["incomplete"]).toBe("warning");
    expect(STATUS_TYPE["skipped"]).toBe("info");
    expect(STATUS_TYPE["running"]).toBe("default");
  });
});
