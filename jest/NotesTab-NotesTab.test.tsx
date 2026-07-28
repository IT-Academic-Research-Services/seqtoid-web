// Coverage: app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/components/NotesTab/NotesTab.tsx
//
// NotesTab reads the notes off a Relay fragment (only when a key is supplied),
// shows "No data" for empty notes vs the note body otherwise, and swaps in a
// Textarea while editing that mirrors keystrokes into local state and saves on
// blur. react-relay is stubbed (the key already IS the data), and the
// MetadataSection wrapper + Textarea are stubbed so the assertions land on
// NotesTab's own empty/populated/editing branches.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const mockSectionProps: Record<string, unknown>[] = [];

jest.mock("react-relay", () => ({
  graphql: () => ({}),
  useFragment: (_fragment: unknown, key: unknown) => key,
}));

jest.mock(
  "~/components/common/DetailsSidebar/SampleDetailsMode/MetadataSection",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: Record<string, unknown>) => {
        mockSectionProps.push(props);
        return ReactLib.createElement(
          "div",
          { "data-testid": "metadata-section" },
          ReactLib.createElement(
            "span",
            { "data-testid": "section-editable" },
            String(props.editable),
          ),
          ReactLib.createElement(
            "span",
            { "data-testid": "section-always-show" },
            String(props.alwaysShowEditLink),
          ),
          ReactLib.createElement(
            "button",
            {
              "data-testid": "toggle-edit",
              onClick: props.onEditToggle as () => void,
            },
            "toggle",
          ),
          props.children as React.ReactNode,
        );
      },
    };
  },
);

jest.mock("~/components/ui/controls/Textarea", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: Record<string, $TSFixMe>) =>
      ReactLib.createElement("textarea", {
        "data-testid": "notes-textarea",
        value: props.value,
        onChange: (e: $TSFixMe) => props.onChange(e.target.value),
        onBlur: props.onBlur,
      }),
  };
});

import { NotesTab } from "~/components/common/DetailsSidebar/SampleDetailsMode/components/NotesTab/NotesTab";

const renderTab = (props: Record<string, unknown> = {}) => {
  const onNoteChange = jest.fn();
  const onNoteSave = jest.fn().mockResolvedValue(undefined);
  const utils = render(
    <NotesTab
      notesFragmentKey={
        {
          additional_info: { notes: "some note", editable: true },
        } as $TSFixMe
      }
      onNoteChange={onNoteChange}
      onNoteSave={onNoteSave}
      savePending={false}
      {...(props as $TSFixMe)}
    />,
  );
  return { onNoteChange, onNoteSave, ...utils };
};

describe("NotesTab", () => {
  beforeEach(() => {
    mockSectionProps.length = 0;
  });

  it("renders the note body and marks the section editable when notes exist", () => {
    renderTab();
    expect(screen.getByText("some note")).toBeTruthy();
    expect(screen.queryByText("No data")).toBeNull();
    expect(screen.getByTestId("section-editable").textContent).toBe("true");
    // Non-empty notes -> the edit link is NOT force-shown.
    expect(screen.getByTestId("section-always-show").textContent).toBe("false");
  });

  it("renders 'No data' and force-shows the edit link when notes are empty", () => {
    renderTab({
      notesFragmentKey: {
        additional_info: { notes: "", editable: true },
      },
    });
    expect(screen.getByText("No data")).toBeTruthy();
    expect(screen.getByTestId("section-always-show").textContent).toBe("true");
  });

  it("handles a null fragment key (no fragment read) as empty notes", () => {
    renderTab({ notesFragmentKey: null });
    expect(screen.getByText("No data")).toBeTruthy();
    // editable is undefined because there is no data.
    expect(screen.getByTestId("section-editable").textContent).toBe(
      "undefined",
    );
  });

  it("shows a Textarea while editing that saves local notes on blur", () => {
    const { onNoteChange, onNoteSave } = renderTab();
    // Not editing yet -> no textarea, note body visible.
    expect(screen.queryByTestId("notes-textarea")).toBeNull();

    fireEvent.click(screen.getByTestId("toggle-edit"));
    const textarea = screen.getByTestId(
      "notes-textarea",
    ) as HTMLTextAreaElement;
    expect(textarea.value).toBe("some note");

    fireEvent.change(textarea, { target: { value: "updated note" } });
    expect(onNoteChange).toHaveBeenCalledWith("updated note");
    // Local state updated -> textarea reflects the new value.
    expect(
      (screen.getByTestId("notes-textarea") as HTMLTextAreaElement).value,
    ).toBe("updated note");

    fireEvent.blur(textarea);
    expect(onNoteSave).toHaveBeenCalledWith("updated note");
  });

  it("uses an empty string for the textarea when local notes are undefined", () => {
    renderTab({
      notesFragmentKey: {
        additional_info: { notes: null, editable: true },
      },
    });
    fireEvent.click(screen.getByTestId("toggle-edit"));
    expect(
      (screen.getByTestId("notes-textarea") as HTMLTextAreaElement).value,
    ).toBe("");
  });
});
