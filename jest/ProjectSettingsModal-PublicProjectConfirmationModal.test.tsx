// Coverage: .../DiscoveryView/components/ProjectHeader/components/ProjectSettingsModal/PublicProjectConfirmationModal.tsx
//
// A small class component: a trigger button opens an irreversible-action
// confirmation modal, Cancel closes it without notifying anyone and "Make
// Project Public" closes it and then invokes onConfirm (via the setState
// callback, so ordering matters).
import { fireEvent, render, screen } from "@testing-library/react";
import PublicProjectConfirmationModal from "~/components/views/DiscoveryView/components/ProjectHeader/components/ProjectSettingsModal/PublicProjectConfirmationModal";

const project = { id: "12", name: "Nasal Swabs", public_access: 0 };

const renderModal = (props: $TSFixMe = {}) => {
  const onConfirm = props.onConfirm || jest.fn();
  const utils = render(
    <PublicProjectConfirmationModal
      onConfirm={onConfirm}
      project={project}
      trigger={<span>Change to public</span>}
      {...props}
    />,
  );
  return { ...utils, onConfirm };
};

const openModal = () => fireEvent.click(screen.getByText("Change to public"));

describe("PublicProjectConfirmationModal closed state", () => {
  it("renders only the trigger before it is opened", () => {
    renderModal();
    expect(screen.getByText("Change to public")).toBeTruthy();
    expect(screen.queryByText("Make Project Public")).toBeNull();
    expect(screen.queryByText("Cancel")).toBeNull();
  });

  it("renders an empty trigger button when no trigger is given", () => {
    render(
      <PublicProjectConfirmationModal
        onConfirm={jest.fn()}
        project={project}
      />,
    );
    const button = document.querySelector("button.noStyle") as HTMLElement;
    expect(button).toBeTruthy();
    expect(button.textContent).toBe("");
  });
});

describe("PublicProjectConfirmationModal open state", () => {
  it("shows the project name, the irreversibility warning and both policy links", () => {
    renderModal();
    openModal();

    expect(screen.getByText("Nasal Swabs")).toBeTruthy();
    expect(screen.getByText("not reversible")).toBeTruthy();
    expect(screen.getByText("Make Project Public")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();

    const hrefs = Array.from(document.querySelectorAll("a")).map(a =>
      a.getAttribute("href"),
    );
    expect(hrefs).toContain("/privacy");
    expect(hrefs).toContain("/terms");
  });
});

describe("PublicProjectConfirmationModal actions", () => {
  it("closes without confirming when Cancel is pressed", () => {
    const { onConfirm } = renderModal();
    openModal();
    fireEvent.click(screen.getByText("Cancel"));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.queryByText("Make Project Public")).toBeNull();
  });

  it("closes and then invokes onConfirm when the public action is pressed", () => {
    const onConfirm = jest.fn(() => {
      // The modal is already closed by the time the callback runs.
      expect(screen.queryByText("Cancel")).toBeNull();
    });
    renderModal({ onConfirm });
    openModal();
    fireEvent.click(screen.getByText("Make Project Public"));

    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Make Project Public")).toBeNull();
  });

  it("can be reopened after being cancelled", () => {
    renderModal();
    openModal();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByText("Cancel")).toBeNull();

    openModal();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });
});
