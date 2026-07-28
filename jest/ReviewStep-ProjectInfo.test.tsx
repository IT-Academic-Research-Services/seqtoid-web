// Coverage: app/assets/src/components/views/SampleUploadFlow/components/ReviewStep/components/ProjectInfo/ProjectInfo.tsx
//
// ProjectInfo renders the project summary block on the upload review screen.
// The branches worth covering: public vs private project (icon + label),
// description present vs absent, the show-more/show-less truncation path that
// only appears when the description has more than five newlines, the toggle
// between "Show More" and "Show Less", the existing-samples count fallback to
// 0, and the "Edit Project" link callback. Child SDS Icon and the info
// tooltip are stubbed so the assertions land on this file's own logic.
import { fireEvent, render, screen } from "@testing-library/react";
import { ProjectInfo } from "~/components/views/SampleUploadFlow/components/ReviewStep/components/ProjectInfo/ProjectInfo";

jest.mock("@czi-sds/components", () => ({
  Icon: (props: $TSFixMe) =>
    require("react").createElement("span", {
      "data-testid": "sds-icon",
      "data-sdsicon": props.sdsIcon,
    }),
}));

jest.mock("~/components/common/ProjectInfoIconTooltip", () => ({
  __esModule: true,
  default: (props: $TSFixMe) =>
    require("react").createElement("span", {
      "data-testid": "info-tooltip",
      "data-ispublic": String(props.isPublic),
    }),
}));

const baseProject = {
  id: 7,
  name: "My Project",
  description: "A short description",
  number_of_samples: 3,
  public_access: 0,
};

const renderProjectInfo = (overrides = {}) => {
  const props = {
    areLinksEnabled: true,
    onLinkClick: jest.fn(),
    uploadType: "local",
    project: { ...baseProject, ...overrides },
    ...(overrides as $TSFixMe).__props,
  };
  return { props, ...render(<ProjectInfo {...(props as $TSFixMe)} />) };
};

describe("ProjectInfo", () => {
  it("renders a private project with its name, private label and sample count", () => {
    renderProjectInfo({ public_access: 0 });
    expect(screen.getByText("My Project")).toBeTruthy();
    expect(screen.getByText("Private Project")).toBeTruthy();
    expect(screen.getByText("3 existing samples in project")).toBeTruthy();
    expect(screen.getByTestId("sds-icon").getAttribute("data-sdsicon")).toBe(
      "projectPrivate",
    );
    expect(
      screen.getByTestId("info-tooltip").getAttribute("data-ispublic"),
    ).toBe("false");
  });

  it("renders a public project with the public icon and label", () => {
    renderProjectInfo({ public_access: 1 });
    expect(screen.getByText("Public Project")).toBeTruthy();
    expect(screen.getByTestId("sds-icon").getAttribute("data-sdsicon")).toBe(
      "projectPublic",
    );
    expect(
      screen.getByTestId("info-tooltip").getAttribute("data-ispublic"),
    ).toBe("true");
  });

  it("falls back to 0 existing samples when the count is missing", () => {
    renderProjectInfo({ number_of_samples: undefined });
    expect(screen.getByText("0 existing samples in project")).toBeTruthy();
  });

  it("does not render a description block when description is empty", () => {
    renderProjectInfo({ description: "" });
    expect(screen.queryByText("Show More")).toBeNull();
  });

  it("shows the description without a Show More toggle when it is short", () => {
    renderProjectInfo({ description: "line1\nline2\nline3" });
    expect(screen.getByText("line1 line2 line3")).toBeTruthy();
    expect(screen.queryByText("Show More")).toBeNull();
  });

  it("truncates a long (>5 newline) description and toggles show more/less", () => {
    const longDescription = "a\nb\nc\nd\ne\nf\ng";
    renderProjectInfo({ description: longDescription });

    // Starts collapsed -> "Show More".
    const toggle = screen.getByText("Show More");
    expect(toggle).toBeTruthy();

    fireEvent.click(toggle);
    expect(screen.getByText("Show Less")).toBeTruthy();
    expect(screen.queryByText("Show More")).toBeNull();

    // Toggle back.
    fireEvent.click(screen.getByText("Show Less"));
    expect(screen.getByText("Show More")).toBeTruthy();
  });

  it("fires onLinkClick with the sample step when Edit Project is clicked", () => {
    const { props } = renderProjectInfo();
    fireEvent.click(screen.getByText("Edit Project"));
    expect(props.onLinkClick).toHaveBeenCalledTimes(1);
    // UploadStepType.SampleStep === "uploadSamples" is passed through.
    expect(props.onLinkClick).toHaveBeenCalledWith("uploadSamples");
  });
});
