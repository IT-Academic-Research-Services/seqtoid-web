// Coverage: app/assets/src/components/ui/controls/EditableInput.tsx
//
// EditableInput swaps between a read-only display and an editable Input. It
// commits edits through an async onDoneEditing that returns [error, sanitized]
// tuples, surfaces warnings from getWarningMessage while typing, and mirrors the
// value prop into local state. These tests drive the display->edit toggle, the
// hover/edit-icon branch, the success + error commit paths, the warning branch,
// and the value-prop sync.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import EditableInput from "~/components/ui/controls/EditableInput";

const _React: typeof React = React;

const getInput = (): HTMLInputElement =>
  document.querySelector("input") as HTMLInputElement;

describe("EditableInput", () => {
  it("shows the value as read-only text and reveals the edit icon on hover", () => {
    render(
      <EditableInput
        value="Project A"
        onDoneEditing={jest.fn().mockResolvedValue(["", "Project A"])}
        getWarningMessage={() => ""}
      />,
    );
    expect(screen.getByText("Project A")).toBeTruthy();
    // No input while in display mode.
    expect(getInput()).toBeNull();

    const display = screen.getByText("Project A").parentElement as HTMLElement;
    fireEvent.mouseEnter(display);
    // Edit affordance (a button) appears while hovered.
    expect(document.querySelector("button")).toBeTruthy();
    fireEvent.mouseLeave(display);
  });

  it("switches to an editable input when the display is clicked", () => {
    render(
      <EditableInput
        value="Project A"
        onDoneEditing={jest.fn().mockResolvedValue(["", "Project A"])}
        getWarningMessage={() => ""}
      />,
    );
    fireEvent.click(screen.getByText("Project A"));
    expect(getInput()).toBeTruthy();
    expect(getInput().value).toBe("Project A");
  });

  it("commits on Enter and returns to display mode with the sanitized text", async () => {
    const onDoneEditing = jest.fn().mockResolvedValue(["", "Cleaned Name"]);
    render(
      <EditableInput
        value="Raw Name"
        onDoneEditing={onDoneEditing}
        getWarningMessage={() => ""}
      />,
    );
    fireEvent.click(screen.getByText("Raw Name"));
    fireEvent.change(getInput(), { target: { value: "Typed Name" } });
    fireEvent.keyPress(getInput(), { key: "Enter", charCode: 13 });

    await waitFor(() =>
      expect(onDoneEditing).toHaveBeenCalledWith("Typed Name"),
    );
    // Success (empty error) collapses back to display mode with sanitized text.
    await waitFor(() => expect(getInput()).toBeNull());
    expect(screen.getByText("Cleaned Name")).toBeTruthy();
  });

  it("keeps the input open and shows the error when the commit fails", async () => {
    const onDoneEditing = jest
      .fn()
      .mockResolvedValue(["That name is taken", ""]);
    render(
      <EditableInput
        value="Dup"
        onDoneEditing={onDoneEditing}
        getWarningMessage={() => ""}
      />,
    );
    fireEvent.click(screen.getByText("Dup"));
    fireEvent.keyPress(getInput(), { key: "Enter", charCode: 13 });

    await waitFor(() =>
      expect(screen.getByText("That name is taken")).toBeTruthy(),
    );
    // Error path leaves the input visible for correction.
    expect(getInput()).toBeTruthy();
  });

  it("surfaces a warning message while typing and clears any prior error", () => {
    const getWarningMessage = jest.fn().mockReturnValue("Name is quite long");
    render(
      <EditableInput
        value="Short"
        onDoneEditing={jest.fn().mockResolvedValue(["", "Short"])}
        getWarningMessage={getWarningMessage}
      />,
    );
    fireEvent.click(screen.getByText("Short"));
    fireEvent.change(getInput(), { target: { value: "A very long name" } });

    expect(getWarningMessage).toHaveBeenCalledWith("A very long name");
    expect(screen.getByText("Name is quite long")).toBeTruthy();
  });

  it("mirrors a changed value prop into the displayed text", () => {
    const { rerender } = render(
      <EditableInput
        value="Before"
        onDoneEditing={jest.fn().mockResolvedValue(["", "Before"])}
        getWarningMessage={() => ""}
      />,
    );
    expect(screen.getByText("Before")).toBeTruthy();
    rerender(
      <EditableInput
        value="After"
        onDoneEditing={jest.fn().mockResolvedValue(["", "After"])}
        getWarningMessage={() => ""}
      />,
    );
    expect(screen.getByText("After")).toBeTruthy();
  });

  it("enters edit mode when Enter is pressed on the focused display element", () => {
    render(
      <EditableInput
        value="KeyNav"
        onDoneEditing={jest.fn().mockResolvedValue(["", "KeyNav"])}
        getWarningMessage={() => ""}
      />,
    );
    const display = screen.getByText("KeyNav").parentElement as HTMLElement;
    fireEvent.keyDown(display, { key: "Enter" });
    expect(getInput()).toBeTruthy();
  });
});
