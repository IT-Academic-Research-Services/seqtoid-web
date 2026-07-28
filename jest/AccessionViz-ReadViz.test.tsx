// Frontend coverage: ReadViz renders one BLAST read alignment inside the
// AlignmentViz accession panel. All of its logic lives in parseAlignment(),
// which normalizes the metric strings, optionally reverses/complements the
// read, and trims or pads the flanking reference fragments so the reference,
// read and mismatch rows line up. These tests drive both sides of every one of
// those decisions and assert on the three rendered rows.
import { render, screen } from "@testing-library/react";
import ReadViz from "~/components/views/AlignmentViz/components/AccessionViz/components/ReadViz";

// The rendered table has three labelled rows; grab the value cell of each.
const rows = () => {
  const cells = screen.getAllByRole("cell").map(c => c.textContent);
  return {
    reference: cells[1],
    read: cells[3],
    mismatches: cells[5],
  };
};

// metrics layout: [pct identity, aln length, mismatches, gap openings,
//                  query start, query end, ref start, ref end, e-value, bit score]
const metrics = (overrides: Partial<Record<number, $TSFixMe>> = {}) => {
  const base = ["99.0", "4", "0", "0", "4", "7", "100", "103", "1e-5", "50.4"];
  Object.entries(overrides).forEach(([i, v]) => {
    base[Number(i)] = v as string;
  });
  return base;
};

describe("ReadViz", () => {
  it("renders the header metrics as parsed numbers", () => {
    render(
      <ReadViz
        name="read1/1"
        sequence="AAACGTTT"
        refInfo={["GGGAAA", "CGTT", "TTT"]}
        metrics={metrics() as $TSFixMe}
      />,
    );
    expect(screen.getByText(/Read Name:/).textContent).toContain("read1/1");
    // parseFloat/parseInt are applied in place, so the strings render as numbers.
    expect(document.body.textContent).toContain("Percentage Matched: 99 %");
    expect(document.body.textContent).toContain("Alignment Length: 4");
    expect(document.body.textContent).toContain("E-value: 0.00001");
    expect(document.body.textContent).toContain("Bit Score: 50.4");
    expect(document.body.textContent).toContain(
      "Reference Alignment Range: 100 - 103",
    );
  });

  it("trims over-long flanking reference fragments down to the read flanks", () => {
    render(
      <ReadViz
        name="read1/1"
        sequence="AAACGTTT"
        // left flank is 6 chars but the read only has 3 before the alignment,
        // right flank is 3 chars but the read only has 1 after it.
        refInfo={["GGGAAA", "CGTT", "TTT"]}
        metrics={metrics() as $TSFixMe}
      />,
    );
    const { reference, read, mismatches } = rows();
    // Left trimmed from the front ("GGGAAA" -> "AAA"), right from the back.
    expect(reference).toBe("AAA|CGTT|T");
    expect(read).toBe("AAA|CGTT|T");
    // Reference and aligned read agree, so no "X" markers.
    expect(mismatches).toBe("   |    | ");
  });

  it("pads short flanking reference fragments out with spaces", () => {
    render(
      <ReadViz
        name="read1/1"
        sequence="AAACGTTT"
        refInfo={["A", "CGTT", ""]}
        metrics={metrics() as $TSFixMe}
      />,
    );
    const { reference } = rows();
    // "A" is left-padded to 3, "" is right-padded to 1.
    expect(reference).toBe("  A|CGTT| ");
  });

  it("marks mismatching bases with X and leaves N positions blank", () => {
    render(
      <ReadViz
        name="read1/1"
        sequence="AAACGTTT"
        // aligned read is "CGTT"; reference disagrees at position 2 and has an
        // N at position 3, which is never counted as a mismatch.
        refInfo={["AAA", "CATT", "T"]}
        metrics={metrics() as $TSFixMe}
      />,
    );
    expect(rows().mismatches).toBe("   | X  | ");
  });

  it("treats an N in the read as a match", () => {
    render(
      <ReadViz
        name="read1/1"
        sequence="AAACGNTT"
        refInfo={["AAA", "CGTT", "T"]}
        metrics={metrics() as $TSFixMe}
      />,
    );
    // Position 3 is N in the read, so it is blank rather than an X.
    expect(rows().mismatches).toBe("   |    | ");
  });

  it("uses the complement of the read when that produces fewer mismatches", () => {
    render(
      <ReadViz
        name="read1/1"
        sequence="AAACGTTT"
        // The reference matches complement("CGTT") = "GCAA", not "CGTT".
        refInfo={["AAA", "GCAA", "T"]}
        metrics={metrics() as $TSFixMe}
      />,
    );
    const { read, mismatches } = rows();
    expect(read).toBe("AAA|GCAA|T");
    expect(mismatches).toBe("   |    | ");
  });

  it("leaves non-ACGT characters untouched when complementing", () => {
    render(
      <ReadViz
        name="read1/1"
        sequence="AAACGNNT"
        // complement("CGNN") = "GCNN"; the Ns fall through the switch default.
        refInfo={["AAA", "GCAA", "T"]}
        metrics={metrics() as $TSFixMe}
      />,
    );
    // Ns never count as mismatches, so complementing wins 0-2 and is displayed.
    expect(rows().read).toBe("AAA|GCNN|T");
  });

  it("reverses the read when the reference range runs backwards", () => {
    render(
      <ReadViz
        name="read1/1"
        sequence="AAACGTTT"
        refInfo={["TTT", "TTGC", "AAA"]}
        // ref start 103 > ref end 100 -> reversed, and readPart 1 flips the
        // query coordinates, so the aligned window becomes positions 2..5 of
        // the reversed sequence "TTTGCAAA".
        metrics={metrics({ 6: "103", 7: "100" }) as $TSFixMe}
      />,
    );
    const { read, mismatches } = rows();
    expect(read).toBe("T|TTGC|AAA");
    expect(mismatches).toBe(" |    |   ");
  });

  it("flips the query coordinates for the second read of a forward pair", () => {
    render(
      <ReadViz
        name="read1/2"
        sequence="AAACGTTT"
        // Forward alignment but readPart 2, so metrics[4]/[5] are mirrored:
        // 4..7 becomes (8-7+1)..(8-4+1) = 2..5 -> "AACG".
        refInfo={["A", "AACG", "TTT"]}
        metrics={metrics() as $TSFixMe}
      />,
    );
    const { reference, read } = rows();
    expect(read).toBe("A|AACG|TTT");
    expect(reference).toBe("A|AACG|TTT");
  });

  it("defaults to read part 1 when the name carries no /N suffix", () => {
    render(
      <ReadViz
        name="unpaired-read"
        sequence="AAACGTTT"
        refInfo={["AAA", "CGTT", "T"]}
        metrics={metrics() as $TSFixMe}
      />,
    );
    // No coordinate flip happened, so the aligned window is still 4..7.
    expect(rows().read).toBe("AAA|CGTT|T");
  });

  it("renders empty flanks when the alignment covers the whole read", () => {
    render(
      <ReadViz
        name="read1/1"
        sequence="CGTT"
        refInfo={["", "CGTT", ""]}
        metrics={metrics({ 4: "1", 5: "4" }) as $TSFixMe}
      />,
    );
    const { reference, read, mismatches } = rows();
    expect(reference).toBe("|CGTT|");
    expect(read).toBe("|CGTT|");
    expect(mismatches).toBe("|    |");
  });
});
