// Coverage: app/assets/src/components/views/SampleView/components/AmrView/
//   components/AmrSampleReport/components/ToggleVisibleColumnsDropdown/
//   ToggleVisibleColumnsDropdown.tsx
//
// Companion to AmrSampleReport-ToggleVisibleColumnsDropdown.test.tsx, which
// covers the option/visibility plumbing. This file drives the parts of the
// component that only run through the DropdownMenu render props and keyboard
// handlers: the groupBy accessor, the renderGroup section wrapper (including
// the ToggleAllButton it embeds and the apply callback that button is handed),
// the click-away close, and the Escape handler -- which, unlike click-away,
// must also return focus to the trigger button.
import { act, fireEvent, render, screen } from "@testing-library/react";

let lastMenuProps: $TSFixMe = null;
jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    ButtonIcon: (props: $TSFixMe) =>
      ReactLib.createElement("button", {
        "data-testid": "toggle-visible-columns-button",
        onClick: props.onClick,
      }),
    Tooltip: (props: $TSFixMe) => props.children,
    DropdownMenu: (props: $TSFixMe) => {
      lastMenuProps = props;
      return props.open
        ? ReactLib.createElement(
            "div",
            { "data-testid": "columns-menu" },
            // exercise the renderGroup render prop with a real section
            props.renderGroup({
              key: "Contigs",
              group: "Contigs",
              children: ReactLib.createElement(
                "span",
                { "data-testid": "group-children" },
                "options",
              ),
            }),
          )
        : null;
    },
    DefaultDropdownMenuOption: {},
  };
});

const mockPersistColumnVisibility = jest.fn();
jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/columnDefinitions/columnDefUtils",
  () => ({
    persistColumnVisibilityToLocalStorage: (...args: $TSFixMe[]) =>
      mockPersistColumnVisibility(...args),
  }),
);

let lastToggleAllProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/components/ToggleVisibleColumnsDropdown/components/ToggleAllButton",
  () => ({
    ToggleAllButton: (props: $TSFixMe) => {
      lastToggleAllProps = props;
      const ReactLib = require("react");
      return ReactLib.createElement("button", {
        "data-testid": "toggle-all-button",
      });
    },
  }),
);

import { ToggleVisibleColumnsDropdown } from "~/components/views/SampleView/components/AmrView/components/AmrSampleReport/components/ToggleVisibleColumnsDropdown/ToggleVisibleColumnsDropdown";
import { COLUMN_ID_TO_NAME } from "~/components/views/SampleView/components/AmrView/constants";

const makeColumn = (id: string, visible: boolean) => {
  let isVisible = visible;
  return {
    id,
    getIsVisible: () => isVisible,
    toggleVisibility: jest.fn((next: boolean) => {
      isVisible = next;
    }),
  };
};

const buildTable = () => {
  const gene = makeColumn("gene", true);
  const contigs = makeColumn("contigs", true);
  const reads = makeColumn("reads", false);
  const all = [gene, contigs, reads];
  // Stable reference: the visible-columns effect depends on this array.
  const visible = [gene, contigs];
  const byId: $TSFixMe = { gene, contigs, reads };
  return {
    columns: byId,
    table: {
      getAllLeafColumns: () => all,
      getVisibleLeafColumns: () => visible,
      getColumn: (id: string) => byId[id],
    } as $TSFixMe,
  };
};

const openMenu = () => {
  const { table, columns } = buildTable();
  render(<ToggleVisibleColumnsDropdown table={table} />);
  fireEvent.click(screen.getByTestId("toggle-visible-columns-button"));
  return { table, columns };
};

beforeEach(() => {
  jest.clearAllMocks();
  lastMenuProps = null;
  lastToggleAllProps = null;
});

describe("ToggleVisibleColumnsDropdown grouping", () => {
  it("groups options by their column section", () => {
    const { table } = buildTable();
    render(<ToggleVisibleColumnsDropdown table={table} />);
    expect(lastMenuProps.groupBy({ name: "Contigs", section: "Contigs" })).toBe(
      "Contigs",
    );
    expect(lastMenuProps.groupBy({ name: "Reads", section: "Reads" })).toBe(
      "Reads",
    );
  });

  it("renders the section title, a toggle-all button and the group children", () => {
    openMenu();
    expect(screen.getByText("Contigs")).toBeTruthy();
    expect(screen.getByTestId("toggle-all-button")).toBeTruthy();
    expect(screen.getByTestId("group-children").textContent).toBe("options");
  });

  it("hands the toggle-all button the section and the full option list", () => {
    openMenu();
    expect(lastToggleAllProps.section).toBe("Contigs");
    const names = lastToggleAllProps.dropdownOptions.map(
      (o: $TSFixMe) => o.name,
    );
    expect(names).toEqual([
      COLUMN_ID_TO_NAME.get("contigs"),
      COLUMN_ID_TO_NAME.get("reads"),
    ]);
    expect(
      lastToggleAllProps.dropdownValue.map((o: $TSFixMe) => o.name),
    ).toEqual([COLUMN_ID_TO_NAME.get("contigs")]);
  });

  it("applies a toggle-all selection through the same visibility path", () => {
    const { columns } = openMenu();
    act(() =>
      lastToggleAllProps.setPendingOptions([
        { name: COLUMN_ID_TO_NAME.get("contigs") },
        { name: COLUMN_ID_TO_NAME.get("reads") },
      ]),
    );
    expect(columns.reads.toggleVisibility).toHaveBeenCalledWith(true);
    expect(mockPersistColumnVisibility).toHaveBeenCalledWith([
      "gene",
      "contigs",
      "reads",
    ]);
  });
});

describe("ToggleVisibleColumnsDropdown dismissal", () => {
  it("closes the menu on click-away without moving focus", () => {
    openMenu();
    const trigger = screen.getByTestId("toggle-visible-columns-button");
    const focusSpy = jest.spyOn(trigger, "focus");

    act(() => lastMenuProps.onClickAway());
    expect(screen.queryByTestId("columns-menu")).toBeNull();
    expect(focusSpy).not.toHaveBeenCalled();
  });

  it("closes the menu on Escape and returns focus to the trigger", () => {
    openMenu();
    const trigger = screen.getByTestId("toggle-visible-columns-button");
    const focusSpy = jest.spyOn(trigger, "focus");

    act(() => lastMenuProps.onKeyDown({ key: "Escape" }));
    expect(screen.queryByTestId("columns-menu")).toBeNull();
    expect(focusSpy).toHaveBeenCalled();
  });

  it("leaves the menu open for any other key", () => {
    openMenu();
    act(() => lastMenuProps.onKeyDown({ key: "ArrowDown" }));
    expect(screen.getByTestId("columns-menu")).toBeTruthy();
  });

  it("ignores Escape when the menu was never opened", () => {
    const { table } = buildTable();
    render(<ToggleVisibleColumnsDropdown table={table} />);
    // anchorEl is still null here, so the focus branch must be skipped.
    act(() => lastMenuProps.onKeyDown({ key: "Escape" }));
    expect(screen.queryByTestId("columns-menu")).toBeNull();
  });
});
