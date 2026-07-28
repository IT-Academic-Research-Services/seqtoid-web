// Coverage: app/assets/src/components/views/DiscoveryView/components/DiscoverySidebar/DiscoverySidebar.tsx
//
// DiscoverySidebar derives its whole state from props (getDerivedStateFromProps)
// and then renders three accordions: overall counts, a date histogram and the
// metadata bar charts. The ProjectDescription child is stubbed because it pulls
// in ~/api; everything else (Accordion, BasicPopup) is exercised for real so the
// branch pairs below -- loading vs loaded, samples vs projects tab, interval vs
// point dates, collapsed vs expanded metadata groups -- are genuinely walked.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock(
  "~/components/views/DiscoveryView/components/DiscoverySidebar/components/ProjectDescription",
  () => ({
    ProjectDescription: ({ project, onProjectDescriptionSave }: $TSFixMe) => (
      <div data-testid="project-description-stub">
        <span data-testid="project-name">{project.name}</span>
        <button
          data-testid="save-description"
          onClick={() =>
            onProjectDescriptionSave && onProjectDescriptionSave("new text")
          }
        />
      </div>
    ),
  }),
);

import { DiscoverySidebar } from "~/components/views/DiscoveryView/components/DiscoverySidebar/DiscoverySidebar";

const sampleStats = {
  count: 1234,
  projectCount: 7,
  avgTotalReads: 98765,
  avgAdjustedRemainingReads: 4321,
};

const dimension = (name: string, values: $TSFixMe[]) => ({
  dimension: name,
  values,
});

const hostValues = [
  { value: "human", text: "Human", count: 10 },
  { value: "mosquito", text: "Mosquito", count: 8 },
  { value: "tick", text: "Tick", count: 6 },
  { value: "bat", text: "Bat", count: 4 },
  { value: "not_set", text: "Unknown", count: 2 },
];

const renderSidebar = (props: $TSFixMe = {}) =>
  render(
    <DiscoverySidebar
      currentTab="samples"
      noDataAvailable={false}
      loading={false}
      defaultNumberOfMetadataRows={4}
      sampleStats={sampleStats}
      sampleDimensions={[dimension("host", hostValues)] as $TSFixMe}
      {...props}
    />,
  );

describe("DiscoverySidebar static helpers", () => {
  it("formatNumber rounds and localizes, and blanks out falsy values", () => {
    expect(DiscoverySidebar.formatNumber(1234.6)).toBe((1235).toLocaleString());
    expect(DiscoverySidebar.formatNumber(0)).toBe("");
    expect(DiscoverySidebar.formatNumber(undefined as $TSFixMe)).toBe("");
  });

  it("formatDate renders ISO day precision", () => {
    expect(DiscoverySidebar.formatDate("2021-03-04T10:00:00Z")).toBe(
      "2021-03-04",
    );
  });

  it("loadDimension returns the matching values or an empty list", () => {
    const dims = [dimension("host", hostValues)];
    expect(DiscoverySidebar.loadDimension(dims, "host")).toEqual(hostValues);
    expect(DiscoverySidebar.loadDimension(dims, "tissue")).toEqual([]);
    expect(DiscoverySidebar.loadDimension(undefined, "host")).toEqual([]);
  });
});

describe("DiscoverySidebar empty states", () => {
  it("prompts to add data when nothing is available at all", () => {
    render(
      <DiscoverySidebar currentTab="samples" noDataAvailable loading={false} />,
    );
    expect(screen.getByText("Add data to view summary info.")).toBeTruthy();
  });

  it("prompts to search again when data exists but the filters match nothing", () => {
    render(
      <DiscoverySidebar
        currentTab="samples"
        noDataAvailable={false}
        loading={false}
      />,
    );
    expect(
      screen.getByText("Try another search to see summary info."),
    ).toBeTruthy();
  });

  it("keeps the sidebar body while loading even with no stats yet", () => {
    render(<DiscoverySidebar currentTab="samples" noDataAvailable loading />);
    expect(screen.queryByText("Add data to view summary info.")).toBeNull();
    expect(screen.getByTestId("overall-sidebar")).toBeTruthy();
  });
});

describe("DiscoverySidebar overall stats", () => {
  it("renders sample/project counts and the per-sample averages on the samples tab", () => {
    renderSidebar();
    expect(screen.getByTestId("samples-value").textContent).toBe(
      (1234).toLocaleString(),
    );
    expect(screen.getByTestId("project-value").textContent).toBe("7");
    expect(screen.getByTestId("avg-reads-per-sample-value").textContent).toBe(
      (98765).toLocaleString(),
    );
    expect(
      screen.getByTestId("avg-reads-passing-filters-per-sample-value")
        .textContent,
    ).toBe((4321).toLocaleString());
  });

  it("hides the per-sample averages on the projects tab and prefers projectStats.count", () => {
    renderSidebar({
      currentTab: "projects",
      projectStats: { count: 42 },
      projectDimensions: [dimension("host", hostValues)] as $TSFixMe,
    });
    expect(screen.getByTestId("project-value").textContent).toBe("42");
    expect(screen.queryByTestId("avg-reads-per-sample-value")).toBeNull();
  });

  it("renders the project description section only when a project is given", () => {
    const { queryByTestId } = renderSidebar();
    expect(queryByTestId("project-description-section")).toBeNull();

    const onProjectDescriptionSave = jest.fn();
    renderSidebar({
      project: { id: 3, name: "Zika" },
      onProjectDescriptionSave,
    });
    expect(screen.getByTestId("project-name").textContent).toBe("Zika");
    fireEvent.click(screen.getByTestId("save-description"));
    expect(onProjectDescriptionSave).toHaveBeenCalledWith("new text");
  });
});

