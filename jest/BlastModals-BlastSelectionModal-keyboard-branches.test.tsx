// Branch coverage for
// app/assets/src/components/views/SampleView/components/ModalManager/components/BlastModals/BlastSelectionModal.tsx
//
// Each BLAST option div carries the same disabled-guard ternary on two handlers:
//
//   onClick={() =>   blastOptionIsDisabled ? null : setBlastOptionSelected(blastType)}
//   onKeyDown={() => blastOptionIsDisabled ? null : setBlastOptionSelected(blastType)}
//
// The existing spec drives only the onClick copy, leaving both arms of the
// onKeyDown ternary unexercised. Since the option is a role="button" div, the
// keyboard path is the accessible way to pick a BLAST type -- and it must honour
// the same "blastn is unavailable without an NT hit" rule as the mouse path.
import { fireEvent, render, screen } from "@testing-library/react";
import { BlastSelectionModal } from "~/components/views/SampleView/components/ModalManager/components/BlastModals/BlastSelectionModal";

const renderModal = (taxonStatsByCountType: $TSFixMe) => {
  const onContinue = jest.fn();
  const onClose = jest.fn();
  const utils = render(
    <BlastSelectionModal
      open
      onContinue={onContinue}
      onClose={onClose}
      taxonName="Klebsiella pneumoniae"
      taxonStatsByCountType={taxonStatsByCountType}
    />,
  );
  return { ...utils, onContinue, onClose };
};

const option = (blastType: string) =>
  screen.getByText(blastType).closest("[role='button']") as HTMLElement;

const continueButton = () =>
  screen.getByText("Continue").closest("button") as HTMLButtonElement;

const NT_HIT = { ntContigs: 3, ntReads: 50, nrContigs: 1, nrReads: 20 };
const NR_ONLY = { ntContigs: 0, ntReads: 0, nrContigs: 2, nrReads: 30 };

describe("BlastSelectionModal keyboard selection", () => {
  it("selects an enabled option on keydown", () => {
    const { onContinue } = renderModal(NT_HIT);

    expect(continueButton().disabled).toBe(true);
    fireEvent.keyDown(option("blastn"), { key: "Enter", code: "Enter" });
    expect(continueButton().disabled).toBe(false);

    fireEvent.click(continueButton());
    expect(onContinue).toHaveBeenCalledWith({
      selectedBlastType: "blastn",
      shouldBlastContigs: true,
      showCountTypeTabs: false,
    });
  });

  it("ignores keydown on an option disabled for want of an NT hit", () => {
    // blastn is disabled when the taxon has neither NT contigs nor NT reads.
    renderModal(NR_ONLY);

    fireEvent.keyDown(option("blastn"), { key: "Enter", code: "Enter" });

    // Nothing was selected, so Continue stays disabled.
    expect(continueButton().disabled).toBe(true);
  });

  it("still allows blastx by keyboard for an NR-only taxon", () => {
    // Contrast for the guard above: blastx is never disabled, so the same
    // keystroke on the neighbouring option does select.
    const { onContinue } = renderModal(NR_ONLY);

    fireEvent.keyDown(option("blastx"), { key: "Enter", code: "Enter" });
    expect(continueButton().disabled).toBe(false);

    fireEvent.click(continueButton());
    expect(onContinue).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedBlastType: "blastx",
        shouldBlastContigs: true,
        showCountTypeTabs: true,
        availableCountTypeTabsForContigs: ["NR"],
        availableCountTypeTabsForReads: ["NR"],
      }),
    );
  });

  it("lets the keyboard move the selection from one option to the other", () => {
    const { onContinue } = renderModal(NT_HIT);

    fireEvent.keyDown(option("blastn"), { key: "Enter", code: "Enter" });
    fireEvent.keyDown(option("blastx"), { key: "Enter", code: "Enter" });

    fireEvent.click(continueButton());
    // The later keystroke wins -- the modal reports blastx, not blastn.
    expect(onContinue).toHaveBeenCalledTimes(1);
    expect(onContinue.mock.calls[0][0].selectedBlastType).toBe("blastx");
  });
});
