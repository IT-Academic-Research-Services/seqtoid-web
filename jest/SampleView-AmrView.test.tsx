// Frontend coverage: AmrView is the AMR tab container. It fetches the workflow
// run results (only for a SUCCEEDED AMR run), camelizes them, derives the set of
// available drug classes for the filter sidebar, decides whether the run
// produced no hits at all, applies the active filter function to the rows it
// renders, and keeps a filtered-CSV download link in the AMR context in sync
// with the active filters.
//
// The heavy leaves (filters sidebar, report grid, gene details sidebar,
// SampleReportContent) are stubbed so the container's own wiring is what is
// asserted; the AMR context is supplied by the test so the dispatched actions
// can be inspected.
import { fireEvent } from "@testing-library/dom";
import { act, render, screen, waitFor } from "@testing-library/react";
import { getWorkflowRunResults } from "~/api";
import {
  computeAmrReportTableValuesForCSV,
  createCSVObjectURL,
} from "~/components/utils/csv";
import { WorkflowType } from "~/components/utils/workflows";
import { AmrView } from "~/components/views/SampleView/components/AmrView/AmrView";
import {
  AmrContext,
  AmrContextActionType,
} from "~/components/views/SampleView/components/AmrView/amrContext/reducer";

jest.mock("~/api", () => ({ getWorkflowRunResults: jest.fn() }));

// jest.config maps bare ".scss" imports to a style mock, but the "~/" alias
// pattern is matched first, so this alias-qualified stylesheet import has to be
// stubbed explicitly or jest tries to parse the raw SCSS.
jest.mock(
  "~/components/views/SampleView/components/SampleReportConent/sample_report_content.scss",
  () => ({}),
);

jest.mock("~/components/utils/csv", () => ({
  computeAmrReportTableValuesForCSV: jest.fn(() => [["header"], [["row"]]]),
  createCSVObjectURL: jest.fn(() => "blob:amr-csv"),
}));

jest.mock(
  "~/components/views/SampleView/components/SampleReportConent",
  () => ({
    __esModule: true,
    SampleReportContent: (props: $TSFixMe) => (
      <div
        data-testid="report-content"
        data-loading={String(props.loadingResults)}
        data-help-link={props.loadingInfo.helpLink}
      >
        {props.children}
      </div>
    ),
  }),
);

jest.mock("~/components/common/DetailsSidebar", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div
      data-testid="details-sidebar"
      data-visible={String(props.visible)}
      data-mode={props.mode}
      data-gene={String(props.params?.geneName)}
    >
      <button data-testid="close-sidebar" onClick={props.onClose} />
    </div>
  ),
}));

jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrFiltersContainer",
  () => ({
    __esModule: true,
    AmrFiltersContainer: (props: $TSFixMe) => (
      <div
        data-testid="amr-filters"
        data-hide-filters={String(props.hideFilters)}
      >
        <button
          data-testid="apply-gene-filter"
          onClick={() =>
            props.setDataFilterFunc(
              () => (rows: $TSFixMe[]) =>
                rows
                  .filter((row: $TSFixMe) => row.gene === "geneA")
                  .reduce((acc: $TSFixMe, row: $TSFixMe, i: number) => {
                    acc[String(i)] = row;
                    return acc;
                  }, {}),
            )
          }
        />
        <button
          data-testid="toggle-filters"
          onClick={() => props.setHideFilters(!props.hideFilters)}
        />
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrSampleReport",
  () => ({
    __esModule: true,
    AmrSampleReport: (props: $TSFixMe) => (
      <div
        data-testid="amr-report"
        data-genes={Object.values(props.reportTableData)
          .map((row: $TSFixMe) => row.gene)
          .join(",")}
        data-hide-filters={String(props.hideFilters)}
      >
        <button
          data-testid="open-gene-details"
          onClick={() => props.setDetailsSidebarGeneName("geneA")}
        />
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrNullResult",
  () => ({
    __esModule: true,
    default: () => <div data-testid="amr-null-result" />,
  }),
);

const mockedGetResults = getWorkflowRunResults as unknown as jest.Mock;
const mockedComputeCSV =
  computeAmrReportTableValuesForCSV as unknown as jest.Mock;
const mockedCreateURL = createCSVObjectURL as unknown as jest.Mock;

const SAMPLE = { id: 1, name: "sample-1" } as $TSFixMe;

const succeededRun = {
  id: 99,
  status: "SUCCEEDED",
  workflow: WorkflowType.AMR,
} as $TSFixMe;

const REPORT = {
  report_table_data: {
    "1": { gene: "geneA", drug_class: "Beta-lactam; Tetracycline" },
    "2": { gene: "geneB", drug_class: " Tetracycline " },
    "3": { gene: "geneC", drug_class: null },
  },
};

const renderView = async ({
  workflowRun = succeededRun,
  sample = SAMPLE,
  amrContextState = { activeFilters: null },
  dispatch = jest.fn(),
}: $TSFixMe = {}) => {
  const utils = render(
    <AmrContext.Provider
      value={{ amrContextState, amrContextDispatch: dispatch } as $TSFixMe}
    >
      <AmrView workflowRun={workflowRun} sample={sample} />
    </AmrContext.Provider>,
  );
  return { ...utils, dispatch };
};

const actionsOfType = (dispatch: jest.Mock, type: AmrContextActionType) =>
  dispatch.mock.calls
    .map(call => call[0])
    .filter(action => action.type === type);

describe("AmrView", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedGetResults.mockResolvedValue(REPORT);
    mockedComputeCSV.mockReturnValue([["header"], [["row"]]]);
    mockedCreateURL.mockReturnValue("blob:amr-csv");
  });

  it("shows a loading message while the sample itself is missing", async () => {
    await renderView({ sample: null, workflowRun: null });

    expect(screen.getByText("Loading report data.")).toBeTruthy();
    expect(screen.queryByTestId("report-content")).toBeNull();
    expect(mockedGetResults).not.toHaveBeenCalled();
  });

  it("does not fetch results for a run that has not succeeded", async () => {
    await renderView({
      workflowRun: { id: 99, status: "RUNNING", workflow: WorkflowType.AMR },
    });

    expect(mockedGetResults).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("report-content").getAttribute("data-loading"),
    ).toBe("false");
  });

  it("does not fetch results for a succeeded run of a different workflow", async () => {
    await renderView({
      workflowRun: {
        id: 99,
        status: "SUCCEEDED",
        workflow: WorkflowType.CONSENSUS_GENOME,
      },
    });

    expect(mockedGetResults).not.toHaveBeenCalled();
  });

  it("renders the report for a succeeded AMR run and stops loading", async () => {
    await renderView();

    await waitFor(() => expect(screen.getByTestId("amr-report")).toBeTruthy());
    expect(mockedGetResults).toHaveBeenCalledWith(99);
    expect(screen.getByTestId("amr-report").getAttribute("data-genes")).toBe(
      "geneA,geneB,geneC",
    );
    expect(
      screen.getByTestId("report-content").getAttribute("data-loading"),
    ).toBe("false");
    expect(screen.queryByTestId("amr-null-result")).toBeNull();
  });

  it("derives the de-duplicated, trimmed set of drug classes", async () => {
    const dispatch = jest.fn();
    await renderView({ dispatch });

    await waitFor(() => expect(screen.getByTestId("amr-report")).toBeTruthy());
    const drugClassActions = actionsOfType(
      dispatch,
      AmrContextActionType.UPDATE_DRUG_CLASSES,
    );
    expect(drugClassActions).toHaveLength(1);
    expect(drugClassActions[0].payload.sort()).toEqual([
      "Beta-lactam",
      "Tetracycline",
    ]);
  });

  it("shows the null result when the run reports no rows", async () => {
    mockedGetResults.mockResolvedValue({ report_table_data: {} });
    await renderView();

    await waitFor(() =>
      expect(screen.getByTestId("amr-null-result")).toBeTruthy(),
    );
    expect(screen.queryByTestId("amr-report")).toBeNull();
  });

  it("treats a missing report_table_data as a null result rather than throwing", async () => {
    mockedGetResults.mockResolvedValue({});
    await renderView();

    await waitFor(() =>
      expect(screen.getByTestId("amr-null-result")).toBeTruthy(),
    );
  });

  it("applies the filter function supplied by the filters sidebar", async () => {
    await renderView();
    await waitFor(() => expect(screen.getByTestId("amr-report")).toBeTruthy());

    act(() => {
      fireEvent.click(screen.getByTestId("apply-gene-filter"));
    });

    expect(screen.getByTestId("amr-report").getAttribute("data-genes")).toBe(
      "geneA",
    );
  });

  it("toggles the filters sidebar visibility", async () => {
    await renderView();
    await waitFor(() => expect(screen.getByTestId("amr-report")).toBeTruthy());
    expect(
      screen.getByTestId("amr-filters").getAttribute("data-hide-filters"),
    ).toBe("true");

    act(() => {
      fireEvent.click(screen.getByTestId("toggle-filters"));
    });

    expect(
      screen.getByTestId("amr-filters").getAttribute("data-hide-filters"),
    ).toBe("false");
    expect(
      screen.getByTestId("amr-report").getAttribute("data-hide-filters"),
    ).toBe("false");
  });

  it("opens and closes the gene details sidebar", async () => {
    await renderView();
    await waitFor(() => expect(screen.getByTestId("amr-report")).toBeTruthy());
    expect(
      screen.getByTestId("details-sidebar").getAttribute("data-visible"),
    ).toBe("false");

    act(() => {
      fireEvent.click(screen.getByTestId("open-gene-details"));
    });
    expect(
      screen.getByTestId("details-sidebar").getAttribute("data-visible"),
    ).toBe("true");
    expect(
      screen.getByTestId("details-sidebar").getAttribute("data-gene"),
    ).toBe("geneA");
    expect(
      screen.getByTestId("details-sidebar").getAttribute("data-mode"),
    ).toBe("geneDetails");

    act(() => {
      fireEvent.click(screen.getByTestId("close-sidebar"));
    });
    expect(
      screen.getByTestId("details-sidebar").getAttribute("data-visible"),
    ).toBe("false");
  });

  it("clears the filtered-CSV link when no filters are active", async () => {
    const dispatch = jest.fn();
    await renderView({ dispatch, amrContextState: { activeFilters: null } });
    await waitFor(() => expect(screen.getByTestId("amr-report")).toBeTruthy());

    const linkActions = actionsOfType(
      dispatch,
      AmrContextActionType.UPDATE_REPORT_TABLE_DOWNLOAD_WITH_APPLIED_FILTERS_LINK,
    );
    expect(linkActions.length).toBeGreaterThan(0);
    expect(linkActions.every(action => action.payload === null)).toBe(true);
    expect(mockedComputeCSV).not.toHaveBeenCalled();
  });

  it("builds a filtered-CSV object URL when filters are active", async () => {
    const dispatch = jest.fn();
    const activeFilters = {
      drugClassFilters: {
        type: "multiple",
        params: { multiSelected: ["Tetracycline"] },
      },
    };
    await renderView({ dispatch, amrContextState: { activeFilters } });
    await waitFor(() => expect(screen.getByTestId("amr-report")).toBeTruthy());

    expect(mockedComputeCSV).toHaveBeenCalled();
    const computeArg = mockedComputeCSV.mock.calls.at(-1)[0];
    expect(computeArg.activeFilters).toBe(activeFilters);
    expect(Object.values(computeArg.displayedRows)).toHaveLength(3);
    expect(mockedCreateURL).toHaveBeenCalledWith(["header"], [["row"]]);

    const linkActions = actionsOfType(
      dispatch,
      AmrContextActionType.UPDATE_REPORT_TABLE_DOWNLOAD_WITH_APPLIED_FILTERS_LINK,
    );
    expect(linkActions.at(-1)!.payload).toBe("blob:amr-csv");
  });
});
