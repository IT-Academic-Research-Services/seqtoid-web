// Coverage:
//   app/assets/src/components/common/BackgroundDetailsModal/BackgroundDetailsModal.tsx
//   app/assets/src/components/common/BackgroundDetailsModal/BackgroundDetailsLink.tsx
//
// SMP-1437: after a background is created there was previously no way for a user
// to review its description or the samples that went into it. These components
// surface that: BackgroundDetailsModal fetches a single background via
// getBackground and renders its description + member samples (with a loading and
// an error state), and BackgroundDetailsLink is the info affordance that only
// appears when a real background is selected and opens the modal.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

let mockGetBackground: jest.Mock;
jest.mock("~/api", () => ({
  getBackground: (...args: $TSFixMe[]) => mockGetBackground(...args),
}));

// Stub the Modal container to a passthrough so we can assert on the content.
jest.mock("~ui/containers/Modal", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="modal">
      <button data-testid="modal-close" onClick={props.onClose} />
      {props.children}
    </div>
  ),
}));

jest.mock("~/components/common/LoadingMessage", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="loading">{props.message}</div>
  ),
}));

// Stub SDS Icon/Tooltip so BackgroundDetailsLink renders without pulling in the
// full design system.
jest.mock("@czi-sds/components", () => ({
  Icon: () => <span data-testid="icon" />,
  Tooltip: (props: $TSFixMe) => <>{props.children}</>,
}));

import BackgroundDetailsLink from "~/components/common/BackgroundDetailsModal/BackgroundDetailsLink";
import BackgroundDetailsModal from "~/components/common/BackgroundDetailsModal/BackgroundDetailsModal";

const details = (over: $TSFixMe = {}) => ({
  id: 7,
  name: "My Background",
  description: "Controls from March",
  mass_normalized: false,
  ready: 1,
  created_at: "2026-01-01",
  updated_at: "2026-01-01",
  editable: true,
  sample_count: 2,
  samples: [
    { id: 1, name: "Sample A", project_name: "Proj X" },
    { id: 2, name: "Sample B", project_name: null },
  ],
  ...over,
});

beforeEach(() => {
  mockGetBackground = jest.fn();
});

describe("BackgroundDetailsModal", () => {
  it("shows a loading state, then the description and member samples", async () => {
    mockGetBackground.mockResolvedValue(details());
    render(<BackgroundDetailsModal backgroundId={7} onClose={jest.fn()} />);

    // Loading first.
    expect(screen.getByTestId("loading")).toBeTruthy();

    // Then the resolved details.
    expect(await screen.findByText("Controls from March")).toBeTruthy();
    expect(screen.getByText("My Background")).toBeTruthy();
    expect(screen.getByText("Standard")).toBeTruthy();
    expect(screen.getByText("Sample A")).toBeTruthy();
    expect(screen.getByText("Sample B")).toBeTruthy();
    expect(screen.getByText("Proj X")).toBeTruthy();
    // Null project name renders the placeholder.
    expect(screen.getByText("--")).toBeTruthy();
    // It requested the background it was told to.
    expect(mockGetBackground).toHaveBeenCalledWith({ backgroundId: 7 });
  });

  it("falls back when no description was provided", async () => {
    mockGetBackground.mockResolvedValue(details({ description: null }));
    render(<BackgroundDetailsModal backgroundId={7} onClose={jest.fn()} />);
    expect(await screen.findByText("(no description provided)")).toBeTruthy();
  });

  it("labels a mass-normalized background", async () => {
    mockGetBackground.mockResolvedValue(details({ mass_normalized: true }));
    render(<BackgroundDetailsModal backgroundId={7} onClose={jest.fn()} />);
    expect(await screen.findByText("Normalized by input mass")).toBeTruthy();
  });

  it("shows an error state when the fetch fails (e.g. unauthorized/404)", async () => {
    mockGetBackground.mockRejectedValue(new Error("not authorized"));
    render(<BackgroundDetailsModal backgroundId={7} onClose={jest.fn()} />);
    expect(
      await screen.findByText(/Unable to load this background/),
    ).toBeTruthy();
  });
});

describe("BackgroundDetailsLink", () => {
  it("renders nothing when no real background is selected", () => {
    const { container: none } = render(
      <BackgroundDetailsLink backgroundId={0} />,
    );
    expect(none.firstChild).toBeNull();

    const { container: undef } = render(
      <BackgroundDetailsLink backgroundId={undefined} />,
    );
    expect(undef.firstChild).toBeNull();
  });

  it("opens the details modal when clicked", async () => {
    mockGetBackground.mockResolvedValue(details());
    render(<BackgroundDetailsLink backgroundId={7} />);

    // Modal not shown until the affordance is clicked.
    expect(screen.queryByTestId("modal")).toBeNull();

    fireEvent.click(screen.getByTestId("view-background-details"));

    await waitFor(() => expect(screen.getByTestId("modal")).toBeTruthy());
    expect(await screen.findByText("My Background")).toBeTruthy();
  });
});
