// Coverage: app/assets/src/components/views/CliUserInstructions/CliUserInstructions.tsx
//
// The vendored CLI README (app/views/samples/cli_user_instructions.md) uses
// in-page anchor links -- [installing from binaries](#from-binaries) -- that
// rely on GitHub's automatic heading-slug ids. react-markdown emits no such ids
// on its own, so those anchors had no target in the help-center render. These
// assertions pin that headings render with GitHub-style slug ids so the anchors
// resolve, and that the "From Binaries" heading in particular carries the
// #from-binaries target the three links point at. (SMP-1886)
import { render } from "@testing-library/react";
import React from "react";
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
      "",
      "Follow the instructions for [installing from binaries](#from-binaries).",
      "",
      "#### From Binaries",
      "",
      "body",
    ].join("\n");
    const { container } = render(<CliUserInstructions readme={readme} />);

    const link = container.querySelector('a[href="#from-binaries"]');
    expect(link).not.toBeNull();

    const target = container.querySelector("#from-binaries");
    expect(target).not.toBeNull();
    expect(target?.tagName.toLowerCase()).toBe("h4");
  });
});
