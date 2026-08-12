// Coverage: app/assets/src/components/views/DiscoveryView/components/DiscoverySidebar/components/ProjectDescription/ProjectDescription.tsx
//
// ProjectDescription is a class component that shows a project's description and
// lets editors change it. MetadataSection (its wrapper) and Textarea are stubbed
// so the tests can drive the edit/save state machine directly, and the
// saveProjectDescription API call is mocked so the success/failure branches of
// _save (which revert on failure) are both exercised.
import { act, fireEvent, render, screen } from "@testing-library/react";

const mockSaveProjectDescription = jest.fn();

jest.mock("~/api", () => ({
  __esModule: true,
  saveProjectDescription: (...args: $TSFixMe[]) =>
    mockSaveProjectDescription(...args),
}));

// MetadataSection just wraps children with an edit toggle; expose the toggle and
// the editable/savePending state it receives.
jest.mock(
  "~/components/common/DetailsSidebar/SampleDetailsMode/MetadataSection",
  () => ({
    __esModule: true,
    default: ({ children, editable, onEditToggle, savePending }: $TSFixMe) => {
      const ReactLib = require("react");
      return ReactLib.createElement(
        "div",
        {
          "data-testid": "metadata-section",
          "data-editable": String(editable),
          "data-savepending": String(savePending),
        },
        ReactLib.createElement("button", {
          "data-testid": "edit-toggle",
          onClick: onEditToggle,
        }),
        children,
      );
    },
  }),
);

jest.mock("~ui/controls/Textarea", () => ({
  __esModule: true,
  default: ({ value, onChange, onBlur, maxLength }: $TSFixMe) => {
    const ReactLib = require("react");
    return ReactLib.createElement("textarea", {
      "data-testid": "textarea",
      "data-maxlength": String(maxLength),
      value,
      onChange: (e: $TSFixMe) => onChange(e.target.value),
      onBlur,
    });
  },
}));

import { ProjectDescription } from "~/components/views/DiscoveryView/components/DiscoverySidebar/components/ProjectDescription/ProjectDescription";

beforeEach(() => {
  jest.clearAllMocks();
  mockSaveProjectDescription.mockResolvedValue({ status: "ok" });
});

const renderPD = (project: $TSFixMe = {}, onSave?: $TSFixMe) =>
  render(
    <ProjectDescription
      project={{ id: 1, name: "P", ...project }}
      onProjectDescriptionSave={onSave}
    />,
  );

describe("ProjectDescription read view", () => {
  it("shows the description text when present", () => {
    renderPD({ description: "A tidy little project." });
    expect(screen.getByTestId("project-description").textContent).toBe(
      "A tidy little project.",
    );
  });

  it("shows the empty-state message when there is no description", () => {
    renderPD({ description: "" });
    expect(screen.getByText("No description.")).toBeTruthy();
    expect(screen.queryByTestId("project-description")).toBeNull();
  });

  it("passes editable through to the metadata section", () => {
    renderPD({ description: "x", editable: true });
    expect(
      screen.getByTestId("metadata-section").getAttribute("data-editable"),
    ).toBe("true");
  });
});

describe("ProjectDescription truncation", () => {
  // MAX_DESCRIPTION_LENGTH cutoff is length/2; a long string trips truncation.
  const longText = "z".repeat(4000);

  it("offers a Show More toggle for long descriptions and flips the label", () => {
    renderPD({ description: longText });
    expect(screen.getByText("Show More")).toBeTruthy();
    fireEvent.click(screen.getByText("Show More"));
    expect(screen.getByText("Show Less")).toBeTruthy();
    fireEvent.click(screen.getByText("Show Less"));
    expect(screen.getByText("Show More")).toBeTruthy();
  });

  it("does not offer a toggle for short descriptions", () => {
    renderPD({ description: "short" });
    expect(screen.queryByText("Show More")).toBeNull();
  });
});

