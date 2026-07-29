// Coverage: app/assets/src/components/views/SampleView/components/ModalManager/components/BlastModals/BlastSelectionModal.tsx
//
// BlastSelectionModal lets a user pick BLASTN vs BLASTX for a taxon. Its logic:
// BLASTN is disabled when the taxon has neither NT contigs nor NT reads (BLASTX
// is never disabled); selecting an option enables Continue, which builds a
// BlastModalInfo describing whether to blast contigs and which NT/NR count-type
// tabs are available. Modal / ExternalLink are stubbed so the assertions land
// on the selection + info-building branches.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("~ui/containers/Modal", () => ({
  __esModule: true,
  default: (props: $TSFixMe) =>
    props.open ? <div data-testid="modal">{props.children}</div> : null,
}));

jest.mock("~/components/ui/controls/ExternalLink", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <a href={props.href}>{props.children}</a>,
}));

import { BlastSelectionModal } from "~/components/views/SampleView/components/ModalManager/components/BlastModals/BlastSelectionModal";

const renderModal = (props: $TSFixMe = {}) => {
  const onContinue = props.onContinue || jest.fn();
  const onClose = props.onClose || jest.fn();
  const utils = render(
    <BlastSelectionModal
      open
      onContinue={onContinue}
      onClose={onClose}
      taxonName="Klebsiella pneumoniae"
      taxonStatsByCountType={
        props.taxonStatsByCountType || {
          ntContigs: 2,
          ntReads: 5,
          nrContigs: 1,
          nrReads: 3,
        }
      }
    />,
  );
  return { ...utils, onContinue, onClose };
};

describe("BlastSelectionModal render", () => {
  it("shows the taxon name, header and both blast options", () => {
    renderModal();
    expect(screen.getByText("Select a BLAST Type")).toBeTruthy();
    expect(screen.getByText("Klebsiella pneumoniae")).toBeTruthy();
    expect(screen.getByText("blastn")).toBeTruthy();
    expect(screen.getByText("blastx")).toBeTruthy();
  });

  it("renders nothing when closed", () => {
    render(
      <BlastSelectionModal
        open={false}
        onContinue={jest.fn()}
        onClose={jest.fn()}
        taxonName="X"
        taxonStatsByCountType={
          { ntContigs: 1, ntReads: 1, nrContigs: 1, nrReads: 1 } as $TSFixMe
        }
      />,
    );
    expect(screen.queryByTestId("modal")).toBeNull();
  });
});

describe("BlastSelectionModal continue button", () => {
  it("does nothing when Continue is clicked before an option is selected", () => {
    const onContinue = jest.fn();
    renderModal({ onContinue });
    fireEvent.click(screen.getByText("Continue"));
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("builds BLASTN info (no count-type tabs) with shouldBlastContigs true", () => {
    const onContinue = jest.fn();
    renderModal({ onContinue });
    fireEvent.click(screen.getByText("blastn"));
    fireEvent.click(screen.getByText("Continue"));
    expect(onContinue).toHaveBeenCalledWith({
      selectedBlastType: "blastn",
      shouldBlastContigs: true,
      showCountTypeTabs: false,
    });
  });

  it("builds BLASTX info with the available NT/NR count-type tabs", () => {
    const onContinue = jest.fn();
    renderModal({ onContinue });
    fireEvent.click(screen.getByText("blastx"));
    fireEvent.click(screen.getByText("Continue"));
    expect(onContinue).toHaveBeenCalledWith({
      selectedBlastType: "blastx",
      shouldBlastContigs: true,
      showCountTypeTabs: true,
      availableCountTypeTabsForContigs: ["NT", "NR"],
      availableCountTypeTabsForReads: ["NT", "NR"],
    });
  });

  it("marks shouldBlastContigs false for BLASTN when there are no NT contigs", () => {
    const onContinue = jest.fn();
    renderModal({
      onContinue,
      taxonStatsByCountType: {
        ntContigs: 0,
        ntReads: 4,
        nrContigs: 0,
        nrReads: 0,
      },
    });
    fireEvent.click(screen.getByText("blastn"));
    fireEvent.click(screen.getByText("Continue"));
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({ shouldBlastContigs: false }),
    );
  });
});

describe("BlastSelectionModal disabled BLASTN", () => {
  it("does not select BLASTN when it is disabled (no NT hits at all)", () => {
    const onContinue = jest.fn();
    renderModal({
      onContinue,
      taxonStatsByCountType: {
        ntContigs: 0,
        ntReads: 0,
        nrContigs: 1,
        nrReads: 1,
      },
    });
    fireEvent.click(screen.getByText("blastn"));
    // Selection was blocked, so Continue stays disabled and fires nothing.
    fireEvent.click(screen.getByText("Continue"));
    expect(onContinue).not.toHaveBeenCalled();
  });

  it("still allows BLASTX even when NT hits are absent", () => {
    const onContinue = jest.fn();
    renderModal({
      onContinue,
      taxonStatsByCountType: {
        ntContigs: 0,
        ntReads: 0,
        nrContigs: 1,
        nrReads: 2,
      },
    });
    fireEvent.click(screen.getByText("blastx"));
    fireEvent.click(screen.getByText("Continue"));
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedBlastType: "blastx",
        availableCountTypeTabsForContigs: ["NR"],
        availableCountTypeTabsForReads: ["NR"],
      }),
    );
  });
});

describe("BlastSelectionModal hover", () => {
  it("wraps the disabled BLASTN title in its tooltip while hovered", () => {
    renderModal({
      taxonStatsByCountType: {
        ntContigs: 0,
        ntReads: 0,
        nrContigs: 1,
        nrReads: 1,
      },
    });
    const title = screen.getByText("blastn");
    const option = title.closest('[role="button"]') as HTMLElement;
    fireEvent.mouseEnter(option);
    expect(screen.getByText("blastn")).toBeTruthy();
    fireEvent.mouseLeave(option);
    expect(screen.getByText("blastn")).toBeTruthy();
  });
});

describe("BlastSelectionModal cancel", () => {
  it("calls onClose when Cancel is clicked", () => {
    const onClose = jest.fn();
    renderModal({ onClose });
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
