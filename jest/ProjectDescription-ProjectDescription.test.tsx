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
