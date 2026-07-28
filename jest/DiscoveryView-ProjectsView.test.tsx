// Coverage for
// app/assets/src/components/views/DiscoveryView/components/ProjectsView/ProjectsView.tsx
// The class component owns the projects table column definitions, the
// table/map display switch, the filtered-count copy and a handful of row
// callbacks. The heavy children (the react-virtualized BaseDiscoveryView and
// the MapTiler-backed DiscoveryMap) are stubbed so the logic this file owns is
// what gets exercised.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { ProjectsView } from "~/components/views/DiscoveryView/components/ProjectsView/ProjectsView";
import {
  DEFAULT_ROW_HEIGHT,
  MAX_PROJECT_ROW_HEIGHT,
} from "~/components/views/DiscoveryView/components/ProjectsView/constants";
import { GlobalContext } from "~/globalContext/reducer";

// Keeps organize-imports from dropping the React import the classic JSX
// runtime needs in scope.
const _React: typeof React = React;

/* eslint-disable @typescript-eslint/no-explicit-any */

const mockTrackEvent = jest.fn();

jest.mock("~/api/analytics", () => ({
  trackEventFromClassComponent: (...args: unknown[]) => mockTrackEvent(...args),
}));

jest.mock(
  "~/components/views/DiscoveryView/components/BaseDiscoveryView",
  () => ({
    BaseDiscoveryView: () => null,
  }),
);

jest.mock("~/components/views/DiscoveryView/components/DiscoveryMap", () => ({
  DiscoveryMap: ({ currentTab }: any) => (
    <div data-testid="discovery-map">{currentTab}</div>
  ),
}));

const globalContextValue = {
  discoveryProjectIds: [1, 2, 3],
} as any;

