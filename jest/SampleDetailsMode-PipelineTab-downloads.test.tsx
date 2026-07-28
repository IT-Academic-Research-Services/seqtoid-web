// Branch coverage: app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/
//                  components/PipelineTab/PipelineTab.tsx
//
// The Downloads section is the one part of the tab the existing two suites
// never open. Each link chooses its target from `option.newPage`, and which
// links appear at all depends on whether stage two finished and whether the
// sample assembled -- so both arms of the target ternary need a run whose
// download set spans in-page and new-page links.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const mockGetSamplePipelineResults = jest.fn();

jest.mock("react-relay", () => ({
  useFragment: (_fragment: unknown, key: unknown) => key,
}));

jest.mock("~/api", () => ({
  getSamplePipelineResults: (...args: unknown[]) =>
    mockGetSamplePipelineResults(...args),
}));

import { PipelineTab } from "~/components/common/DetailsSidebar/SampleDetailsMode/components/PipelineTab/PipelineTab";

const makeData = (pipelineRunOverrides: Record<string, $TSFixMe> = {}) => ({
  pipeline_run: {
    total_reads: 1000,
    technology: "Illumina",
    sample_id: 7,
    pipeline_version: "8.0",
    version: { pipeline: "8.0", alignment_db: "2024-02-06" },
    ...pipelineRunOverrides,
  },
  summary_stats: {},
  ercc_comparison: null,
});

const renderDownloads = async (
  pipelineRunOverrides: Record<string, $TSFixMe>,
) => {
  render(
    <PipelineTab
      sampleId={7}
      pipelineTabFragmentKey={makeData(pipelineRunOverrides) as $TSFixMe}
    />,
  );
  await waitFor(() => expect(mockGetSamplePipelineResults).toHaveBeenCalled());
  fireEvent.click(screen.getByTestId("downloads-header"));
};

const linkTargets = () =>
  Object.fromEntries(
    Array.from(document.querySelectorAll("a")).map(anchor => [
      anchor.textContent,
      anchor.getAttribute("target"),
    ]),
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSamplePipelineResults.mockResolvedValue(null);
});

describe("PipelineTab downloads section", () => {
  it("opens file downloads in place and viewer links in a new tab", async () => {
    await renderDownloads({ adjusted_remaining_reads: 500, assembled: 1 });

    const targets = linkTargets();
    expect(targets["Download Non-Host Reads (.fasta)"]).toBe("_self");
    expect(targets["Download Non-Host Contigs (.fasta)"]).toBe("_self");
    expect(targets["Download Non-Host Contigs Summary (.csv)"]).toBe("_self");
    expect(targets["Download Unmapped Reads (.fasta)"]).toBe("_self");
    expect(targets["View Results Folder"]).toBe("_blank");
    expect(targets["View Pipeline Visualization"]).toBe("_blank");
  });

  it("offers only the viewer links before stage two finishes", async () => {
    await renderDownloads({ adjusted_remaining_reads: null, assembled: 0 });

    const targets = linkTargets();
    expect(Object.keys(targets).sort()).toEqual([
      "View Pipeline Visualization",
      "View Results Folder",
    ]);
    expect(Object.values(targets)).toEqual(["_blank", "_blank"]);
  });

  it("points each download at the pipeline version being viewed", async () => {
    await renderDownloads({ adjusted_remaining_reads: 500 });

    const link = Array.from(document.querySelectorAll("a")).find(
      anchor => anchor.textContent === "Download Non-Host Reads (.fasta)",
    );
    expect(link?.getAttribute("href")).toBe(
      "/samples/7/nonhost_fasta?pipeline_version=8.0",
    );
  });
});
