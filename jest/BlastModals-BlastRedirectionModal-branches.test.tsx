// Branch coverage for
// app/assets/src/components/views/SampleView/components/ModalManager/components/BlastModals/BlastRedirectionModal.tsx
//
// The redirection modal had no spec at all, so its one conditional
//
//   {shouldOpenMultipleTabs && (<multiple-tabs notice/>)}
//
// had neither arm exercised. Both arms are covered here, plus the checkbox
// state that decides what value the Continue handler reports back.
import { fireEvent, render, screen } from "@testing-library/react";
import BlastRedirectionModal from "~/components/views/SampleView/components/ModalManager/components/BlastModals/BlastRedirectionModal";

const MULTI_TAB_NOTICE = /Multiple tabs will open/;

const renderModal = (props: $TSFixMe = {}) => {
  const onClose = jest.fn();
  const onContinue = jest.fn();
  const utils = render(
    <BlastRedirectionModal
      open
      onClose={onClose}
      onContinue={onContinue}
      {...props}
    />,
  );
  return { ...utils, onClose, onContinue };
};

describe("BlastRedirectionModal multiple-tab notice", () => {
  it("omits the multiple-tab notice by default", () => {
    renderModal();

    expect(screen.queryByText(MULTI_TAB_NOTICE)).toBeNull();
    // The rest of the modal is present, so the absence is the flag, not a
    // failure to render.
    expect(screen.getByText("You are now leaving SeqtoID.")).toBeTruthy();
  });

  it("shows the multiple-tab notice when the BLAST URL must be split", () => {
    renderModal({ shouldOpenMultipleTabs: true });

    expect(screen.getByText(MULTI_TAB_NOTICE)).toBeTruthy();
  });

  it("omits the notice when the flag is explicitly false", () => {
    renderModal({ shouldOpenMultipleTabs: false });

    expect(screen.queryByText(MULTI_TAB_NOTICE)).toBeNull();
  });
});

describe("BlastRedirectionModal actions", () => {
  it("continues with auto-redirect off until the checkbox is ticked", () => {
    const { onContinue } = renderModal();

    fireEvent.click(screen.getByText("Continue"));
    expect(onContinue).toHaveBeenCalledWith(false);
  });

  it("continues with auto-redirect on after the checkbox is ticked", () => {
    const { onContinue } = renderModal();

    const checkbox = document.querySelector(
      "input[type='checkbox']",
    ) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    fireEvent.click(screen.getByText("Continue"));
    expect(onContinue).toHaveBeenCalledWith(true);
  });

  it("cancels without reporting a redirect preference", () => {
    const { onClose, onContinue } = renderModal();

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
    expect(onContinue).not.toHaveBeenCalled();
  });
});
