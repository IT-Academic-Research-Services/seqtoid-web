// Coverage: app/assets/src/components/common/DetailsSidebar/DetailsSidebar.tsx
//
// DetailsSidebar is a mode switch: it renders nothing at all when not visible,
// and otherwise dispatches to one of five detail-mode components (sample /
// taxon / pipelineStep / gene / bulkDownload), falling through to null for an
// unrecognised mode. Every detail mode is stubbed so this spec asserts the
// dispatch itself -- which component was chosen and that `params` was spread
// onto it -- plus the visibility guard and the default branch. Sidebar is
// stubbed to a plain passthrough so semantic-ui's animation wrapper does not
// hide the children from the DOM query.
import { render, screen } from "@testing-library/react";

jest.mock("~/components/ui/containers/Sidebar", () => ({
  __esModule: true,
  default: ({ children, visible, onClose }: $TSFixMe) => (
    <div data-testid="sidebar" data-visible={String(visible)}>
      <button data-testid="sidebar-close" onClick={onClose} />
      {children}
    </div>
  ),
}));

jest.mock("~/components/common/DetailsSidebar/SampleDetailsMode", () => ({
  __esModule: true,
  SampleDetailsMode: (props: $TSFixMe) => (
    <div data-testid="sample-mode">{String(props.sampleId)}</div>
  ),
}));

jest.mock("~/components/common/DetailsSidebar/TaxonDetailsMode", () => ({
  __esModule: true,
  TaxonDetailsMode: (props: $TSFixMe) => (
    <div data-testid="taxon-mode">{String(props.taxonId)}</div>
  ),
}));

jest.mock("~/components/common/DetailsSidebar/PipelineStepDetailsMode", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="pipeline-mode">{String(props.stepName)}</div>
  ),
}));

jest.mock("~/components/common/DetailsSidebar/GeneDetailsMode", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="gene-mode">{String(props.geneName)}</div>
  ),
}));

jest.mock("~/components/common/DetailsSidebar/BulkDownloadDetailsMode", () => ({
  __esModule: true,
  BulkDownloadDetailsMode: (props: $TSFixMe) => (
    <div data-testid="bulk-mode">{String(props.bulkDownload?.id)}</div>
  ),
}));

import DetailsSidebar from "~/components/common/DetailsSidebar/DetailsSidebar";

const renderSidebar = (overrides: $TSFixMe = {}) =>
  render(
    <DetailsSidebar
      mode={"sampleDetails"}
      onClose={jest.fn()}
      params={{ sampleId: 1 } as $TSFixMe}
      visible={true}
      {...overrides}
    />,
  );

describe("DetailsSidebar", () => {
  it("renders no mode contents while hidden, even with a valid mode", () => {
    renderSidebar({ visible: false });
    expect(screen.getByTestId("sidebar").getAttribute("data-visible")).toBe(
      "false",
    );
    expect(screen.queryByTestId("sample-mode")).toBeNull();
  });

  it("renders the sample details mode and forwards params", async () => {
    renderSidebar({ params: { sampleId: 77 } });
    expect((await screen.findByTestId("sample-mode")).textContent).toBe("77");
  });

  it("renders the taxon details mode", () => {
    renderSidebar({ mode: "taxonDetails", params: { taxonId: 573 } });
    expect(screen.getByTestId("taxon-mode").textContent).toBe("573");
    expect(screen.queryByTestId("sample-mode")).toBeNull();
  });

  it("renders the pipeline step details mode", () => {
    renderSidebar({
      mode: "pipelineStepDetails",
      params: { stepName: "Align" },
    });
    expect(screen.getByTestId("pipeline-mode").textContent).toBe("Align");
  });

  it("renders the gene details mode", () => {
    renderSidebar({ mode: "geneDetails", params: { geneName: "tetA" } });
    expect(screen.getByTestId("gene-mode").textContent).toBe("tetA");
  });

  it("renders the bulk download details mode", () => {
    renderSidebar({
      mode: "bulkDownloadDetails",
      params: { bulkDownload: { id: 12 } },
    });
    expect(screen.getByTestId("bulk-mode").textContent).toBe("12");
  });

  it("renders nothing for an unrecognised mode (default branch)", () => {
    renderSidebar({ mode: "somethingElse" as $TSFixMe, params: {} });
    expect(screen.getByTestId("sidebar")).toBeTruthy();
    expect(screen.queryByTestId("sample-mode")).toBeNull();
    expect(screen.queryByTestId("taxon-mode")).toBeNull();
    expect(screen.queryByTestId("gene-mode")).toBeNull();
    expect(screen.queryByTestId("pipeline-mode")).toBeNull();
    expect(screen.queryByTestId("bulk-mode")).toBeNull();
  });

  it("wires onClose through to the underlying sidebar", () => {
    const onClose = jest.fn();
    renderSidebar({ onClose });
    screen.getByTestId("sidebar-close").click();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
