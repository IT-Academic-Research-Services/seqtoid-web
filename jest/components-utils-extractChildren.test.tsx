// Coverage for app/assets/src/components/utils/extractChildren.ts
//
// extractChildren splits a `children` prop by component *class name*, returning
// one entry per requested type (the FIRST match, or undefined when that type is
// absent). Slot-style layout components use it to place named children into
// fixed regions.
import React from "react";
import extractChildren from "~/components/utils/extractChildren";

function Header() {
  return <div>header</div>;
}
function Body() {
  return <div>body</div>;
}
function Sidebar() {
  return <div>sidebar</div>;
}

describe("extractChildren", () => {
  it("returns the matching child for each requested type, in the requested order", () => {
    const children = [<Body key="b" />, <Header key="h" />];

    const [header, body] = extractChildren(children, ["Header", "Body"]);

    expect((header as React.ReactElement).type).toBe(Header);
    expect((body as React.ReactElement).type).toBe(Body);
  });

  it("returns undefined for a type that is not present among the children", () => {
    const children = [<Header key="h" />];

    const [header, sidebar] = extractChildren(children, ["Header", "Sidebar"]);

    expect((header as React.ReactElement).type).toBe(Header);
    expect(sidebar).toBeUndefined();
  });

  it("returns only the first child of a repeated type", () => {
    const first = <Body key="1" data-which="first" />;
    const second = <Body key="2" data-which="second" />;

    const [body] = extractChildren([first, second], ["Body"]);

    expect((body as React.ReactElement).props["data-which"]).toBe("first");
  });

  it("accepts a single (non-array) child", () => {
    const [header] = extractChildren(<Header />, ["Header"]);

    expect((header as React.ReactElement).type).toBe(Header);
  });

  it("returns an empty array when no component types are requested", () => {
    expect(extractChildren([<Header key="h" />], [])).toEqual([]);
  });

  it("returns undefined entries when children is null/empty", () => {
    expect(extractChildren(null, ["Header", "Body"])).toEqual([
      undefined,
      undefined,
    ]);
    expect(extractChildren([], ["Header"])).toEqual([undefined]);
  });

  it("ignores host elements and text nodes, which have no component class name", () => {
    const children = [<div key="d" />, "some text", <Sidebar key="s" />];

    const [div, sidebar] = extractChildren(children, ["div", "Sidebar"]);

    // "div" is the string type of a host element, not a `type.name`, so it does
    // not match.
    expect(div).toBeUndefined();
    expect((sidebar as React.ReactElement).type).toBe(Sidebar);
  });
});
