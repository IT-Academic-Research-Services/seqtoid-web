import { map } from "lodash/fp";
import moment from "moment";
import { ThresholdForAPI } from "~/components/utils/ThresholdMap";
import { WORKFLOWS, WorkflowType } from "~/components/utils/workflows";
import { NextGenFilters, SelectedFilters } from "~/interface/discoveryView";
import { FilterList } from "~/interface/samplesView";
import { TAB_PROJECTS, TAB_SAMPLES, TAB_VISUALIZATIONS } from "./constants";

///
// sessionStorage keys for sorting
///

export const getOrderKeyPrefix = (tab, workflow) => {
  // for samples, each workflow has its own order parameters
  return tab === TAB_SAMPLES ? `${tab}-${workflow}` : tab;
};

export const getOrderByKeyFor = (tab, workflow?: WorkflowType) => {
  return `${getOrderKeyPrefix(tab, workflow)}OrderBy`;
};

export const getOrderDirKeyFor = (tab, workflow?: WorkflowType) => {
  return `${getOrderKeyPrefix(tab, workflow)}OrderDir`;
};

const getOrderKeysForSamplesTab = () => {
  const orderKeys: string[] = [];
  const workflowKeys = Object.keys(WORKFLOWS) as WorkflowType[];
  workflowKeys.forEach(workflowKey => {
    orderKeys.push(getOrderByKeyFor(TAB_SAMPLES, workflowKey));
    orderKeys.push(getOrderDirKeyFor(TAB_SAMPLES, workflowKey));
  });
  return orderKeys;
};

export const getSessionOrderFieldsKeys = () => {
  return [
    getOrderByKeyFor(TAB_PROJECTS),
    getOrderDirKeyFor(TAB_PROJECTS),
    ...getOrderKeysForSamplesTab(),
    getOrderByKeyFor(TAB_VISUALIZATIONS),
    getOrderDirKeyFor(TAB_VISUALIZATIONS),
  ];
};

export const prepareFilters = (
  filters: SelectedFilters | Record<string, never>,
) => {
  const preparedFilters = {} as FilterList;
  const filtersToFormat = [
    "timeSelected",
    "taxonSelected",
    "taxonThresholdSelected",
  ];

  // We remove the "Selected" suffix from non-formatted filter keys
  Object.keys(filters).forEach(key => {
    if (!filtersToFormat.includes(key)) {
      preparedFilters[key.replace("Selected", "")] = filters[key];
    }
  });

  // Time is formatted: we translate values into date ranges
  if (filters.timeSelected) {
    const startDate = {
      "1_week": [7, "days"],
      "1_month": [1, "months"],
      "3_month": [3, "months"],
      "6_month": [6, "months"],
      "1_year": [1, "years"],
    };

    preparedFilters.time = [
      moment()
        .subtract(...startDate[filters.timeSelected])
        .format("YYYYMMDD"),
      moment().add(1, "days").format("YYYYMMDD"),
    ];
  }

  // Taxon is formatted: this filter needs to store complete option, so need to convert to values only
  if (filters.taxonSelected && filters.taxonSelected.length) {
    preparedFilters.taxaLevels = map("level", filters.taxonSelected);
    preparedFilters.taxon = map("id", filters.taxonSelected);
  }

  // Taxon Threshold is formatted: for compatibility with the API query
  if (Array.isArray(filters.taxonThresholdsSelected)) {
    preparedFilters.taxonThresholds = filters.taxonThresholdsSelected.reduce(
      (result, threshold) => {
        const parsedMetric = threshold["metric"].split(":");

        // basic validation that the metric contains a valid count type and metric
        if (
          parsedMetric.length === 2 &&
          ["nt", "nr"].includes(parsedMetric[0])
        ) {
          const [countType, metric] = parsedMetric;
          const { operator, value } = threshold;
          result.push({
            metric,
            count_type: countType.toUpperCase(),
            operator,
            value,
          });
        }

        return result;
      },
      [] as Array<ThresholdForAPI>,
    );
  }

  return preparedFilters;
};

///
// SMP-1620: expired-session (HTTP 401) handling for the discovery data loaders
///

// The /auth0/login entry point used elsewhere in the app (e.g. LandingHeaderV1) to
// (re)start the authentication flow.
const LOGIN_URL = "/auth0/login";

// The discovery loaders (samples/projects/visualizations/workflow runs) are preloaded
// fire-and-forget on /my_data (DiscoveryView loadPage/loadUserDataStats), with no catch.
// api/core.ts rejects an expired-session request with the Rails response body -- e.g.
// { error: "Unauthorized", code: 401 } -- a plain (non-Error) object. That surfaced as
// an uncaught "UnhandledRejection: Non-Error promise rejection captured with value:
// [error, Unauthorized][code, 401]" (DEV-REACTJS-PROJECT-1R) plus Sentry noise. A 401
// here is an EXPECTED auth-expiry condition, not a product defect.
export const isUnauthorizedError = (error: $TSFixMe): boolean => {
  if (error == null || typeof error !== "object") {
    return false;
  }
  // api/core.ts unwraps to the response body ({ code, error }); also tolerate a raw
  // axios error (error.response.status) in case a caller does not unwrap it first.
  return (
    error.code === 401 ||
    error.status === 401 ||
    error.error === "Unauthorized" ||
    error.response?.status === 401
  );
};

// Catch handler for the fire-and-forget discovery load promises. An expired-session
// 401 is handled gracefully -- send the user back through the login flow to re-auth --
// and swallowed, so it is neither an unhandled rejection nor Sentry noise. Any other
// (genuine) failure is re-thrown so it still propagates and is reported.
export const handleDiscoveryLoadError = (error: $TSFixMe): void => {
  if (isUnauthorizedError(error)) {
    window.location.href = LOGIN_URL;
    return;
  }
  throw error;
};

export const prepareNextGenFilters = (
  filters: SelectedFilters | Record<string, never>,
): NextGenFilters => {
  const preparedFilters: NextGenFilters = {
    taxonNames:
      filters.taxonSelected?.map(taxonObject => taxonObject.name) ?? [],
  };

  if (filters.timeSelected != null) {
    const date = new Date();
    switch (filters.timeSelected) {
      case "1_week":
        date.setDate(date.getDate() - 7);
        break;
      case "1_month":
        date.setMonth(date.getMonth() - 1);
        break;
      case "3_month":
        date.setMonth(date.getMonth() - 3);
        break;
      case "6_month":
        date.setMonth(date.getMonth() - 6);
        break;
      case "1_year":
        date.setMonth(date.getMonth() - 12);
        break;
    }
    preparedFilters.startedAtIso = date.toISOString();
  }

  return preparedFilters;
};
