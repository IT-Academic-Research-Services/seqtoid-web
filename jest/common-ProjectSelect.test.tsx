// Coverage: app/assets/src/components/common/ProjectSelect.tsx
//
// ProjectSelect is a thin adapter over SubtextDropdown: it sorts the incoming
// projects by name, maps each one to a {value, text, subtext} option where the
// subtext depends on public_access, and translates the dropdown's id-only
// onChange back into the full project object via lodash find. SubtextDropdown
// is stubbed so the derived options and the onChange translation can be
// asserted directly, and both sides of the public_access branch plus the
// "unknown id" find-miss are exercised.
import { fireEvent, render, screen } from "@testing-library/react";

let lastDropdownProps: $TSFixMe = null;

jest.mock("~ui/controls/dropdowns", () => ({
  __esModule: true,
  SubtextDropdown: (props: $TSFixMe) => {
    lastDropdownProps = props;
    return (
      <div data-testid="subtext-dropdown">
        {props.options.map((o: $TSFixMe) => (
          <button
            key={String(o.value)}
            data-testid={`option-${o.value}`}
            onClick={() => props.onChange(o.value)}
          >
            {o.text}
          </button>
        ))}
      </div>
    );
  },
}));

import ProjectSelect from "~/components/common/ProjectSelect";

const projects = [
  { id: 2, name: "Zebra project", public_access: 1 },
  { id: 1, name: "Alpha project", public_access: 0 },
  { id: 3, name: "Middle project", public_access: null },
];

beforeEach(() => {
  lastDropdownProps = null;
});

describe("ProjectSelect", () => {
  it("sorts the options by project name", () => {
    render(
      <ProjectSelect
        projects={projects as $TSFixMe}
        value={"1"}
        onChange={jest.fn()}
      />,
    );

    const texts = lastDropdownProps.options.map((o: $TSFixMe) => o.text);
    expect(texts).toEqual(["Alpha project", "Middle project", "Zebra project"]);
  });

  it("labels public and private projects differently (both sides of public_access)", () => {
    render(
      <ProjectSelect
        projects={projects as $TSFixMe}
        value={"1"}
        onChange={jest.fn()}
      />,
    );

    const byId = lastDropdownProps.options.reduce(
      (acc: $TSFixMe, o: $TSFixMe) => {
        acc[o.value] = o;
        return acc;
      },
      {},
    );
    // public_access truthy -> Public, falsy (0) -> Private, null -> Private.
    expect(byId[2].subtext).toBe("Public Project");
    expect(byId[1].subtext).toBe("Private Project");
    expect(byId[3].subtext).toBe("Private Project");
  });

  it("returns the whole project object to onChange, not just the id", () => {
    const onChange = jest.fn();
    render(
      <ProjectSelect
        projects={projects as $TSFixMe}
        value={"1"}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId("option-3"));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toEqual({
      id: 3,
      name: "Middle project",
      public_access: null,
    });
  });

  it("passes undefined to onChange when no project matches the selected id", () => {
    const onChange = jest.fn();
    render(
      <ProjectSelect
        projects={projects as $TSFixMe}
        value={"1"}
        onChange={onChange}
      />,
    );

    // Drive the dropdown callback directly with an id that is not in the list.
    lastDropdownProps.onChange(999);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("renders an empty option list for an empty projects array", () => {
    render(<ProjectSelect projects={[]} value={""} onChange={jest.fn()} />);
    expect(lastDropdownProps.options).toEqual([]);
    expect(screen.getByTestId("select-project")).toBeTruthy();
  });

  it("defaults showSelectedItemSubtext to true and forwards disabled/erred", () => {
    const { unmount } = render(
      <ProjectSelect
        projects={projects as $TSFixMe}
        value={"2"}
        onChange={jest.fn()}
      />,
    );
    expect(lastDropdownProps.showSelectedItemSubtext).toBe(true);
    expect(lastDropdownProps.disabled).toBeUndefined();
    expect(lastDropdownProps.erred).toBeUndefined();
    expect(lastDropdownProps.initialSelectedValue).toBe("2");
    unmount();

    render(
      <ProjectSelect
        projects={projects as $TSFixMe}
        value={"2"}
        onChange={jest.fn()}
        disabled
        erred
        showSelectedItemSubtext={false}
      />,
    );
    expect(lastDropdownProps.showSelectedItemSubtext).toBe(false);
    expect(lastDropdownProps.disabled).toBe(true);
    expect(lastDropdownProps.erred).toBe(true);
  });
});
