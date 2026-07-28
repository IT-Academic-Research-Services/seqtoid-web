// Branch coverage for app/assets/src/components/ui/containers/TooltipVizTable.tsx
//
// Conditionals: the `title &&` / `subtitle &&` / `description &&` optional
// header/footer blocks, the `section.disabled &&` short circuits on both the
// section wrapper and its name, the `shouldCompactLabel &&` label modifier
// (data.length === 1 vs more), and the `getOr(value, "name", value)` fallback
// for object-shaped values.
import { render, screen } from "@testing-library/react";
import TooltipVizTable from "~/components/ui/containers/TooltipVizTable";

const sectionA = {
  name: "Coverage",
  data: [
    ["Depth", 42],
    ["Breadth", "88%"],
  ] as [string, string | number][],
};

const sectionB = {
  name: "Alignment",
  data: [["Score", 7]] as [string, string | number][],
};

describe("TooltipVizTable", () => {
  it("renders title, subtitle and description when all are provided", () => {
    render(
      <TooltipVizTable
        data={[sectionA]}
        title="NT Coverage"
        subtitle="accession ABC"
        description="Hover for details"
      />,
    );

    expect(screen.getByText("NT Coverage")).toBeTruthy();
    expect(screen.getByText("accession ABC")).toBeTruthy();
    expect(screen.getByText("Hover for details")).toBeTruthy();
    expect(screen.getByText("Coverage")).toBeTruthy();
    expect(screen.getByText("Depth")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("88%")).toBeTruthy();
  });

  it("omits the title, subtitle and description blocks when they are absent", () => {
    const { container } = render(<TooltipVizTable data={[sectionA]} />);

    expect(screen.queryByText("NT Coverage")).toBeNull();
    expect(screen.queryByText("Hover for details")).toBeNull();
    // Only the section subtree survives: table > section > (name + data > 2 rows > 2 cells each).
    expect(container.firstElementChild?.children.length).toBe(1);
    expect(screen.getByText("Breadth")).toBeTruthy();
  });

  it("renders both disabled and enabled sections", () => {
    render(
      <TooltipVizTable data={[{ ...sectionA, disabled: true }, sectionB]} />,
    );

    expect(screen.getByText("Coverage")).toBeTruthy();
    expect(screen.getByText("Alignment")).toBeTruthy();
    // A disabled section still renders its rows.
    expect(screen.getByText("Depth")).toBeTruthy();
    expect(screen.getByText("Score")).toBeTruthy();
  });

  it("compacts labels only when there is exactly one section", () => {
    const single = render(<TooltipVizTable data={[sectionB]} />);
    expect(single.container.firstElementChild?.children.length).toBe(1);
    expect(screen.getByText("Score")).toBeTruthy();

    single.unmount();

    const multiple = render(<TooltipVizTable data={[sectionA, sectionB]} />);
    expect(multiple.container.firstElementChild?.children.length).toBe(2);
    expect(screen.getByText("Depth")).toBeTruthy();
  });

  it("unwraps the `name` property of object-shaped values", () => {
    render(
      <TooltipVizTable
        data={[
          {
            name: "Taxon",
            data: [
              ["Species", { name: "Klebsiella pneumoniae" } as $TSFixMe],
              ["Reads", 1234],
            ],
          },
        ]}
      />,
    );

    // getOr(value, "name", value) picks the `name` key when present ...
    expect(screen.getByText("Klebsiella pneumoniae")).toBeTruthy();
    // ... and falls back to the raw value otherwise.
    expect(screen.getByText("1234")).toBeTruthy();
  });

  it("accepts react elements for the title, subtitle and description", () => {
    render(
      <TooltipVizTable
        data={[sectionB]}
        title={<em data-testid="node-title">Rich title</em>}
        subtitle={<em data-testid="node-subtitle">Rich subtitle</em>}
        description={<em data-testid="node-description">Rich description</em>}
      />,
    );

    expect(screen.getByTestId("node-title").textContent).toBe("Rich title");
    expect(screen.getByTestId("node-subtitle").textContent).toBe(
      "Rich subtitle",
    );
    expect(screen.getByTestId("node-description").textContent).toBe(
      "Rich description",
    );
  });
});
