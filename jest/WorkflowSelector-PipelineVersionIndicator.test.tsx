// Frontend coverage:
// app/assets/src/components/views/SampleUploadFlow/components/WorkflowSelector/
//   components/PipelineVersionIndicator/PipelineVersionIndicator.tsx
//
// The indicator is a small block of string selection: isPipelineVersion swaps
// the header ("Pipeline Version:" vs "NCBI Index Date:"), the noun used in the
// subtext, and the noun used in the "a new ... is available" tooltip; a missing
// version replaces the explanatory subtext with the "Choose a project to view."
// prompt and hides the version paragraph entirely; and the info-icon tooltip is
// only mounted when isNewVersionAvailable is set.
//
// ExternalLink is stubbed (the real one reaches for the analytics context) and
// SDS Tooltip/Icon are stubbed so the tooltip body is inspectable as text.
import { render, screen } from "@testing-library/react";
import { PipelineVersionIndicator } from "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/PipelineVersionIndicator/PipelineVersionIndicator";

jest.mock("~/components/ui/controls/ExternalLink", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <a data-testid="external-link" href={props.href}>
      {props.children}
    </a>
  ),
}));

jest.mock("@czi-sds/components", () => ({
  __esModule: true,
  Icon: (props: $TSFixMe) => (
    <span data-testid="info-icon" data-icon={String(props.sdsIcon)} />
  ),
  Tooltip: (props: $TSFixMe) => (
    <span data-testid="version-tooltip">
      <span data-testid="version-tooltip-title">{props.title}</span>
      {props.children}
    </span>
  ),
}));

const VERSION_HELP = "https://help.example.org/versions";
const WARNING_HELP = "https://help.example.org/new-version";

const renderIndicator = (overrides: $TSFixMe = {}) =>
  render(
    <PipelineVersionIndicator
      versionHelpLink={VERSION_HELP}
      isPipelineVersion={true}
      {...overrides}
    />,
  );

describe("PipelineVersionIndicator -- pipeline version mode", () => {
  it("shows the pipeline header, the version and the explanatory subtext", () => {
    renderIndicator({ version: "8.2.1" });

    expect(screen.getByText("Pipeline Version:")).toBeTruthy();
    expect(screen.getByText("8.2.1")).toBeTruthy();
    expect(
      screen.getByText(/uses the above version to run your samples/),
    ).toBeTruthy();
    // The subtext link points at the version help page, not the warning page.
    expect(screen.getByTestId("external-link").getAttribute("href")).toBe(
      VERSION_HELP,
    );
  });

  it("falls back to the project prompt when no version is known", () => {
    renderIndicator({ version: undefined });

    expect(screen.getByText("Choose a project to view.")).toBeTruthy();
    expect(screen.queryByText(/run your samples/)).toBeNull();
    // No version paragraph and no subtext "Learn More" link at all.
    expect(screen.queryByTestId("external-link")).toBeNull();
  });
});

describe("PipelineVersionIndicator -- NCBI index mode", () => {
  it("swaps the header and the subtext noun for the index date", () => {
    renderIndicator({ isPipelineVersion: false, version: "2024-02-06" });

    expect(screen.getByText("NCBI Index Date:")).toBeTruthy();
    expect(screen.queryByText("Pipeline Version:")).toBeNull();
    expect(
      screen.getByText(/uses the above NCBI Index to run your samples/),
    ).toBeTruthy();
  });
});

describe("PipelineVersionIndicator -- new version warning", () => {
  it("hides the info icon when the project is on the newest version", () => {
    renderIndicator({ version: "8.2.1", isNewVersionAvailable: false });

    expect(screen.queryByTestId("version-tooltip")).toBeNull();
    expect(screen.queryByTestId("info-icon")).toBeNull();
  });

  it("mounts the tooltip and calls out a new major version", () => {
    renderIndicator({
      version: "8.2.1",
      isNewVersionAvailable: true,
      warningHelpLink: WARNING_HELP,
    });

    expect(screen.getByTestId("info-icon").getAttribute("data-icon")).toBe(
      "infoCircle",
    );
    const title = screen.getByTestId("version-tooltip-title");
    expect(title.textContent).toContain("A new major version is available.");
    expect(title.textContent).toContain("Create a new project");
    // Two links now: the warning link inside the tooltip and the subtext link.
    const hrefs = screen
      .getAllByTestId("external-link")
      .map(node => node.getAttribute("href"));
    expect(hrefs).toContain(WARNING_HELP);
    expect(hrefs).toContain(VERSION_HELP);
  });

  it("calls out a new NCBI Index when not in pipeline-version mode", () => {
    renderIndicator({
      isPipelineVersion: false,
      version: "2024-02-06",
      isNewVersionAvailable: true,
      warningHelpLink: WARNING_HELP,
    });

    expect(screen.getByTestId("version-tooltip-title").textContent).toContain(
      "A new NCBI Index is available.",
    );
  });

  it("renders the tooltip link with no href when warningHelpLink is omitted", () => {
    renderIndicator({ isNewVersionAvailable: true });

    // version is undefined here, so the only link is the tooltip's.
    const links = screen.getAllByTestId("external-link");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBeNull();
  });
});
