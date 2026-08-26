// Coverage: app/assets/src/components/common/DetailsSidebar/PipelineStepDetailsMode/PipelineStepDetailsMode.tsx
//
// PipelineStepDetailsMode is a pure prop-driven sidebar. It renders a status box
// whose content branches on `status` (inProgress / finished / errored / unknown),
// plus optional Step Info, Input Files, Output Files and Resources accordions.
// The tests drive each branch and both sides of the file-link (url vs no url) and
// the fromStepName fallback.
import { render, screen } from "@testing-library/react";

// linkify-react is NOT mocked: it ships a CommonJS build that jest resolves
// directly, and its tree-walking behaviour is exactly what regressed here, so
// the real implementation has to run.
//
// react-markdown@10 is ESM-only all the way down its unified/micromark
// dependency chain and jest's resolver cannot load it, so it is stubbed. The
// stub enforces the one contract that matters for SMP-1658: react-markdown
// requires `children` to be a single string. linkify-react rewrites the string
// children of any element it walks into an ARRAY, which trips an internal
// invariant that is a no-op in production builds -- so the real component
// silently rendered an empty div. Throwing here turns that silent blank panel
// into a loud test failure. The stub also honours the `components` override so
// the Linkify-inside-markdown composition is exercised.
jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children, components }: $TSFixMe) => {
    if (typeof children !== "string") {
      throw new Error(
        "Unexpected value for `children` prop, expected `string` but got " +
          Object.prototype.toString.call(children),
      );
    }
    const Paragraph = (components && components.p) || "p";
    return require("react").createElement(Paragraph, null, children);
  },
}));

import PipelineStepDetailsMode from "~/components/common/DetailsSidebar/PipelineStepDetailsMode/PipelineStepDetailsMode";

const baseProps = {
  status: "finished",
  startTime: 1_600_000_000,
  endTime: 1_600_000_600,
  sample: { id: 42, upload_error: null } as $TSFixMe,
  pipelineRun: {} as $TSFixMe,
  description: "",
  inputFiles: [] as $TSFixMe,
  stepName: "Alignment",
  outputFiles: [] as $TSFixMe,
  resources: [] as $TSFixMe,
};

const renderStep = (props: $TSFixMe = {}) =>
  render(<PipelineStepDetailsMode {...baseProps} {...props} />);

describe("PipelineStepDetailsMode header + status", () => {
  it("always renders the step name", () => {
    renderStep({ stepName: "GSNAP" });
    expect(screen.getByTestId("stepName").textContent).toBe("GSNAP");
  });

  it("renders 'Current step' for the inProgress status", () => {
    renderStep({ status: "inProgress" });
    expect(screen.getByText("Current step")).toBeTruthy();
    expect(screen.getByText(/Running for/)).toBeTruthy();
  });

  it("renders 'Step completed' for the finished status", () => {
    renderStep({ status: "finished" });
    expect(screen.getByText("Step completed")).toBeTruthy();
    expect(screen.getByText(/Finished in/)).toBeTruthy();
  });

  it("renders the failure message for an errored status", () => {
    renderStep({
      status: "pipelineErrored",
      sample: { id: 1, upload_error: "InvalidInputFileError" },
    });
    expect(screen.getByText("Sample failed at this step.")).toBeTruthy();
  });

  it("renders no status box for an unknown status", () => {
    renderStep({ status: "somethingElse" });
    expect(screen.queryByText("Step completed")).toBeNull();
    expect(screen.queryByText("Current step")).toBeNull();
  });
});

describe("PipelineStepDetailsMode step info", () => {
  it("renders the Step Info accordion when a description is present", () => {
    renderStep({ description: "This step aligns reads." });
    expect(screen.getByText("Step Info")).toBeTruthy();
    expect(screen.getByText("This step aligns reads.")).toBeTruthy();
  });

  it("linkifies a bare url inside the description", () => {
    renderStep({ description: "See https://czid.org/help for details." });
    const link = screen.getByText("https://czid.org/help");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("https://czid.org/help");
  });

  it("omits Step Info when the description is empty", () => {
    renderStep({ description: "" });
    expect(screen.queryByText("Step Info")).toBeNull();
  });
});

describe("PipelineStepDetailsMode file lists", () => {
  it("renders input files with the fromStepName header and a link for files with a url", () => {
    renderStep({
      inputFiles: [
        {
          fromStepName: "Host Filtering",
          files: [{ fileName: "reads.fastq", url: "http://x/reads" }],
        },
      ],
    });
    expect(screen.getByText("Input Files")).toBeTruthy();
    expect(screen.getByText("From Host Filtering Step:")).toBeTruthy();
    const link = screen.getByText("reads.fastq");
    expect(link.getAttribute("href")).toBe("http://x/reads");
  });

  it("falls back to 'Sample' when a file group has no fromStepName and shows no link without a url", () => {
    renderStep({
      inputFiles: [{ files: [{ fileName: "raw.fastq" }] }],
    });
    expect(screen.getByText("From Sample Step:")).toBeTruthy();
    const el = screen.getByText("raw.fastq");
    expect(el.tagName).not.toBe("A");
  });

  it("renders no input-files accordion when the list is empty", () => {
    renderStep({ inputFiles: [] });
    expect(screen.queryByText("Input Files")).toBeNull();
  });

  it("renders output files with the step-name header", () => {
    renderStep({
      stepName: "Assembly",
      outputFiles: [{ fileName: "contigs.fa", url: "http://x/contigs" }],
    });
    expect(screen.getByText("Output Files")).toBeTruthy();
    expect(screen.getByText("From Assembly Step:")).toBeTruthy();
    expect(screen.getByText("contigs.fa").getAttribute("href")).toBe(
      "http://x/contigs",
    );
  });

  it("renders no output-files accordion when the list is empty", () => {
    renderStep({ outputFiles: [] });
    expect(screen.queryByText("Output Files")).toBeNull();
  });
});

describe("PipelineStepDetailsMode resources", () => {
  it("renders resource links when resources are present", () => {
    renderStep({
      resources: [{ name: "STAR docs", url: "http://x/star" }],
    });
    expect(screen.getByText("Resources")).toBeTruthy();
    const link = screen.getByText("STAR docs");
    expect(link.getAttribute("href")).toBe("http://x/star");
  });

  it("renders no Resources section when there are none", () => {
    renderStep({ resources: [] });
    expect(screen.queryByText("Resources")).toBeNull();
  });
});
