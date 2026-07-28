// Coverage: app/assets/src/components/views/SampleView/components/ModalManager/ModalManager.tsx
//
// ModalManager filters the modalsVisible map down to the entries that are true
// and then switches on the modal name to render the matching modal, wiring each
// one's onClose back through handleModalAction. The branches worth exercising
// are: every case of the switch, the default (a visible modal name the switch
// does not know), the filter dropping false entries, and blastData being an
// empty object so the optional-chained reads fall through to undefined. All five
// modal children are stubbed to expose the props they were handed.
import { fireEvent, render, screen } from "@testing-library/react";
import { ModalManager } from "~/components/views/SampleView/components/ModalManager/ModalManager";

// Declared as a hoisted function so the jest.mock factories below (which babel
// lifts above the imports) can safely call it.
function mockStub(testId: string, props: $TSFixMe) {
  return (
    <div
      data-testid={testId}
      data-open={String(props.open)}
      data-taxon-name={String(props.taxonName)}
      data-taxon-id={String(props.taxonId)}
      data-taxon-level={String(props.taxonLevel)}
      data-sample-id={String(props.sampleId)}
      data-context={String(props.context?.label)}
      data-pipeline-version={String(props.pipelineVersion)}
      data-cg-taxid={String(props.consensusGenomeData?.taxId)}
    >
      <button data-testid={`${testId}-close`} onClick={() => props.onClose()} />
      {props.onContinue && (
        <button
          data-testid={`${testId}-continue`}
          onClick={() => props.onContinue({ shouldBlastContigs: true })}
        />
      )}
      {props.onNew && (
        <button
          data-testid={`${testId}-new`}
          onClick={() => props.onNew({ taxId: 99 })}
        />
      )}
      {props.onRowClick && (
        <button
          data-testid={`${testId}-row`}
          onClick={() => props.onRowClick({ rowData: { id: 7 } })}
        />
      )}
      {props.handleConsensusGenomeKickoff && (
        <button
          data-testid={`${testId}-kickoff`}
          onClick={() => props.handleConsensusGenomeKickoff(props.sample)}
        />
      )}
    </div>
  );
}

