// Frontend coverage: UploadSampleStep/utils.ts wraps the in-browser bioinformatics
// CLI (biowasm) to slice a file, detect its FASTA/FASTQ type, and extract read
// names from the first megabyte. The CLI is injected, so we drive every branch
// with a fake CLI: FASTA vs FASTQ name prefixing, the unknown-type early return,
// and the getFileType try/catch fallback.
import {
  getFileType,
  getReadNames,
  sliceFile,
} from "~/components/views/SampleUploadFlow/components/UploadSampleStep/utils";

// Build a fake biowasm CLI. `htsfile` reports the file type; anything else
// (i.e. the seqtk command) returns the FASTA text payload.
const makeCLI = ({
  fileType,
  fastaText,
  htsfileThrows = false,
}: {
  fileType: string;
  fastaText: string;
  htsfileThrows?: boolean;
}) => ({
  mount: jest.fn().mockResolvedValue(undefined),
  exec: jest.fn((cmd: string) => {
    if (cmd.startsWith("htsfile")) {
      if (htsfileThrows) return Promise.reject(new Error("htsfile failed"));
      return Promise.resolve(fileType);
    }
    return Promise.resolve(fastaText);
  }),
});

const makeFile = (name = "reads.fastq") =>
  new File(["@r1\nACGT\n+\nFFFF\n"], name);

describe("sliceFile", () => {
  it("creates a mounted File whose name carries a .slice suffix", async () => {
    const cli = makeCLI({ fileType: "FASTA text", fastaText: "" });
    const file = makeFile("input.fasta");
    const result = await sliceFile(cli, file, 0, 4);

    expect(result).toBeInstanceOf(File);
    expect(result.name.startsWith("input.fasta.")).toBe(true);
    expect(result.name.endsWith(".slice")).toBe(true);
    // The slice is mounted so downstream CLI commands can read it.
    expect(cli.mount).toHaveBeenCalledWith(result);
  });
});

describe("getFileType", () => {
  it("returns the htsfile output on success", async () => {
    const cli = makeCLI({ fileType: "FASTQ sequence text", fastaText: "" });
    await expect(getFileType(cli, makeFile())).resolves.toBe(
      "FASTQ sequence text",
    );
  });

  it("falls back to the unknown type when htsfile throws", async () => {
    const cli = makeCLI({
      fileType: "irrelevant",
      fastaText: "",
      htsfileThrows: true,
    });
    await expect(getFileType(cli, makeFile())).resolves.toBe("unknown text");
  });
});

describe("getReadNames", () => {
  it("returns FASTA-style read names with the > prefix preserved", async () => {
    const cli = makeCLI({
      fileType: "FASTA text",
      fastaText: ">read1\nACGT\n>read2\nTTTT\n",
    });
    await expect(getReadNames(cli, makeFile("a.fasta"))).resolves.toEqual([
      ">read1",
      ">read2",
    ]);
  });

  it("rewrites read names with an @ prefix for FASTQ files", async () => {
    const cli = makeCLI({
      // Note: seqtk -A forces FASTA output even for FASTQ input, so the payload
      // still uses > which the code swaps for @.
      fileType: "FASTQ sequence text",
      fastaText: ">read1\nACGT\n>read2\nTTTT\n",
    });
    await expect(getReadNames(cli, makeFile("a.fastq"))).resolves.toEqual([
      "@read1",
      "@read2",
    ]);
  });

  it("returns false when the file type is unknown", async () => {
    const cli = makeCLI({
      fileType: "unknown text",
      fastaText: ">read1\nACGT\n",
    });
    await expect(getReadNames(cli, makeFile("a.txt"))).resolves.toBe(false);
  });

  it("caps the returned read names at MAX_READS_TO_CHECK (100)", async () => {
    const manyReads = Array.from(
      { length: 150 },
      (_, i) => `>read${i}\nACGT`,
    ).join("\n");
    const cli = makeCLI({ fileType: "FASTA text", fastaText: manyReads });
    const result = await getReadNames(cli, makeFile("big.fasta"));
    expect(Array.isArray(result) && result.length).toBe(100);
  });
});
