// Coverage: app/assets/src/components/ui/controls/EditableInput.tsx
//
// Complements jest/ui-controls-EditableInput.test.tsx by driving the paths that
// spec leaves alone: the document-level mousedown handler installed while the
// input is visible (click inside vs. click outside), the non-Enter key branches
// of both key handlers, the focus/blur hover branch, and the interaction
// between a lingering warning and a subsequent successful commit.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import EditableInput from "~/components/ui/controls/EditableInput";

const getInput = (): HTMLInputElement =>
  document.querySelector("input") as HTMLInputElement;

const renderEditable = (props: Record<string, unknown> = {}) =>
  render(
    <EditableInput
      value="Original"
      onDoneEditing={jest.fn().mockResolvedValue(["", "Original"])}
      getWarningMessage={() => ""}
      {...props}
    />,
  );

describe("EditableInput outside-click and key handling", () => {
  it("commits the edit when the user mousedowns outside the input", async () => {
    const onDoneEditing = jest.fn().mockResolvedValue(["", "Committed"]);
    renderEditable({ onDoneEditing });

    fireEvent.click(screen.getByText("Original"));
    fireEvent.change(getInput(), { target: { value: "Edited" } });

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);

    await waitFor(() => expect(onDoneEditing).toHaveBeenCalledWith("Edited"));
    await waitFor(() => expect(getInput()).toBeNull());
    expect(screen.getByText("Committed")).toBeTruthy();
    document.body.removeChild(outside);
  });

  it("does not commit when the mousedown lands inside the input container", () => {
    const onDoneEditing = jest.fn().mockResolvedValue(["", "Original"]);
    renderEditable({ onDoneEditing });

    fireEvent.click(screen.getByText("Original"));
    fireEvent.mouseDown(getInput());

    expect(onDoneEditing).not.toHaveBeenCalled();
    expect(getInput()).toBeTruthy();
  });

  it("keeps the input open and shows the error when an outside click fails validation", async () => {
    const onDoneEditing = jest.fn().mockResolvedValue(["Name required", ""]);
    renderEditable({ onDoneEditing });

    fireEvent.click(screen.getByText("Original"));
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);

    await waitFor(() => expect(screen.getByText("Name required")).toBeTruthy());
    expect(getInput()).toBeTruthy();
    document.body.removeChild(outside);
  });

  it("stops listening for outside clicks once the edit is committed", async () => {
    const onDoneEditing = jest.fn().mockResolvedValue(["", "Done"]);
    renderEditable({ onDoneEditing });

    fireEvent.click(screen.getByText("Original"));
    const outside = document.createElement("div");
    document.body.appendChild(outside);
    fireEvent.mouseDown(outside);
    await waitFor(() => expect(getInput()).toBeNull());

    onDoneEditing.mockClear();
    fireEvent.mouseDown(outside);
    expect(onDoneEditing).not.toHaveBeenCalled();
    document.body.removeChild(outside);
  });

  it("ignores non-Enter keypresses inside the input", () => {
    const onDoneEditing = jest.fn().mockResolvedValue(["", "Original"]);
    renderEditable({ onDoneEditing });

    fireEvent.click(screen.getByText("Original"));
    fireEvent.keyPress(getInput(), { key: "a", charCode: 97 });

    expect(onDoneEditing).not.toHaveBeenCalled();
    expect(getInput()).toBeTruthy();
  });

  it("ignores non-Enter keydowns on the read-only display", () => {
    renderEditable();
    const display = screen.getByText("Original").parentElement as HTMLElement;
    fireEvent.keyDown(display, { key: "Escape" });
    expect(getInput()).toBeNull();
  });

  it("reveals the edit affordance on focus and hides it again on blur", () => {
    renderEditable();
    const display = screen.getByText("Original").parentElement as HTMLElement;

    expect(document.querySelector("button")).toBeNull();
    fireEvent.focus(display);
    expect(document.querySelector("button")).toBeTruthy();
    fireEvent.blur(display);
    expect(document.querySelector("button")).toBeNull();
  });

  it("clears a pending warning once the commit succeeds", async () => {
    const getWarningMessage = jest
      .fn()
      .mockImplementation((val: string) => (val === "Odd" ? "Looks odd" : ""));
    const onDoneEditing = jest.fn().mockResolvedValue(["", "Odd"]);
    renderEditable({ getWarningMessage, onDoneEditing });

    fireEvent.click(screen.getByText("Original"));
    fireEvent.change(getInput(), { target: { value: "Odd" } });
    expect(screen.getByText("Looks odd")).toBeTruthy();

    fireEvent.keyPress(getInput(), { key: "Enter", charCode: 13 });
    await waitFor(() => expect(getInput()).toBeNull());
    // Warning is dropped along with the input on a successful commit.
    expect(screen.queryByText("Looks odd")).toBeNull();
    expect(screen.getByText("Odd")).toBeTruthy();
  });

  it("renders a numeric value and mirrors a numeric update from props", () => {
    const { rerender } = render(
      <EditableInput
        value={42}
        onDoneEditing={jest.fn().mockResolvedValue(["", "42"])}
        getWarningMessage={() => ""}
      />,
    );
    expect(screen.getByText("42")).toBeTruthy();
    rerender(
      <EditableInput
        value={43}
        onDoneEditing={jest.fn().mockResolvedValue(["", "43"])}
        getWarningMessage={() => ""}
      />,
    );
    expect(screen.getByText("43")).toBeTruthy();
  });
});
