// Frontend coverage:
// app/assets/src/components/views/SampleUploadFlow/components/WorkflowSelector/components/PipelineVersionIndicator/PipelineVersionIndicator.tsx
//
// CZID-975 makes the pipeline version SELECTABLE at upload. The component is shared: the same
// component renders the read-only "NCBI Index Date" variant via isPipelineVersion={false}, and it
// has four call sites. So these tests pin two things in equal measure -- that the dropdown works,
// and that every path which does NOT opt into it renders exactly as it did before.
import { fireEvent, render, screen } from "@testing-library/react";
import { PipelineVersionIndicator } from "~/components/views/SampleUploadFlow/components/WorkflowSelector/components/PipelineVersionIndicator/PipelineVersionIndicator";

const VERSIONS = [
  { version: "8.3.15", deprecated: false },
  { version: "8.3.9", deprecated: false },
  { version: "8.1.0", deprecated: true, notes: "no longer patched" },
];

describe("PipelineVersionIndicator", () => {
  describe("read-only rendering (unchanged behaviour)", () => {
    it("renders the pipeline version as text when no catalog is supplied", () => {
      render(
        <PipelineVersionIndicator
          isPipelineVersion={true}
          version="8.3.15"
          versionHelpLink="https://help.example/version"
        />,
      );

      expect(screen.getByText("Pipeline Version:")).toBeTruthy();
      expect(screen.getByText("8.3.15")).toBeTruthy();
      expect(screen.queryByTestId("pipeline-version-select")).toBeNull();
    });

    // The path CZID-975 must not regress: the index-date variant never opts in.
    it("renders the NCBI index date as text even if a catalog is passed", () => {
      render(
        <PipelineVersionIndicator
          isPipelineVersion={false}
          version="2024-02-06"
          versionHelpLink="https://help.example/index"
          availableVersions={VERSIONS}
          onVersionChange={jest.fn()}
        />,
      );

      expect(screen.getByText("NCBI Index Date:")).toBeTruthy();
      expect(screen.getByText("2024-02-06")).toBeTruthy();
      expect(screen.queryByTestId("pipeline-version-select")).toBeNull();
    });

    it("stays read-only when the catalog is empty", () => {
      render(
        <PipelineVersionIndicator
          isPipelineVersion={true}
          version="8.3.15"
          versionHelpLink="https://help.example/version"
          availableVersions={[]}
          onVersionChange={jest.fn()}
        />,
      );

      expect(screen.queryByTestId("pipeline-version-select")).toBeNull();
      expect(screen.getByText("8.3.15")).toBeTruthy();
    });

    it("stays read-only when no change handler is wired", () => {
      render(
        <PipelineVersionIndicator
          isPipelineVersion={true}
          version="8.3.15"
          versionHelpLink="https://help.example/version"
          availableVersions={VERSIONS}
        />,
      );

      expect(screen.queryByTestId("pipeline-version-select")).toBeNull();
    });
  });

  describe("selectable rendering", () => {
    const renderSelectable = (onVersionChange = jest.fn()) => {
      render(
        <PipelineVersionIndicator
          isPipelineVersion={true}
          version="8.3.15"
          versionHelpLink="https://help.example/version"
          availableVersions={VERSIONS}
          onVersionChange={onVersionChange}
        />,
      );
      return onVersionChange;
    };

    it("offers every catalogued version, newest first as the server ordered them", () => {
      renderSelectable();

      // The platform Dropdown renders each option as a menu item keyed by its label
      // (kebab-cased). "8.1.0 (deprecated: ...)" -> "8-1-0-deprecated-no-longer-patched".
      const ordered = [
        "8-3-15",
        "8-3-9",
        "8-1-0-deprecated-no-longer-patched",
      ].map(id => screen.getByTestId(id));
      // every catalogued version is offered...
      ordered.forEach(item => expect(item).toBeTruthy());
      // ...in the order the server provided (newest first).
      expect(
        ordered[0].compareDocumentPosition(ordered[1]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        ordered[1].compareDocumentPosition(ordered[2]) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("preselects the version the project resolves to", () => {
      renderSelectable();

      // The dropdown trigger surfaces the resolved version as its current value.
      expect(screen.getByTestId("filter-value").textContent).toBe("8.3.15");
    });

    it("marks a deprecated version rather than hiding it", () => {
      renderSelectable();

      expect(
        screen.getByText("8.1.0 (deprecated: no longer patched)"),
      ).toBeTruthy();
      // A runnable version is offered plainly.
      expect(screen.getByText("8.3.9")).toBeTruthy();
    });

    it("reports the user's choice", () => {
      const onVersionChange = renderSelectable();

      // Clicking an option reports its exact version value (which the backend then runs verbatim).
      fireEvent.click(screen.getByTestId("8-3-9"));

      expect(onVersionChange).toHaveBeenCalledWith("8.3.9");
    });
  });
});
