// Coverage: app/assets/src/components/views/SampleUploadFlow/components/ReviewStep/
//   components/SampleInfo/SampleInfo.tsx
//
// SampleInfo is the "Sample Info" review section. Its branch logic is small but
// entirely conditional: the links block gets an extra `enabled` class only when
// areLinksEnabled is true, the two link handlers report different UploadStepTypes,
// and the admin-only AdminUploadOptions block renders only when the UserContext
// says the viewer is an admin. Both children are stubbed so assertions land on
// this file rather than on the review table / admin form internals.
import { fireEvent, render } from "@testing-library/react";
import { UserContext } from "~/components/common/UserContext";
import { UploadStepType } from "~/interface/upload";

// Jest maps every relative scss import to the shared empty styleMock, so `cs.links`
// would be undefined and the conditional `cs.enabled` class would never show up in
// the DOM. Replacing that stub for this suite makes the areLinksEnabled branch
// observable. (Aliased "~/..." scss paths hit the alias mapper first, so mocking the
// scss file by alias would not affect the component's own relative import.)
jest.mock("./__mocks__/styleMock", () => ({
  sectionContainer: "sectionContainer",
  reviewHeader: "reviewHeader",
  text: "text",
  links: "links",
  enabled: "enabled",
  link: "link",
  divider: "divider",
  tableScrollWrapper: "tableScrollWrapper",
}));

jest.mock(
  "~/components/views/SampleUploadFlow/components/ReviewStep/components/SampleInfo/components/ReviewTable",
  () => ({
    __esModule: true,
    ReviewTable: (props: $TSFixMe) => (
      <div
        data-testid="review-table"
        data-upload-type={props.uploadType}
        data-sample-count={String(
          props.samples ? props.samples.length : "none",
        )}
      />
    ),
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/ReviewStep/components/SampleInfo/components/AdminUploadOptions/AdminUploadOptions",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => (
      <button
        data-testid="admin-options"
        onClick={() => props.onAdminOptionsChanged({ subsample: "10" })}
      >
        admin
      </button>
    ),
  }),
);

import { SampleInfo } from "~/components/views/SampleUploadFlow/components/ReviewStep/components/SampleInfo/SampleInfo";

const makeProps = (overrides: $TSFixMe = {}) => ({
  adminOptions: {},
  areLinksEnabled: true,
  hostGenomes: [],
  metadata: { headers: [], rows: [] },
  onAdminOptionsChanged: jest.fn(),
  onLinkClick: jest.fn(),
  project: { id: 1, name: "Proj" },
  projectMetadataFields: {},
  samples: [{ name: "s1" }],
  uploadType: "local",
  ...overrides,
});

const renderWith = (props: $TSFixMe, admin: boolean) =>
  render(
    <UserContext.Provider value={{ admin } as $TSFixMe}>
      <SampleInfo {...props} />
    </UserContext.Provider>,
  );

describe("SampleInfo section chrome", () => {
  it("renders the header and forwards table props to ReviewTable", () => {
    const props = makeProps();
    const { container, getByTestId } = renderWith(props, false);

    expect(container.textContent).toContain("Sample Info");
    expect(container.textContent).toContain("Edit Samples");
    expect(container.textContent).toContain("Edit Metadata");
    const table = getByTestId("review-table");
    expect(table.getAttribute("data-upload-type")).toBe("local");
    expect(table.getAttribute("data-sample-count")).toBe("1");
  });

  it("tolerates null samples and metadata", () => {
    const props = makeProps({ samples: null, metadata: null });
    const { getByTestId } = renderWith(props, false);

    expect(getByTestId("review-table").getAttribute("data-sample-count")).toBe(
      "none",
    );
  });
});

describe("SampleInfo link enabling branch", () => {
  it("adds the enabled modifier class when links are enabled", () => {
    const { container } = renderWith(
      makeProps({ areLinksEnabled: true }),
      false,
    );
    const links = container.querySelector(".links");

    expect(links).not.toBeNull();
    expect(links?.className).toContain("enabled");
  });

  it("omits the enabled modifier class when links are disabled", () => {
    const { container } = renderWith(
      makeProps({ areLinksEnabled: false }),
      false,
    );
    const links = container.querySelector(".links");

    expect(links).not.toBeNull();
    expect(links?.className).not.toContain("enabled");
  });

  it("reports the sample step and the metadata step from the two links", () => {
    const props = makeProps();
    const { getByText } = renderWith(props, false);

    fireEvent.click(getByText("Edit Samples"));
    expect(props.onLinkClick).toHaveBeenCalledWith(UploadStepType.SampleStep);

    fireEvent.click(getByText("Edit Metadata"));
    expect(props.onLinkClick).toHaveBeenCalledWith(UploadStepType.MetadataStep);
    expect(props.onLinkClick).toHaveBeenCalledTimes(2);
  });
});

describe("SampleInfo admin branch", () => {
  it("hides the admin upload options for a non-admin viewer", () => {
    const { queryByTestId } = renderWith(makeProps(), false);

    expect(queryByTestId("admin-options")).toBeNull();
  });

  it("renders the admin upload options and wires the change handler for an admin", () => {
    const props = makeProps();
    const { getByTestId } = renderWith(props, true);

    const button = getByTestId("admin-options");
    expect(button).not.toBeNull();

    fireEvent.click(button);
    expect(props.onAdminOptionsChanged).toHaveBeenCalledWith({
      subsample: "10",
    });
  });
});