const renderView = (props: Record<string, any> = {}) => {
  const ref = React.createRef<any>();
  const utils = render(
    <GlobalContext.Provider value={globalContextValue}>
      <ProjectsView
        ref={ref}
        currentDisplay="table"
        currentTab="projects"
        onLoadRows={jest.fn()}
        fetchWorkflowRunsProjectAggregates={jest.fn()}
        projects={{ get: jest.fn() } as any}
        {...props}
      />
    </GlobalContext.Provider>,
  );
  return { ...utils, instance: ref.current };
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("ProjectsView filtered count", () => {
  it("pluralizes the total project count when no filter is applied", () => {
    renderView({ totalNumberOfProjects: 4 });
    expect(screen.getByTestId("project-count").textContent).toBe("4 projects");
    expect(screen.queryByTestId("clear-filters-button")).toBeNull();
  });

  it("uses the singular form for exactly one project", () => {
    renderView({ totalNumberOfProjects: 1 });
    expect(screen.getByTestId("project-count").textContent).toBe("1 project");
  });

  it("shows the filtered-out-of-total copy and a working clear-filters button", () => {
    const onClearFilters = jest.fn();
    renderView({
      totalNumberOfProjects: 10,
      filteredProjectCount: 3,
      hasAtLeastOneFilterApplied: true,
      onClearFilters,
    });
    expect(screen.getByTestId("project-count").textContent).toContain(
      "3 out of 10 projects",
    );
    fireEvent.click(screen.getByTestId("clear-filters-button"));
    expect(onClearFilters).toHaveBeenCalledTimes(1);
  });

  it("falls back to 0 when the filtered count is missing", () => {
    renderView({
      totalNumberOfProjects: 10,
      hasAtLeastOneFilterApplied: true,
    });
    expect(screen.getByTestId("project-count").textContent).toContain(
      "0 out of 10 projects",
    );
  });
});

describe("ProjectsView display switching", () => {
  it("renders the table display without the map", () => {
    renderView({ currentDisplay: "table", totalNumberOfProjects: 2 });
    expect(screen.queryByTestId("discovery-map")).toBeNull();
    expect(screen.getByTestId("menu-icons")).toBeTruthy();
  });

  it("renders the map display for a non-table display", () => {
    renderView({ currentDisplay: "map", totalNumberOfProjects: 2 });
    expect(screen.getByTestId("discovery-map").textContent).toBe("projects");
  });

  it("calls onDisplaySwitch and tracks the toggle click", () => {
    const onDisplaySwitch = jest.fn();
    renderView({ onDisplaySwitch, totalNumberOfProjects: 2 });
    fireEvent.click(screen.getByTestId("map-view"));
    expect(onDisplaySwitch).toHaveBeenCalledWith("map");
    expect(mockTrackEvent).toHaveBeenCalledWith(
      { projectIds: [1, 2, 3] },
      "ProjectsView_map-switch_clicked",
    );
  });
});

describe("ProjectsView row callbacks", () => {
  it("uses the taller row height only when the project has a description", () => {
    const { instance } = renderView();
    expect(
      instance.getRowHeight({ row: { project: { description: "hi" } } }),
    ).toBe(MAX_PROJECT_ROW_HEIGHT);
    expect(instance.getRowHeight({ row: { project: {} } })).toBe(
      DEFAULT_ROW_HEIGHT,
    );
    expect(instance.getRowHeight({ row: undefined })).toBe(DEFAULT_ROW_HEIGHT);
  });

  it("looks the clicked project up in the collection and notifies the parent", () => {
    const project = { id: 5, name: "Project Five" };
    const onProjectSelected = jest.fn();
    const get = jest.fn().mockReturnValue(project);
    const { instance } = renderView({
      onProjectSelected,
      projects: { get } as any,
    });

    instance.handleRowClick({ rowData: { id: 5 } });
    expect(get).toHaveBeenCalledWith(5);
    expect(onProjectSelected).toHaveBeenCalledWith({ project });
  });

  it("is a no-op on row click when no selection handler is supplied", () => {
    const get = jest.fn().mockReturnValue({ id: 5 });
    const { instance } = renderView({ projects: { get } as any });
    expect(() => instance.handleRowClick({ rowData: { id: 5 } })).not.toThrow();
    expect(get).toHaveBeenCalledWith(5);
  });

  it("forwards sort changes to onSortColumn", () => {
    const onSortColumn = jest.fn();
    const { instance } = renderView({ onSortColumn });
    instance.handleSortColumn({ sortBy: "created_at", sortDirection: "DESC" });
    expect(onSortColumn).toHaveBeenCalledWith({
      sortBy: "created_at",
      sortDirection: "DESC",
    });
  });

  it("resets the underlying table only in table display", () => {
    const reset = jest.fn();
    const { instance } = renderView({ currentDisplay: "table" });
    instance.discoveryView = { reset };
    instance.reset();
    expect(reset).toHaveBeenCalledTimes(1);

    const mapView = renderView({ currentDisplay: "map" }).instance;
    mapView.discoveryView = { reset };
    mapView.reset();
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("tolerates a missing table ref on reset", () => {
    const { instance } = renderView({ currentDisplay: "table" });
    instance.discoveryView = null;
    expect(() => instance.reset()).not.toThrow();
  });
});

describe("ProjectsView handleLoadRowsAndFormat", () => {
  it("splits each project into the nested project cell plus the flat columns", async () => {
    const rawProjects = [
      {
        id: "7",
        name: "Project Seven",
        description: "A description",
        owner: "Ada",
        public_access: 1,
        created_at: "2021-01-01",
        hosts: ["Human"],
        tissues: ["Serum"],
        sample_counts: { number_of_samples: 3 },
        ignored: "dropped",
      },
    ];
    const onLoadRows = jest.fn().mockResolvedValue(rawProjects);
    const fetchWorkflowRunsProjectAggregates = jest.fn();
    const { instance } = renderView({
      onLoadRows,
      fetchWorkflowRunsProjectAggregates,
    });

    const rows = await instance.handleLoadRowsAndFormat({
      startIndex: 0,
      stopIndex: 10,
    });

    expect(onLoadRows).toHaveBeenCalledWith({ startIndex: 0, stopIndex: 10 });
    // Project ids are coerced to numbers before the aggregate fetch.
    expect(fetchWorkflowRunsProjectAggregates).toHaveBeenCalledWith([7]);
    expect(rows).toEqual([
      {
        project: {
          name: "Project Seven",
          description: "A description",
          owner: "Ada",
          public_access: 1,
        },
        id: "7",
        created_at: "2021-01-01",
        hosts: ["Human"],
        tissues: ["Serum"],
        sample_counts: { number_of_samples: 3 },
      },
    ]);
  });

  it("handles an empty page of rows", async () => {
    const fetchWorkflowRunsProjectAggregates = jest.fn();
    const { instance } = renderView({
      onLoadRows: jest.fn().mockResolvedValue([]),
      fetchWorkflowRunsProjectAggregates,
    });
    await expect(instance.handleLoadRowsAndFormat({})).resolves.toEqual([]);
    expect(fetchWorkflowRunsProjectAggregates).toHaveBeenCalledWith([]);
  });
});

describe("ProjectsView column renderers", () => {
  const project = {
    name: "Project Seven",
    description: "A description",
    owner: "Ada",
    public_access: 1,
  };

  it("renders the project name, description and owner, and blanks for a missing project", () => {
    const { instance } = renderView();
    expect(instance.nameRenderer(project)).toBe("Project Seven");
    expect(instance.nameRenderer(null)).toBe("");

    const description = render(
      <div>{instance.descriptionRenderer(project)}</div>,
    );
    expect(description.container.textContent).toBe("A description");
    expect(
      render(<div>{instance.descriptionRenderer(null)}</div>).container
        .textContent,
    ).toBe("");

    const details = render(<div>{instance.detailsRenderer(project)}</div>);
    expect(details.container.textContent).toBe("Ada");
    expect(
      render(<div>{instance.detailsRenderer(undefined)}</div>).container
        .textContent,
    ).toBe("");
  });

  it("renders a public/private/placeholder visibility icon", () => {
    const { instance } = renderView();
    const publicIcon = render(
      <div>{instance.visibilityIconRenderer(project)}</div>,
    );
    expect(publicIcon.container.querySelector("svg")).toBeTruthy();

    const privateIcon = render(
      <div>
        {instance.visibilityIconRenderer({ ...project, public_access: 0 })}
      </div>,
    );
    expect(privateIcon.container.querySelector("svg")).toBeTruthy();
    // The two icons are different glyphs.
    expect(publicIcon.container.innerHTML).not.toBe(
      privateIcon.container.innerHTML,
    );

    const placeholder = render(
      <div>{instance.visibilityIconRenderer(null)}</div>,
    );
    expect(placeholder.container.querySelector("svg")).toBeNull();
  });

  it("defines the expected columns with their tooltip column data", () => {
    const { instance } = renderView();
    expect(instance.columns.map((c: any) => c.dataKey)).toEqual([
      "project",
      "created_at",
      "hosts",
      "tissues",
      "sample_counts",
    ]);
    const createdAt = instance.columns[1];
    expect(createdAt.columnData.tooltip).toContain("Date project was created");
    // sample_counts has no PROJECT_TABLE_COLUMNS entry, so columnData is unset.
    expect(instance.columns[4].columnData).toBeUndefined();
  });

  it("sorts projects case-insensitively by name, tolerating a missing name", () => {
    const { instance } = renderView();
    const sortKey = instance.columns[0].sortKey;
    expect(sortKey({ name: "Zeta" })).toBe("zeta");
    expect(sortKey({})).toBe("");
  });

  it("folds the project id into the sample_counts cell data", () => {
    const { instance } = renderView();
    const cellDataGetter = instance.columns[4].cellDataGetter;
    expect(
      cellDataGetter({
        rowData: { id: 9, sample_counts: { number_of_samples: 2 } },
      }),
    ).toEqual({ projectId: 9, number_of_samples: 2 });
  });

  it("renders the project details cell through the item-details renderer", () => {
    const { instance } = renderView();
    const { container } = render(
      <div>{instance.columns[0].cellRenderer({ cellData: project })}</div>,
    );
    expect(container.textContent).toContain("Project Seven");
    expect(container.textContent).toContain("A description");
    expect(container.textContent).toContain("Ada");
  });

  it("renders the sample counts cell with the workflow aggregates from props", () => {
    const { instance } = renderView({
      workflowRunsProjectAggregates: {
        9: { "short-read-mngs": 2, "consensus-genome": 1, amr: 0 },
      } as any,
    });
    const { container } = render(
      <div>
        {instance.columns[4].cellRenderer({
          cellData: { projectId: 9, number_of_samples: 2 },
        })}
      </div>,
    );
    expect(container.textContent).toContain("2 Samples");

    // Without cell data the counts child is not rendered at all.
    const empty = render(
      <div>{instance.columns[4].cellRenderer({ cellData: undefined })}</div>,
    );
    expect(empty.container.textContent).toBe("");
  });
});
