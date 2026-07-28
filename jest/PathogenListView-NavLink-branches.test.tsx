// Coverage:
//   app/assets/src/components/views/PathogenListView/components/AnchorMenu/components/SectionNavigation/components/NavLink/NavLink.tsx
//
// NavLink's only conditional is the `isCurrent ? currentNavItem : navItem`
// class ternary. Both sides are asserted, plus the click passthrough.
import { fireEvent, render, screen } from "@testing-library/react";

// jest.config.js maps every relative `*.scss` import to jest/__mocks__/styleMock,
// which exports {} -- so CSS-module class lookups come back undefined and the
// rendered className is empty. Replacing that shared mock with identity-ish
// class names is what makes the isCurrent ternary observable in the DOM.
jest.mock("./__mocks__/styleMock", () => ({
  navLink: "navLink",
  currentNavItem: "currentNavItem",
  navItem: "navItem",
}));

import { NavLink } from "~/components/views/PathogenListView/components/AnchorMenu/components/SectionNavigation/components/NavLink/NavLink";

describe("NavLink", () => {
  it("marks the item as current when isCurrent is true", () => {
    const { container } = render(
      <ul>
        <NavLink id="#viruses" isCurrent name="Viruses" onClick={jest.fn()} />
      </ul>,
    );

    const li = container.querySelector("li") as HTMLElement;
    expect(li.className).toContain("currentNavItem");
    expect(li.className).not.toContain("navItem");
  });

  it("uses the plain item class when isCurrent is false", () => {
    const { container } = render(
      <ul>
        <NavLink
          id="#bacteria"
          isCurrent={false}
          name="Bacteria"
          onClick={jest.fn()}
        />
      </ul>,
    );

    const li = container.querySelector("li") as HTMLElement;
    expect(li.className).toContain("navItem");
    expect(li.className).not.toContain("currentNavItem");
  });

  it("renders the name as an anchor pointing at the section id", () => {
    render(
      <ul>
        <NavLink
          id="#fungi"
          isCurrent={false}
          name="Fungi"
          onClick={jest.fn()}
        />
      </ul>,
    );

    const anchor = screen.getByText("Fungi") as HTMLAnchorElement;
    expect(anchor.tagName).toBe("A");
    expect(anchor.getAttribute("href")).toBe("#fungi");
  });

  it("forwards clicks to the supplied handler", () => {
    const onClick = jest.fn();
    render(
      <ul>
        <NavLink
          id="#parasites"
          isCurrent={false}
          name="Parasites"
          onClick={onClick}
        />
      </ul>,
    );

    fireEvent.click(screen.getByText("Parasites"));

    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
