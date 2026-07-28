// Branch coverage: app/assets/src/components/ui/containers/Modal.tsx
//
// The modal is a thin wrapper over semantic-ui's Modal whose only logic is the
// set of size/appearance modifier classes it composes and the two optional
// chrome elements (title header, close icon). Every modifier is off in the
// default render, so each `flag && cs.flag` short-circuit needs a render with
// the flag on.

// Every .scss import is mapped to an empty object repo-wide, which would erase
// the composed class names. Real names make the modifiers observable.
jest.mock("./__mocks__/styleMock", () => {
  const names = [
    "modal",
    "narrow",
    "narrowest",
    "tall",
    "wide",
    "fixedHeight",
    "minimumHeight",
    "closeIcon",
    "xl",
    "s",
  ];
  const styles = Object.fromEntries(names.map(name => [name, name]));
  return { __esModule: true, default: styles, ...styles };
});

import { render, screen } from "@testing-library/react";
import Modal from "~/components/ui/containers/Modal";

// IconClose renders a bare <svg> and does not forward data-testid, so it is
// found by the class the modal composes for it.
const closeIcon = () => document.querySelector("svg.closeIcon");

const modalClasses = () =>
  (document.querySelector(".ui.modal")?.getAttribute("class") ?? "").split(
    /\s+/,
  );

describe("Modal size modifiers", () => {
  it("composes every size class that is switched on", () => {
    render(
      <Modal
        open
        narrow
        narrowest
        tall
        wide
        fixedHeight
        minimumHeight
        className="caller-class"
      >
        body
      </Modal>,
    );

    const classes = modalClasses();
    expect(classes).toEqual(
      expect.arrayContaining([
        "modal",
        "caller-class",
        "narrow",
        "narrowest",
        "tall",
        "wide",
        "fixedHeight",
        "minimumHeight",
      ]),
    );
  });

  it("composes none of them by default", () => {
    render(<Modal open>body</Modal>);

    const classes = modalClasses();
    expect(classes).toContain("modal");
    for (const modifier of [
      "narrow",
      "narrowest",
      "tall",
      "wide",
      "fixedHeight",
      "minimumHeight",
    ]) {
      expect(classes).not.toContain(modifier);
    }
  });
});

describe("Modal optional chrome", () => {
  it("renders a header only when a title is given", () => {
    render(
      <Modal open title="Delete samples">
        body
      </Modal>,
    );
    expect(screen.getByText("Delete samples")).toBeTruthy();
  });

  it("renders no header without a title", () => {
    const { container } = render(<Modal open>body</Modal>);
    expect(container.ownerDocument.querySelector(".header")).toBeNull();
  });

  it("renders no close icon without an onClose handler", () => {
    render(<Modal open>body</Modal>);
    expect(closeIcon()).toBeNull();
  });

  it("sizes the close icon from the xl and s flags", () => {
    render(
      <Modal open onClose={jest.fn()} xlCloseIcon sCloseIcon>
        body
      </Modal>,
    );
    const icon = closeIcon();
    expect(icon).not.toBeNull();
    const classes = (icon?.getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(["closeIcon", "xl", "s"]));
  });

  it("leaves the close icon unsized by default", () => {
    render(
      <Modal open onClose={jest.fn()}>
        body
      </Modal>,
    );
    const classes = (closeIcon()?.getAttribute("class") ?? "").split(/\s+/);
    expect(classes).toContain("closeIcon");
    expect(classes).not.toContain("xl");
    expect(classes).not.toContain("s");
  });
});
