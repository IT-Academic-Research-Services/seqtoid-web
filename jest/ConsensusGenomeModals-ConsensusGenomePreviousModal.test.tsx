// Coverage: .../ModalManager/components/ConsensusGenomeModals/ConsensusGenomePreviousModal.tsx
//
// This modal lists a taxon's previous consensus genome runs. The logic lives in
// the two column definitions it hands to Table: the primary cell renders an
// accession title plus a metrics subtext (only when parsed_cached_results is
// present, and only formatting coverage when coverage is truthy), and the date
// column runs the timestamp through moment().fromNow(). The footer button is
// guarded with `onNew && onNew(...)`, so both sides of that guard are driven.
//
// Modal and BasicPopup are stubbed to plain wrappers; Table is stubbed to a
// double that actually invokes each column's cellDataGetter/cellRenderer so the
// real renderers execute, and exposes a per-row click to check onRowClick.
import { fireEvent, render, screen } from "@testing-library/react";
import { ConsensusGenomePreviousModal } from "~/components/views/SampleView/components/ModalManager/components/ConsensusGenomeModals/ConsensusGenomePreviousModal";

jest.mock("~ui/containers/Modal", () => ({
  __esModule: true,
  default: (props: $TSFixMe) =>
    props.open === false ? null : (
      <div data-testid="modal" data-narrow={String(props.narrow)}>
        <button data-testid="modal-close" onClick={() => props.onClose()} />
        {props.children}
      </div>
    ),
}));

jest.mock("~/components/common/BasicPopup", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="popup" data-content={String(props.content)}>
      {props.trigger}
    </div>
  ),
}));

jest.mock("~/components/visualizations/table", () => ({
  Table: (props: $TSFixMe) => (
    <div data-testid="table" data-row-count={String((props.data ?? []).length)}>
      {(props.data ?? []).map((rowData: $TSFixMe, index: number) => (
        <div key={index} data-testid={`row-${index}`}>
          <button
            data-testid={`row-click-${index}`}
            onClick={() => props.onRowClick({ rowData })}
          />
          {props.columns.map((column: $TSFixMe, colIndex: number) => {
            const cellData = column.cellDataGetter
              ? column.cellDataGetter({ rowData })
              : rowData[column.dataKey];
            return (
              <div key={colIndex} data-testid={`cell-${index}-${column.label}`}>
                {column.cellRenderer({ cellData })}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  ),
}));

const run = (overrides: $TSFixMe = {}) => ({
  inputs: { accession_id: "MN908947.3", accession_name: "SARS-CoV-2" },
  executed_at: "2021-01-01T00:00:00Z",
  parsed_cached_results: {
    coverage_viz: { coverage_depth: 12.3456 },
    quality_metrics: { percent_identity: 99.1, reference_genome_length: 29903 },
  },
  ...overrides,
});

const renderModal = (overrides: $TSFixMe = {}) => {
  const onClose = jest.fn();
  const onNew = jest.fn();
  const onRowClick = jest.fn();
  const view = render(
    <ConsensusGenomePreviousModal
      consensusGenomeData={
        { taxName: "Klebsiella pneumoniae", previousRuns: [run()] } as $TSFixMe
      }
      open
      onClose={onClose}
      onNew={onNew}
      onRowClick={onRowClick}
      sample={{ id: 12 }}
      {...overrides}
    />,
  );
  return { onClose, onNew, onRowClick, ...view };
};

const primaryCell = (index = 0) =>
  screen.getByTestId(`cell-${index}-Consensus Genomes`);

describe("ConsensusGenomePreviousModal", () => {
  it("renders the taxon name and one row per previous run", () => {
    renderModal({
      consensusGenomeData: {
        taxName: "Klebsiella pneumoniae",
        previousRuns: [run(), run()],
      },
    });

    expect(screen.getByText("Klebsiella pneumoniae")).not.toBeNull();
    expect(screen.getByTestId("table").getAttribute("data-row-count")).toBe(
      "2",
    );
  });

  it("renders the accession title in both the popup content and the trigger", () => {
    renderModal();

    const popup = screen.getByTestId("popup");
    expect(popup.getAttribute("data-content")).toBe("MN908947.3 - SARS-CoV-2");
    expect(popup.textContent).toContain("MN908947.3 - SARS-CoV-2");
  });

  it("formats the metrics subtext with comma-separated length and 2dp coverage", () => {
    renderModal();

    expect(primaryCell().textContent).toContain(
      "99.1 %id, 29,903 bp length, 12.35x coverage",
    );
  });

  it("leaves the coverage figure blank when coverage depth is missing", () => {
    renderModal({
      consensusGenomeData: {
        taxName: "Taxon",
        previousRuns: [
          run({
            parsed_cached_results: {
              quality_metrics: {
                percent_identity: 98,
                reference_genome_length: 1000,
              },
            },
          }),
        ],
      },
    });

    expect(primaryCell().textContent).toContain(
      "98 %id, 1,000 bp length, x coverage",
    );
    expect(primaryCell().textContent).not.toContain("NaN");
  });

  it("renders no subtext at all when the run has no cached results", () => {
    renderModal({
      consensusGenomeData: {
        taxName: "Taxon",
        previousRuns: [run({ parsed_cached_results: null })],
      },
    });

    expect(primaryCell().textContent).toBe("MN908947.3 - SARS-CoV-2");
    expect(primaryCell().textContent).not.toContain("%id");
  });

  it("renders the executed_at timestamp as a relative date", () => {
    renderModal();

    expect(screen.getByTestId("cell-0-Date Created").textContent).toMatch(
      /ago$/,
    );
  });

  it("forwards a row click to onRowClick with the row data", () => {
    const { onRowClick } = renderModal();

    fireEvent.click(screen.getByTestId("row-click-0"));

    expect(onRowClick).toHaveBeenCalledTimes(1);
    expect(onRowClick.mock.calls[0][0].rowData.inputs.accession_id).toBe(
      "MN908947.3",
    );
  });

  it("calls onNew with the consensus genome data when the create button is clicked", () => {
    const data = { taxName: "Taxon", previousRuns: [] };
    const { onNew } = renderModal({ consensusGenomeData: data });

    fireEvent.click(
      screen.getByText("Create a New Consensus Genome").closest("button")!,
    );

    expect(onNew).toHaveBeenCalledWith(data);
  });

  it("does not blow up when no onNew handler is supplied", () => {
    renderModal({ onNew: undefined });

    expect(() =>
      fireEvent.click(
        screen.getByText("Create a New Consensus Genome").closest("button")!,
      ),
    ).not.toThrow();
  });

  it("forwards the close handler from the modal chrome", () => {
    const { onClose } = renderModal();

    fireEvent.click(screen.getByTestId("modal-close"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders an empty table when there are no previous runs", () => {
    renderModal({
      consensusGenomeData: { taxName: "Taxon", previousRuns: [] },
    });

    expect(screen.getByTestId("table").getAttribute("data-row-count")).toBe(
      "0",
    );
    expect(screen.queryByTestId("row-0")).toBeNull();
  });
});
