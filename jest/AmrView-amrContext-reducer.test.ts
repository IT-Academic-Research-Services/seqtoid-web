// Coverage: app/assets/src/components/views/SampleView/components/AmrView/amrContext/reducer.ts
//
// The AMR context reducer is a plain switch over four action types. Every case
// is exercised here, including the one guarded branch (a null payload on
// UPDATE_ACTIVE_THRESHOLD_FILTERS must leave activeFilters untouched) and the
// unmatched-action fall-through, which the switch deliberately does not handle.
import {
  AmrContextActionType,
  amrContextReducer,
  createAmrContextAction,
} from "~/components/views/SampleView/components/AmrView/amrContext/reducer";

const baseState = () => ({
  reportTableDownloadWithAppliedFiltersLink: null,
  activeFilters: {
    contigs: {
      key: "contigs",
      params: { thresholdFilters: [] },
      type: "threshold",
    },
  },
  drugClasses: null,
});

describe("createAmrContextAction", () => {
  it("packages the type and payload into an action object", () => {
    const action = createAmrContextAction(
      AmrContextActionType.UPDATE_DRUG_CLASSES,
      ["aminoglycoside"],
    );
    expect(action).toEqual({
      type: AmrContextActionType.UPDATE_DRUG_CLASSES,
      payload: ["aminoglycoside"],
    });
  });

  it("preserves a null payload", () => {
    expect(
      createAmrContextAction(
        AmrContextActionType.UPDATE_ACTIVE_DRUG_CLASS_FILTERS,
        null,
      ),
    ).toEqual({
      type: AmrContextActionType.UPDATE_ACTIVE_DRUG_CLASS_FILTERS,
      payload: null,
    });
  });
});

describe("amrContextReducer", () => {
  it("sets the download link and leaves the rest of the state alone", () => {
    const state = baseState() as $TSFixMe;
    const next = amrContextReducer(
      state,
      createAmrContextAction(
        AmrContextActionType.UPDATE_REPORT_TABLE_DOWNLOAD_WITH_APPLIED_FILTERS_LINK,
        "/downloads/amr.csv",
      ) as $TSFixMe,
    ) as $TSFixMe;

    expect(next.reportTableDownloadWithAppliedFiltersLink).toBe(
      "/downloads/amr.csv",
    );
    expect(next.activeFilters).toBe(state.activeFilters);
    expect(next).not.toBe(state);
  });

  it("clears the download link when the payload is null", () => {
    const state = {
      ...baseState(),
      reportTableDownloadWithAppliedFiltersLink: "/downloads/old.csv",
    } as $TSFixMe;
    const next = amrContextReducer(
      state,
      createAmrContextAction(
        AmrContextActionType.UPDATE_REPORT_TABLE_DOWNLOAD_WITH_APPLIED_FILTERS_LINK,
        null,
      ) as $TSFixMe,
    ) as $TSFixMe;

    expect(next.reportTableDownloadWithAppliedFiltersLink).toBeNull();
  });

  it("merges threshold filters into the existing activeFilters", () => {
    const state = baseState() as $TSFixMe;
    const payload = {
      reads: {
        key: "reads",
        params: { thresholdFilters: [{ operator: ">=", value: "5" }] },
        type: "threshold",
      },
    };
    const next = amrContextReducer(
      state,
      createAmrContextAction(
        AmrContextActionType.UPDATE_ACTIVE_THRESHOLD_FILTERS,
        payload,
      ) as $TSFixMe,
    ) as $TSFixMe;

    // The pre-existing contigs filter survives, the new reads filter is added.
    expect(Object.keys(next.activeFilters).sort()).toEqual([
      "contigs",
      "reads",
    ]);
    expect(next.activeFilters.reads.params.thresholdFilters).toHaveLength(1);
  });

  it("overwrites an existing key when the threshold payload repeats it", () => {
    const state = baseState() as $TSFixMe;
    const next = amrContextReducer(
      state,
      createAmrContextAction(
        AmrContextActionType.UPDATE_ACTIVE_THRESHOLD_FILTERS,
        {
          contigs: {
            key: "contigs",
            params: { thresholdFilters: [{ operator: "<=", value: "2" }] },
            type: "threshold",
          },
        },
      ) as $TSFixMe,
    ) as $TSFixMe;

    expect(next.activeFilters.contigs.params.thresholdFilters).toEqual([
      { operator: "<=", value: "2" },
    ]);
  });

  it("returns a state copy without touching activeFilters when the threshold payload is null", () => {
    const state = baseState() as $TSFixMe;
    const next = amrContextReducer(
      state,
      createAmrContextAction(
        AmrContextActionType.UPDATE_ACTIVE_THRESHOLD_FILTERS,
        null,
      ) as $TSFixMe,
    ) as $TSFixMe;

    expect(next).not.toBe(state);
    expect(next.activeFilters).toBe(state.activeFilters);
    expect(next).toEqual(state);
  });

  it("stores the drug class filter under activeFilters.drugClassFilters", () => {
    const state = baseState() as $TSFixMe;
    const drugClassFilter = {
      key: "drugClass",
      params: { multiSelected: ["tetracycline"] },
      type: "multiple",
    };
    const next = amrContextReducer(
      state,
      createAmrContextAction(
        AmrContextActionType.UPDATE_ACTIVE_DRUG_CLASS_FILTERS,
        drugClassFilter,
      ) as $TSFixMe,
    ) as $TSFixMe;

    expect(next.activeFilters.drugClassFilters).toBe(drugClassFilter);
    // The unrelated contigs filter is preserved.
    expect(next.activeFilters.contigs).toBe(state.activeFilters.contigs);
  });

  it("nulls out the drug class filter when the payload is null", () => {
    const state = baseState() as $TSFixMe;
    const next = amrContextReducer(
      state,
      createAmrContextAction(
        AmrContextActionType.UPDATE_ACTIVE_DRUG_CLASS_FILTERS,
        null,
      ) as $TSFixMe,
    ) as $TSFixMe;

    expect(next.activeFilters.drugClassFilters).toBeNull();
  });

  it("replaces the drug classes list", () => {
    const state = baseState() as $TSFixMe;
    const next = amrContextReducer(
      state,
      createAmrContextAction(AmrContextActionType.UPDATE_DRUG_CLASSES, [
        "beta-lactam",
        "macrolide",
      ]) as $TSFixMe,
    ) as $TSFixMe;

    expect(next.drugClasses).toEqual(["beta-lactam", "macrolide"]);
    expect(next.reportTableDownloadWithAppliedFiltersLink).toBeNull();
  });

  it("returns undefined for an action type it does not handle", () => {
    const state = baseState() as $TSFixMe;
    expect(
      amrContextReducer(state, { type: "NOT_A_REAL_ACTION" } as $TSFixMe),
    ).toBeUndefined();
  });
});
