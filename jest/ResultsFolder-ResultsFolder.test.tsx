// Coverage: app/assets/src/components/views/ResultsFolder/ResultsFolder.tsx
//
// ResultsFolder renders the pipeline results file browser: a breadcrumb header,
// one table per pipeline stage (each with a config.json row plus a table body
// per step and its output files) and an optional "raw results" table. The file
// leaf rows branch on whether a url is present (clickable vs disabled), and step
// rows branch on readsAfter presence and Illumina-vs-ONT wording. The url
// helpers from ~/components/utils/links are stubbed so the click routing can be
// asserted without touching the DOM navigation APIs.
import { fireEvent, render, screen } from "@testing-library/react";

const mockOpenUrl = jest.fn();
const mockDownloadStringToFile = jest.fn();

jest.mock("~/components/utils/links", () => ({
  __esModule: true,
  openUrl: (...args: $TSFixMe[]) => mockOpenUrl(...args),
  downloadStringToFile: (...args: $TSFixMe[]) =>
    mockDownloadStringToFile(...args),
}));

import ResultsFolder from "~/components/views/ResultsFolder/ResultsFolder";

// A file list shaped like the RESULTS_FOLDER_*_KEYS the component expects:
// stage -> { name, stageDescription, stageDagJson, steps -> { step -> {...} } }.
const stageFileList = () => ({
  host_filtering: {
    name: "Host Filtering",
    stageDescription: "Remove host reads",
    stageDagJson: '{"a":1}',
    steps: {
      star: {
        name: "STAR",
        stepDescription: "Align",
        readsAfter: 1234,
        fileList: [
          { displayName: "out.bam", url: "http://x/out.bam", size: "1 MB" },
          { displayName: "no-url.txt", size: "2 KB" },
        ],
      },
    },
  },
});

const baseProps = (overrides: $TSFixMe = {}) => ({
  filePath: "root/1/samplePath/results",
  fileList: stageFileList(),
  sampleName: "Sample A",
  samplePath: "/samples/1",
  projectName: "Project X",
  pipelineTechnology: "Illumina" as $TSFixMe,
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ResultsFolder header + structure", () => {
  it("renders the breadcrumb from the split file path", () => {
    render(<ResultsFolder {...baseProps()} />);
    expect(screen.getByText("root")).toBeTruthy();
    expect(screen.getByText("Project X")).toBeTruthy();
    expect(screen.getByText("Sample A")).toBeTruthy();
    expect(screen.getByText("results")).toBeTruthy();
    // The project breadcrumb links to the project home using filePath[1].
    const projectLink = screen.getByText("Project X") as HTMLAnchorElement;
    expect(projectLink.getAttribute("href")).toBe("/home?project_id=1");
  });

  it("renders the stage header and step description", () => {
    render(<ResultsFolder {...baseProps()} />);
    expect(screen.getByText(/Host Filtering/)).toBeTruthy();
    expect(screen.getByText(/Remove host reads/)).toBeTruthy();
    expect(screen.getByText("STAR")).toBeTruthy();
  });

  it("shows 'No files to show' when the file list is empty", () => {
    render(<ResultsFolder {...baseProps({ fileList: {} })} />);
    expect(screen.getByText("No files to show")).toBeTruthy();
  });
});

describe("ResultsFolder file rows", () => {
  it("opens the url when a file with a url is clicked", () => {
    render(<ResultsFolder {...baseProps()} />);
    fireEvent.click(screen.getByText("out.bam"));
    expect(mockOpenUrl).toHaveBeenCalledWith("http://x/out.bam");
  });

  it("does not open a url for a file with no url", () => {
    render(<ResultsFolder {...baseProps()} />);
    fireEvent.click(screen.getByText("no-url.txt"));
    expect(mockOpenUrl).not.toHaveBeenCalled();
  });

  it("downloads the stage dag json when config.json is clicked", () => {
    // The stage-key lookup for the dag json resolves to undefined in the
    // constants, so the component falls back to the literal "None".
    render(<ResultsFolder {...baseProps()} />);
    fireEvent.click(screen.getByText("config.json"));
    expect(mockDownloadStringToFile).toHaveBeenCalledWith("None");
  });
});

describe("ResultsFolder step wording branches", () => {
  it("says 'reads remained' for Illumina technology", () => {
    render(
      <ResultsFolder {...baseProps({ pipelineTechnology: "Illumina" })} />,
    );
    expect(screen.getByText(/reads remained\./)).toBeTruthy();
  });

  it("says 'bases remained' for ONT technology", () => {
    render(<ResultsFolder {...baseProps({ pipelineTechnology: "ONT" })} />);
    expect(screen.getByText(/bases remained\./)).toBeTruthy();
  });

  it("omits the reads-remained blurb when readsAfter is absent", () => {
    const fl = stageFileList();
    delete (fl.host_filtering.steps.star as $TSFixMe).readsAfter;
    render(<ResultsFolder {...baseProps({ fileList: fl })} />);
    expect(screen.queryByText(/remained\./)).toBeNull();
  });
});

describe("ResultsFolder raw results table", () => {
  it("renders and routes the raw results link when a url is provided", () => {
    render(<ResultsFolder {...baseProps({ rawResultsUrl: "http://x/raw" })} />);
    const link = screen.getByText("Go to raw results folder");
    fireEvent.click(link);
    expect(mockOpenUrl).toHaveBeenCalledWith("http://x/raw");
  });

  it("omits the raw results table when no url is provided", () => {
    render(<ResultsFolder {...baseProps()} />);
    expect(screen.queryByText("Go to raw results folder")).toBeNull();
  });
});
