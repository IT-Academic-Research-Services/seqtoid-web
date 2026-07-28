// Coverage: app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/MetadataSection.tsx
//
// MetadataSection wraps an Accordion with an editable header. The header shows
// an Edit button when editable and not editing, the save status ("Saving..." /
// "All changes saved") when editing, and a "Done Editing" control in the body
// while editing. The save-status transition is driven by a savePending prop
// going from true to false, which the tests exercise via rerender.
import { fireEvent, render, screen } from "@testing-library/react";
import MetadataSection from "~/components/common/DetailsSidebar/SampleDetailsMode/MetadataSection";

const renderSection = (props: $TSFixMe = {}) =>
  render(
    <MetadataSection title="My Section" toggleable open {...props}>
      <div data-testid="child">child body</div>
    </MetadataSection>,
  );

describe("MetadataSection header", () => {
  it("renders the title and body when open", () => {
    renderSection();
    expect(screen.getByTestId("my-section-header").textContent).toBe(
      "My Section",
    );
    expect(screen.getByTestId("child")).toBeTruthy();
  });

  it("shows an Edit button when editable and not editing", () => {
    const onEditToggle = jest.fn();
    renderSection({ editable: true, editing: false, onEditToggle });
    const editBtn = screen.getByTestId("my-section-edit");
    expect(editBtn.textContent).toBe("Edit");
    fireEvent.click(editBtn);
    expect(onEditToggle).toHaveBeenCalledTimes(1);
  });

  it("does not show an Edit button when not editable", () => {
    renderSection({ editable: false });
    expect(screen.queryByTestId("my-section-edit")).toBeNull();
  });

  it("hides the Edit button while editing", () => {
    renderSection({ editable: true, editing: true });
    expect(screen.queryByTestId("my-section-edit")).toBeNull();
  });
});

describe("MetadataSection save status", () => {
  it("shows 'Saving...' while a save is pending during editing", () => {
    renderSection({ editable: true, editing: true, savePending: true });
    expect(screen.getByText("Saving...")).toBeTruthy();
    expect(screen.queryByText("All changes saved")).toBeNull();
  });

  it("shows 'All changes saved' once savePending flips from true to false", () => {
    const { rerender } = render(
      <MetadataSection
        title="My Section"
        toggleable
        open
        editable
        editing
        savePending
      >
        <div>child</div>
      </MetadataSection>,
    );
    expect(screen.getByText("Saving...")).toBeTruthy();

    rerender(
      <MetadataSection
        title="My Section"
        toggleable
        open
        editable
        editing
        savePending={false}
      >
        <div>child</div>
      </MetadataSection>,
    );
    expect(screen.getByText("All changes saved")).toBeTruthy();
    expect(screen.queryByText("Saving...")).toBeNull();
  });

  it("renders no status text before any save has happened", () => {
    renderSection({ editable: true, editing: true, savePending: false });
    expect(screen.queryByText("Saving...")).toBeNull();
    expect(screen.queryByText("All changes saved")).toBeNull();
  });
});

describe("MetadataSection editing controls", () => {
  it("renders the 'Done Editing' button in the body while editing and fires onEditToggle", () => {
    const onEditToggle = jest.fn();
    renderSection({ editing: true, onEditToggle });
    const doneBtn = screen.getByText("Done Editing");
    fireEvent.click(doneBtn);
    expect(onEditToggle).toHaveBeenCalledTimes(1);
  });

  it("does not render the 'Done Editing' button when not editing", () => {
    renderSection({ editing: false });
    expect(screen.queryByText("Done Editing")).toBeNull();
  });
});