describe("ProjectDescription editing", () => {
  it("switches to the textarea when editing is toggled on", () => {
    renderPD({ description: "hello", editable: true });
    expect(screen.queryByTestId("textarea")).toBeNull();
    fireEvent.click(screen.getByTestId("edit-toggle"));
    const textarea = screen.getByTestId("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("hello");
    expect(screen.getByText(/characters remaining/)).toBeTruthy();
  });

  it("updates the character counter as the text changes", () => {
    renderPD({ description: "", editable: true });
    fireEvent.click(screen.getByTestId("edit-toggle"));
    fireEvent.change(screen.getByTestId("textarea"), {
      target: { value: "abcde" },
    });
    // MAX_DESCRIPTION_LENGTH (700) - 5 chars = 695 remaining.
    expect(screen.getByText(/695\/700 characters remaining/)).toBeTruthy();
  });
});

describe("ProjectDescription save", () => {
  it("saves on blur and notifies the parent when the text changed", async () => {
    const onSave = jest.fn();
    mockSaveProjectDescription.mockResolvedValue({ status: "ok" });
    renderPD({ description: "old", editable: true }, onSave);
    fireEvent.click(screen.getByTestId("edit-toggle"));
    fireEvent.change(screen.getByTestId("textarea"), {
      target: { value: "new text" },
    });
    await act(async () => {
      fireEvent.blur(screen.getByTestId("textarea"));
    });
    expect(mockSaveProjectDescription).toHaveBeenCalledWith(1, "new text");
    expect(onSave).toHaveBeenCalledWith("new text");
  });

  it("does not save on blur when nothing changed", async () => {
    const onSave = jest.fn();
    renderPD({ description: "unchanged", editable: true }, onSave);
    fireEvent.click(screen.getByTestId("edit-toggle"));
    await act(async () => {
      fireEvent.blur(screen.getByTestId("textarea"));
    });
    expect(mockSaveProjectDescription).not.toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("reverts to the last valid description and shows an error when the save fails", async () => {
    const onSave = jest.fn();
    mockSaveProjectDescription.mockResolvedValue({
      status: "failed",
      message: "Server said no",
    });
    renderPD({ description: "original", editable: true }, onSave);
    fireEvent.click(screen.getByTestId("edit-toggle"));
    fireEvent.change(screen.getByTestId("textarea"), {
      target: { value: "bad value" },
    });
    await act(async () => {
      fireEvent.blur(screen.getByTestId("textarea"));
    });
    // Reverted textarea value + surfaced error message.
    expect((screen.getByTestId("textarea") as HTMLTextAreaElement).value).toBe(
      "original",
    );
    expect(screen.getByText("Server said no")).toBeTruthy();
  });

  it("keeps the new description on a successful save", async () => {
    mockSaveProjectDescription.mockResolvedValue({ status: "ok" });
    renderPD({ description: "original", editable: true }, jest.fn());
    fireEvent.click(screen.getByTestId("edit-toggle"));
    fireEvent.change(screen.getByTestId("textarea"), {
      target: { value: "kept value" },
    });
    await act(async () => {
      fireEvent.blur(screen.getByTestId("textarea"));
    });
    expect((screen.getByTestId("textarea") as HTMLTextAreaElement).value).toBe(
      "kept value",
    );
  });
});

// SMP-1123 / SMP-1475: the project prop can change after mount (the sidebar
// mounts a stub with no description, then /projects.json fills it in), but
// description was only copied into state in the constructor, so the loaded value
// never rendered. componentDidUpdate now syncs the incoming prop, guarded so it
// never clobbers an in-progress edit.
describe("ProjectDescription prop sync", () => {
  const rerenderWith = (rerender: $TSFixMe, project: $TSFixMe) =>
    rerender(
      <ProjectDescription
        project={{ id: 1, name: "P", ...project }}
        onProjectDescriptionSave={jest.fn()}
      />,
    );

  it("renders a description that arrives via props after mount", () => {
    // Mounts empty (the stub project), then the real value arrives.
    const { rerender } = renderPD({ description: "" });
    expect(screen.getByText("No description.")).toBeTruthy();

    rerenderWith(rerender, { description: "Loaded from projects.json" });

    expect(screen.getByTestId("project-description").textContent).toBe(
      "Loaded from projects.json",
    );
  });

  it("does not clobber an in-progress edit when a prop arrives mid-edit", () => {
    // User opens the editor and types unsaved text...
    const { rerender } = renderPD({ description: "original", editable: true });
    fireEvent.click(screen.getByTestId("edit-toggle"));
    fireEvent.change(screen.getByTestId("textarea"), {
      target: { value: "user is still typing" },
    });

    // ...and a fresh prop lands before they save. Their text must survive.
    rerenderWith(rerender, {
      description: "external update",
      editable: true,
    });

    expect((screen.getByTestId("textarea") as HTMLTextAreaElement).value).toBe(
      "user is still typing",
    );
  });

  it("lands the saved value when the post-save prop arrives (no fight)", async () => {
    // Full round-trip: edit, save (changed -> false), close the editor, then the
    // parent re-renders with the just-saved value spread onto a new project.
    mockSaveProjectDescription.mockResolvedValue({ status: "ok" });
    const { rerender } = renderPD(
      { description: "old", editable: true },
      jest.fn(),
    );
    fireEvent.click(screen.getByTestId("edit-toggle"));
    fireEvent.change(screen.getByTestId("textarea"), {
      target: { value: "saved value" },
    });
    await act(async () => {
      fireEvent.blur(screen.getByTestId("textarea"));
    });
    fireEvent.click(screen.getByTestId("edit-toggle")); // close editor

    // changed is false by now, so the guard allows the sync; it carries the same
    // value that was saved, so the read view shows it and nothing fights.
    rerenderWith(rerender, { description: "saved value", editable: true });

    expect(mockSaveProjectDescription).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("project-description").textContent).toBe(
      "saved value",
    );
  });

  it("is a no-op when an empty description stays empty (no state flip / loop)", () => {
    const setStateSpy = jest.spyOn(ProjectDescription.prototype, "setState");
    const { rerender } = renderPD({ description: "" });
    expect(screen.getByText("No description.")).toBeTruthy();

    // A genuinely description-less project: "" mounts, then "" (or null) arrives.
    setStateSpy.mockClear();
    rerenderWith(rerender, { description: null });

    // Guard sees prev "" === next "" (both normalized), so it never setStates.
    expect(setStateSpy).not.toHaveBeenCalled();
    expect(screen.getByText("No description.")).toBeTruthy();
    expect(screen.queryByTestId("project-description")).toBeNull();
    setStateSpy.mockRestore();
  });
});