jest.mock(
  "~/components/views/SampleView/components/ModalManager/components/BlastModals",
  () => ({
    BlastSelectionModal: (props: $TSFixMe) =>
      mockStub("blast-selection", props),
    BlastContigsModal: (props: $TSFixMe) => mockStub("blast-contigs", props),
    BlastReadsModal: (props: $TSFixMe) => mockStub("blast-reads", props),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/ModalManager/components/ConsensusGenomeModals",
  () => ({
    ConsensusGenomeCreationModal: (props: $TSFixMe) =>
      mockStub("cg-creation", props),
    ConsensusGenomePreviousModal: (props: $TSFixMe) =>
      mockStub("cg-previous", props),
  }),
);

const ALL_HIDDEN = {
  consensusGenomeError: false,
  consensusGenomeCreation: false,
  consensusGenomePrevious: false,
  blastSelection: false,
  blastContigs: false,
  blastReads: false,
};

const BLAST_DATA = {
  context: { label: "ctx" },
  pipelineVersion: "8.1",
  sampleId: 12,
  taxName: "Klebsiella",
  taxId: 570,
  taxLevel: 2,
  taxonStatsByCountType: { nt: 1 },
};

const renderManager = (overrides: $TSFixMe = {}) => {
  const handlers = {
    handleBlastSelectionModalContinue: jest.fn(),
    handleConsensusGenomeClick: jest.fn(),
    handleModalAction: jest.fn(),
    handlePreviousConsensusGenomeReportClick: jest.fn(),
    handleConsensusGenomeKickoff: jest.fn().mockResolvedValue(undefined),
  };
  const view = render(
    <ModalManager
      blastData={BLAST_DATA as $TSFixMe}
      blastModalInfo={{ shouldBlastContigs: true } as $TSFixMe}
      consensusGenomeData={{ taxId: 111 } as $TSFixMe}
      consensusGenomePreviousParams={{ taxId: 222 } as $TSFixMe}
      modalsVisible={ALL_HIDDEN as $TSFixMe}
      sample={{ id: 12 } as $TSFixMe}
      {...handlers}
      {...overrides}
    />,
  );
  return { ...handlers, ...view };
};

describe("ModalManager", () => {
  it("renders nothing when every modal is hidden", () => {
    const { container } = renderManager();

    expect(container.innerHTML).toBe("");
  });

  it("renders only the modals whose flag is true", () => {
    renderManager({
      modalsVisible: { ...ALL_HIDDEN, blastContigs: true, blastReads: true },
    });

    expect(screen.getByTestId("blast-contigs")).not.toBeNull();
    expect(screen.getByTestId("blast-reads")).not.toBeNull();
    expect(screen.queryByTestId("blast-selection")).toBeNull();
    expect(screen.queryByTestId("cg-creation")).toBeNull();
  });

  it("renders nothing for a visible modal name the switch does not handle", () => {
    const { container } = renderManager({
      modalsVisible: { ...ALL_HIDDEN, consensusGenomeError: true },
    });

    expect(container.innerHTML).toBe("");
  });

  it("passes blast data to the selection modal and closes it through handleModalAction", () => {
    const { handleModalAction, handleBlastSelectionModalContinue } =
      renderManager({
        modalsVisible: { ...ALL_HIDDEN, blastSelection: true },
      });

    const modal = screen.getByTestId("blast-selection");
    expect(modal.getAttribute("data-open")).toBe("true");
    expect(modal.getAttribute("data-taxon-name")).toBe("Klebsiella");

    fireEvent.click(screen.getByTestId("blast-selection-continue"));
    expect(handleBlastSelectionModalContinue).toHaveBeenCalledWith({
      shouldBlastContigs: true,
    });

    fireEvent.click(screen.getByTestId("blast-selection-close"));
    expect(handleModalAction).toHaveBeenCalledWith([
      ["close", "blastSelection"],
    ]);
  });

  it("passes taxon/sample context to the blast contigs modal", () => {
    const { handleModalAction } = renderManager({
      modalsVisible: { ...ALL_HIDDEN, blastContigs: true },
    });

    const modal = screen.getByTestId("blast-contigs");
    expect(modal.getAttribute("data-taxon-id")).toBe("570");
    expect(modal.getAttribute("data-sample-id")).toBe("12");
    expect(modal.getAttribute("data-pipeline-version")).toBe("8.1");
    expect(modal.getAttribute("data-context")).toBe("ctx");

    fireEvent.click(screen.getByTestId("blast-contigs-close"));
    expect(handleModalAction).toHaveBeenCalledWith([["close", "blastContigs"]]);
  });

  it("passes the taxon level through to the blast reads modal", () => {
    const { handleModalAction } = renderManager({
      modalsVisible: { ...ALL_HIDDEN, blastReads: true },
    });

    expect(
      screen.getByTestId("blast-reads").getAttribute("data-taxon-level"),
    ).toBe("2");

    fireEvent.click(screen.getByTestId("blast-reads-close"));
    expect(handleModalAction).toHaveBeenCalledWith([["close", "blastReads"]]);
  });

  it("falls back to undefined blast fields when blastData is an empty object", () => {
    renderManager({
      blastData: {},
      modalsVisible: { ...ALL_HIDDEN, blastContigs: true },
    });

    const modal = screen.getByTestId("blast-contigs");
    expect(modal.getAttribute("data-taxon-id")).toBe("undefined");
    expect(modal.getAttribute("data-taxon-name")).toBe("undefined");
    expect(modal.getAttribute("data-context")).toBe("undefined");
  });

  it("wires the consensus genome creation modal to its data and kickoff handler", () => {
    const { handleModalAction, handleConsensusGenomeKickoff } = renderManager({
      modalsVisible: { ...ALL_HIDDEN, consensusGenomeCreation: true },
    });

    expect(
      screen.getByTestId("cg-creation").getAttribute("data-cg-taxid"),
    ).toBe("111");

    fireEvent.click(screen.getByTestId("cg-creation-kickoff"));
    expect(handleConsensusGenomeKickoff).toHaveBeenCalledWith({ id: 12 });

    fireEvent.click(screen.getByTestId("cg-creation-close"));
    expect(handleModalAction).toHaveBeenCalledWith([
      ["close", "consensusGenomeCreation"],
    ]);
  });

  it("wires the previous consensus genome modal to new/row-click handlers", () => {
    const {
      handleModalAction,
      handleConsensusGenomeClick,
      handlePreviousConsensusGenomeReportClick,
    } = renderManager({
      modalsVisible: { ...ALL_HIDDEN, consensusGenomePrevious: true },
    });

    expect(
      screen.getByTestId("cg-previous").getAttribute("data-cg-taxid"),
    ).toBe("222");

    fireEvent.click(screen.getByTestId("cg-previous-new"));
    expect(handleConsensusGenomeClick).toHaveBeenCalledWith({ taxId: 99 });

    fireEvent.click(screen.getByTestId("cg-previous-row"));
    expect(handlePreviousConsensusGenomeReportClick).toHaveBeenCalledWith({
      rowData: { id: 7 },
    });

    fireEvent.click(screen.getByTestId("cg-previous-close"));
    expect(handleModalAction).toHaveBeenCalledWith([
      ["close", "consensusGenomePrevious"],
    ]);
  });
});
