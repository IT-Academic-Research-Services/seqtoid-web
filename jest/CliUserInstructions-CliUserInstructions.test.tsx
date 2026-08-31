// Coverage: app/assets/src/components/views/CliUserInstructions/CliUserInstructions.tsx
//
// The vendored CLI README (app/views/samples/cli_user_instructions.md) uses
// in-page anchor links -- [installing from binaries](#from-binaries) -- that
// rely on GitHub's automatic heading-slug ids. react-markdown emits no such ids
// on its own, so those anchors had no target in the help-center render. These
// assertions pin that the component's heading `components` override renders
// GitHub-style slug ids so the anchors resolve, and that "From Binaries" in
// particular carries the #from-binaries target the three links point at.
// (SMP-1886)
import { render } from "@testing-library/react";

// react-markdown@10 is ESM-only all the way down its unified/micromark
// dependency chain and jest's resolver cannot load it (it is intentionally not
// in transformIgnorePatterns), so it is stubbed here -- the same approach the
// PipelineStepDetailsMode suite uses. This lightweight stub does just enough
// markdown parsing to invoke the component's `components` overrides: it maps
// each heading line through the matching hN override (which is exactly the code
// under test -- the slug/id logic) and renders link lines as anchors. That way
// the assertions exercise the real override rather than a reimplementation.
jest.mock("react-markdown", () => ({
  __esModule: true,
  default: ({ children, components }: $TSFixMe) => {
    const ReactLib = require("react");
    if (typeof children !== "string") {
      throw new Error(
        "Unexpected value for `children` prop, expected `string` but got " +
          Object.prototype.toString.call(children),
      );
    }
    const nodes = children.split("\n").map((line: string, i: number) => {
      const heading = line.match(/^(#{1,6})\s+(.*\S)\s*$/);
      if (heading) {
        const tag = "h" + heading[1].length;
        const Tag = (components && components[tag]) || tag;
        return ReactLib.createElement(Tag, { key: i }, heading[2]);
      }
      const link = line.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (link) {
        const Anchor = (components && components.a) || "a";
        return ReactLib.createElement(
          Anchor,
          { key: i, href: link[2] },
          link[1],
        );
      }
      return null;
    });
    return ReactLib.createElement("div", null, nodes);
  },
}));

import { CliUserInstructions } from "~/components/views/CliUserInstructions/CliUserInstructions";

describe("CliUserInstructions", () => {
  it("assigns the From Binaries heading a #from-binaries slug id", () => {
    const { container } = render(
      <CliUserInstructions readme={"#### From Binaries\n\nsome body"} />,
    );
    const heading = container.querySelector("h4");
    expect(heading).not.toBeNull();
    expect(heading?.getAttribute("id")).toBe("from-binaries");
  });

  it("slugs multi-word headings the way the in-page anchor links expect", () => {
    const { container } = render(
      <CliUserInstructions readme={"##### Other Linux: Without Homebrew\n"} />,
    );
    expect(container.querySelector("h5")?.getAttribute("id")).toBe(
      "other-linux-without-homebrew",
    );
  });

  it("resolves the [installing from binaries](#from-binaries) link against the heading id", () => {
    const readme = [
      "##### Without Homebrew",
      "Follow the instructions for [installing from binaries](#from-binaries).",
      "#### From Binaries",
    ].join("\n");
    const { container } = render(<CliUserInstructions readme={readme} />);

    const link = container.querySelector('a[href="#from-binaries"]');
    expect(link).not.toBeNull();

    const target = container.querySelector("#from-binaries");
    expect(target).not.toBeNull();
    expect(target?.tagName.toLowerCase()).toBe("h4");
  });
});
