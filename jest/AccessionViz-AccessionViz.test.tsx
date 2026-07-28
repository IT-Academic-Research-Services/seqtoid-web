// Frontend coverage:
// app/assets/src/components/views/AlignmentViz/components/AccessionViz/AccessionViz.tsx
//
// AccessionViz is a class component (wrapped in a function component that only
// injects the analytics hook) that paginates the reads for one accession and
// optionally renders a coverage summary and coverage table. The tests below
// exercise: the paged read slice, the "View more reads" pagination branch, the
// two coverage renderers (present vs absent), and the header metadata. ReadViz
// is stubbed so the assertions target AccessionViz's own logic, not the read
// alignment parser (which has its own suite).
import { render, screen } from "@testing-library/react";
import { AccessionViz } from "~/components/views/AlignmentViz/components/AccessionViz/AccessionViz";

jest.mock("~/api/analytics", () => ({
  useWithAnalytics: () => (fn: $TSFixMe) => fn,
}));

// Stub ReadViz -- it has its own suite and pulls in the alignment parser.
jest.mock(
  "~/components/views/AlignmentViz/components/AccessionViz/components/ReadViz",
  () => ({
    __esModule: true,
    default: ({ name }: { name: string }) => (
      <div data-testid="read-viz">{name}</div>
    ),
  }),
);

// Each read tuple is [name, sequence, metrics, refInfo].
const makeReads = (n: number) =>
  Array.from({ length: n }, (_, i) => [
    `read_${i}`,
    "ACGT",
    ["99.0"],
    ["AAA", "CGTT", "T"],
  ]);

describe("AccessionViz", () => {
  it("renders the accession header, reference info and read count", () => {
    render(
      <AccessionViz
        accession="ACC1"
        name="Some Organism"
        ref_seq="ACGTACGT"
        ref_seq_len={8}
        ref_link="https://ncbi.example/ACC1"
        reads_count={2}
        reads={makeReads(2) as $TSFixMe}
        readsPerPage={20}
      />,
    );
    expect(screen.getByText(/ACC1/).textContent).toContain("Some Organism");
    expect(screen.getByText("NCBI URL").getAttribute("href")).toBe(
      "https://ncbi.example/ACC1",
    );
    // Both reads fit on the first page.
    expect(screen.getAllByTestId("read-viz")).toHaveLength(2);
  });

  it("only renders the first page of reads when there are more than fit", () => {
    render(
      <AccessionViz
        accession="ACC1"
        name="Org"
        reads={makeReads(5) as $TSFixMe}
        readsPerPage={2}
      />,
    );
    // First page = 2 of 5 reads; the remaining reads are not rendered yet.
    expect(screen.getAllByTestId("read-viz")).toHaveLength(2);
    // On the initial mount `rendering` is still true, so the pagination link
    // is suppressed even though there are more reads to show.
    expect(screen.queryByText("View more reads")).toBeNull();
  });

  it("does not render the 'View more reads' link when all reads fit", () => {
    render(
      <AccessionViz
        accession="ACC1"
        name="Org"
        reads={makeReads(2) as $TSFixMe}
        readsPerPage={10}
      />,
    );
    expect(screen.queryByText("View more reads")).toBeNull();
  });

  it("omits both coverage renderers when coverageSummary is empty", () => {
    render(
      <AccessionViz
        accession="ACC1"
        name="Org"
        reads={makeReads(1) as $TSFixMe}
        readsPerPage={10}
      />,
    );
    expect(screen.queryByText("Coverage Details")).toBeNull();
    expect(screen.queryByText(/Read Length:/)).toBeNull();
  });

  it("renders the coverage summary computed from the coverage totals", () => {
    render(
      <AccessionViz
        accession="ACC1"
        name="Org"
        reads={makeReads(1) as $TSFixMe}
        readsPerPage={10}
        coverageSummary={{
          total_read_length: 200,
          num_reads: 2,
          total_aligned_length: 180,
          total_mismatched_length: 18,
          ref_seq_len: 360,
          distinct_covered_length: 90,
        }}
      />,
    );
    // Read Length = 200 / 2 = 100.
    expect(screen.getByText(/Read Length:/).textContent).toContain("100");
    // Coverage = 180 / 360 * 100 = 50.
    expect(document.body.textContent).toContain("Coverage:");
    expect(document.body.textContent).toContain("50 %");
  });

  it("renders the coverage table when coverage rows are provided", () => {
    render(
      <AccessionViz
        accession="ACC1"
        name="Org"
        reads={makeReads(1) as $TSFixMe}
        readsPerPage={10}
        coverageSummary={{
          coverage: [
            ["0-99", 5],
            ["100-199", 8],
          ],
        }}
      />,
    );
    expect(screen.getByText("Coverage Details")).toBeTruthy();
    expect(screen.getByText("Read Count")).toBeTruthy();
    expect(screen.getByText("Position Range")).toBeTruthy();
    // Row values from the two coverage buckets.
    expect(screen.getByText("0-99")).toBeTruthy();
    expect(screen.getByText("100-199")).toBeTruthy();
  });
});
