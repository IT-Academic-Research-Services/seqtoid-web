// Coverage: app/assets/src/components/views/SampleView/components/AmrView/
//   components/AmrFiltersContainer/components/DrugClassFilter/DrugClassFilter.tsx
//
// DrugClassFilter turns the drug classes held in AmrContext into a sorted
// ComplexFilter option list and, on change, dispatches an
// UPDATE_ACTIVE_DRUG_CLASS_FILTERS action carrying a multi-select filter whose
// transform splits a row's semicolon-delimited drugClass string. The SDS
// ComplexFilter is stubbed so the options it receives and the onChange callback
// are directly drivable; both the hideFilters early-return and the
// missing/empty drug-class branches are exercised.
import { render, screen } from "@testing-library/react";

let lastFilterProps: $TSFixMe = null;
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    ComplexFilter: (props: $TSFixMe) => {
      lastFilterProps = props;
      return ReactLib.createElement("div", {
        "data-testid": "complex-filter",
        "data-option-count": String(props.options.length),
        "data-multiple": String(props.multiple),
        "data-trigger-on-click": String(props.isTriggerChangeOnOptionClick),
      });
    },
    DefaultDropdownMenuOption: {},
  };
});

import {
  AmrContext,
  AmrContextActionType,
} from "~/components/views/SampleView/components/AmrView/amrContext/reducer";
import { DrugClassFilter } from "~/components/views/SampleView/components/AmrView/components/AmrFiltersContainer/components/DrugClassFilter/DrugClassFilter";

const renderFilter = (
  contextValue: $TSFixMe,
  props: { hideFilters?: boolean } = {},
) => {
  const amrContextDispatch = jest.fn();
  const value =
    contextValue === undefined ? {} : { ...contextValue, amrContextDispatch };
  const utils = render(
    <AmrContext.Provider value={value as $TSFixMe}>
      <DrugClassFilter {...props} />
    </AmrContext.Provider>,
  );
  return { amrContextDispatch, ...utils };
};

const withDrugClasses = (drugClasses: string[] | null) => ({
  amrContextState: { drugClasses },
});

describe("DrugClassFilter", () => {
  beforeEach(() => {
    lastFilterProps = null;
  });

  it("renders nothing when the filter panel is hidden", () => {
    renderFilter(withDrugClasses(["macrolide"]), { hideFilters: true });
    expect(screen.queryByTestId("complex-filter")).toBeNull();
    expect(lastFilterProps).toBeNull();
  });

  it("renders a multi-select filter when the panel is visible", () => {
    renderFilter(withDrugClasses(["macrolide"]), { hideFilters: false });
    const filter = screen.getByTestId("complex-filter");
    expect(filter.getAttribute("data-multiple")).toBe("true");
    expect(filter.getAttribute("data-trigger-on-click")).toBe("true");
    expect(lastFilterProps.DropdownMenuProps.title).toBe("Select Drug Class");
    expect(lastFilterProps.InputDropdownProps.sdsStyle).toBe("minimal");
  });

  it("renders when hideFilters is omitted entirely", () => {
    renderFilter(withDrugClasses(["tetracycline"]));
    expect(screen.getByTestId("complex-filter")).toBeTruthy();
  });

  it("sorts the drug classes from context into options", () => {
    renderFilter(
      withDrugClasses(["tetracycline", "aminoglycoside", "macrolide"]),
    );
    expect(lastFilterProps.options).toEqual([
      { name: "aminoglycoside" },
      { name: "macrolide" },
      { name: "tetracycline" },
    ]);
    expect(
      screen.getByTestId("complex-filter").getAttribute("data-option-count"),
    ).toBe("3");
  });

  it("falls back to an empty option list when drugClasses is null", () => {
    renderFilter(withDrugClasses(null));
    expect(lastFilterProps.options).toEqual([]);
  });

  it("falls back to an empty option list when there is no context state", () => {
    renderFilter(undefined);
    expect(lastFilterProps.options).toEqual([]);
  });

  it("dispatches a drug class filter update when options are selected", () => {
    const { amrContextDispatch } = renderFilter(
      withDrugClasses(["macrolide", "tetracycline"]),
    );

    lastFilterProps.onChange([{ name: "macrolide" }, { name: "tetracycline" }]);

    expect(amrContextDispatch).toHaveBeenCalledTimes(1);
    const action = amrContextDispatch.mock.calls[0][0];
    expect(action.type).toBe(
      AmrContextActionType.UPDATE_ACTIVE_DRUG_CLASS_FILTERS,
    );
    expect(action.payload.key).toBe("drugClass");
    expect(action.payload.type).toBe("multiple");
    expect(action.payload.params.multiSelected).toEqual([
      "macrolide",
      "tetracycline",
    ]);
  });

  it("dispatches an empty selection when everything is deselected", () => {
    const { amrContextDispatch } = renderFilter(withDrugClasses(["macrolide"]));
    lastFilterProps.onChange([]);
    expect(
      amrContextDispatch.mock.calls[0][0].payload.params.multiSelected,
    ).toEqual([]);
  });
});

describe("DrugClassFilter dispatched transform", () => {
  it("splits a semicolon-delimited drug class list and trims each entry", () => {
    const amrContextDispatch = jest.fn();
    render(
      <AmrContext.Provider
        value={
          {
            amrContextState: { drugClasses: ["macrolide"] },
            amrContextDispatch,
          } as $TSFixMe
        }
      >
        <DrugClassFilter hideFilters={false} />
      </AmrContext.Provider>,
    );
    lastFilterProps.onChange([{ name: "macrolide" }]);
    const { transform } = amrContextDispatch.mock.calls[0][0].payload;
    expect(transform({ drugClass: "macrolide; tetracycline" })).toEqual([
      "macrolide",
      "tetracycline",
    ]);
    expect(transform({ drugClass: "beta-lactam" })).toEqual(["beta-lactam"]);
  });
});
