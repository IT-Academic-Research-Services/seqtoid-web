// Coverage: app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/
//           components/MetadataTab/components/MetadataValue/MetadataValue.tsx
//
// MetadataValue is a tiny presentational leaf whose value is entirely in its
// branching: it renders an em-dash placeholder for undefined / null / empty
// string, unwraps the `name` field of an object value, and otherwise renders
// the value verbatim. Every one of those arms is driven below, including the
// object-without-a-name edge case.
import { render, screen } from "@testing-library/react";

// jest.config maps the webpack "~/" alias before its blanket scss -> styleMock
// rule, so a "~/"-aliased scss import reaches the transform as raw scss unless
// it is stubbed explicitly.
jest.mock(
  "~/components/common/DetailsSidebar/SampleDetailsMode/sample_details_mode.scss",
  () => ({}),
  { virtual: true },
);

import { MetadataValue } from "~/components/common/DetailsSidebar/SampleDetailsMode/components/MetadataTab/components/MetadataValue/MetadataValue";

describe("MetadataValue empty-value branches", () => {
  it("renders the em-dash placeholder when the value is undefined", () => {
    const { container } = render(<MetadataValue value={undefined} />);
    expect(container.textContent).toBe("--");
  });

  it("renders the em-dash placeholder when the value is null", () => {
    const { container } = render(<MetadataValue value={null} />);
    expect(container.textContent).toBe("--");
  });

  it("renders the em-dash placeholder for the empty string", () => {
    const { container } = render(<MetadataValue value="" />);
    expect(container.textContent).toBe("--");
  });

  it("does not treat a whitespace-only string as empty", () => {
    const { container } = render(<MetadataValue value=" " />);
    expect(container.textContent).toBe(" ");
    expect(container.textContent).not.toBe("--");
  });
});

describe("MetadataValue populated-value branches", () => {
  it("renders a plain string value verbatim", () => {
    render(<MetadataValue value="Serum" />);
    expect(screen.getByText("Serum")).toBeTruthy();
  });

  it("renders the string '0' rather than the placeholder", () => {
    const { container } = render(<MetadataValue value="0" />);
    expect(container.textContent).toBe("0");
  });

  it("unwraps the `name` field of an object value (e.g. a location)", () => {
    const { container } = render(
      <MetadataValue value={{ name: "California, USA" }} />,
    );
    expect(container.textContent).toBe("California, USA");
  });

  it("falls through to the raw object when `name` is undefined", () => {
    // The `value.name !== undefined` guard fails, so React is handed the raw
    // object as a child -- which React refuses to render. Asserting the throw
    // pins the behaviour of that otherwise-invisible branch.
    const consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    expect(() =>
      render(<MetadataValue value={{ name: undefined } as $TSFixMe} />),
    ).toThrow(/Objects are not valid as a React child/);
    consoleError.mockRestore();
  });

  it("renders an object whose `name` is an empty string as empty text", () => {
    const { container } = render(<MetadataValue value={{ name: "" }} />);
    expect(container.textContent).toBe("");
  });
});