describe("DiscoverySidebar date histogram", () => {
  it("renders one bar per interval bin and both end labels", () => {
    renderSidebar({
      sampleDimensions: [
        dimension("time_bins", [
          {
            value: "a",
            count: 3,
            interval: { start: "2021-01-01", end: "2021-01-31" },
          },
          {
            value: "b",
            count: 6,
            interval: { start: "2021-02-01", end: "2021-02-28" },
          },
          {
            value: "c",
            count: 1,
            interval: { start: "2021-03-01", end: "2021-03-31" },
          },
        ]),
      ] as $TSFixMe,
    });
    expect(screen.getAllByTestId("date-histogram-bar")).toHaveLength(3);
    expect(screen.getByTestId("date-histogram-first-date").textContent).toBe(
      "2021-01-01",
    );
    expect(screen.getByTestId("date-histogram-last-date").textContent).toBe(
      "2021-03-31",
    );
  });

  it("collapses to the non-empty bars and drops the second label for point dates", () => {
    renderSidebar({
      sampleDimensions: [
        dimension("time_bins", [
          { value: "2021-05-05", count: 4 },
          { value: "2021-05-06", count: 0 },
        ]),
      ] as $TSFixMe,
    });
    // Only the bar with a positive count survives the "< 3 real bars" path.
    expect(screen.getAllByTestId("date-histogram-bar")).toHaveLength(1);
    expect(screen.getByTestId("date-histogram-first-date").textContent).toBe(
      "2021-05-05",
    );
    expect(screen.queryByTestId("date-histogram-last-date")).toBeNull();
  });

  it("renders no bars when there is no time dimension", () => {
    renderSidebar();
    expect(screen.queryAllByTestId("date-histogram-bar")).toHaveLength(0);
  });
});

describe("DiscoverySidebar metadata rows", () => {
  it("shows only the default number of rows until Show More is clicked", () => {
    renderSidebar();
    const hostSection = screen.getByTestId("metadata-host-section");
    expect(hostSection.querySelectorAll("dt")).toHaveLength(4);

    const showMore = hostSection.querySelector(
      "[data-testid='show-more']",
    ) as HTMLElement;
    expect(showMore.textContent).toBe("Show More");

    fireEvent.click(showMore);
    expect(hostSection.querySelectorAll("dt")).toHaveLength(5);
    expect(
      (hostSection.querySelector("[data-testid='show-more']") as HTMLElement)
        .textContent,
    ).toBe("Show Less");

    // Toggling again collapses the group back to the default rows.
    fireEvent.click(
      hostSection.querySelector("[data-testid='show-more']") as HTMLElement,
    );
    expect(hostSection.querySelectorAll("dt")).toHaveLength(4);
  });

  it("omits the Show More link when everything already fits", () => {
    renderSidebar({
      sampleDimensions: [
        dimension("host", [{ value: "human", text: "Human", count: 1 }]),
      ] as $TSFixMe,
    });
    const hostSection = screen.getByTestId("metadata-host-section");
    expect(hostSection.querySelector("[data-testid='show-more']")).toBeNull();
  });

  it("italicizes the not_set label and fires onFilterClick with field and value", () => {
    const onFilterClick = jest.fn();
    renderSidebar({ onFilterClick, defaultNumberOfMetadataRows: 10 });
    const hostSection = screen.getByTestId("metadata-host-section");
    expect(hostSection.querySelector("i")?.textContent).toBe("Unknown");

    const humanLink = Array.from(hostSection.querySelectorAll("a")).find(
      a => a.textContent === "Human",
    ) as HTMLElement;
    fireEvent.click(humanLink);
    expect(onFilterClick).toHaveBeenCalledWith("host", "human");
  });

  it("does not blow up when no onFilterClick handler is supplied", () => {
    renderSidebar({ defaultNumberOfMetadataRows: 10 });
    const hostSection = screen.getByTestId("metadata-host-section");
    const link = hostSection.querySelector("a") as HTMLElement;
    fireEvent.click(link);
    // Still rendered; the click is simply a no-op.
    expect(hostSection.querySelectorAll("dt")).toHaveLength(5);
  });

  it("renders empty metadata lists for dimensions with no values", () => {
    renderSidebar();
    const tissueSection = screen.getByTestId("metadata-tissue-section");
    expect(tissueSection.querySelectorAll("dt")).toHaveLength(0);
    const locationSection = screen.getByTestId("metadata-location-section");
    expect(locationSection.querySelectorAll("dt")).toHaveLength(0);
  });
});
