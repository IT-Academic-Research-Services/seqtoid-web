// Remaining BRANCH coverage for
// app/assets/src/components/views/SampleUploadFlow/utils.ts
//
// jest/sampleUploadFlowUtils.test.ts and jest/utils.test.ts already drive the
// paired-end / BaseSpace happy paths. This suite deliberately takes the *other*
// side of the file-count conditionals inside groupSamplesByLane: single-end
// samples (files.length !== 2, so the R2 lane list stays empty) and samples
// with no files at all (files.length === 0).
import {
  groupSamplesByLane,
  removeLaneFromName,
} from "~/components/views/SampleUploadFlow/utils";

const asSamples = (samples: unknown[]) =>
  samples as Parameters<typeof groupSamplesByLane>[0]["samples"];

describe("groupSamplesByLane -- single-end and empty-file branches", () => {
  it("groups single-end lane files with an empty R2 list", () => {
    const mkSample = (lane: string) => ({
      name: `SampleA_${lane}`,
      input_files_attributes: [
        {
          source: `SampleA_${lane}_R1.fastq`,
          parts: `SampleA_${lane}_R1.fastq`,
        },
      ],
      files: {
        r1: new File(["r1"], `SampleA_${lane}_R1.fastq`),
      },
    });

    const result = groupSamplesByLane({
      samples: asSamples([mkSample("L001"), mkSample("L002")]),
      sampleType: "local",
    }) as Record<string, $TSFixMe>;

    const keys = Object.keys(result);
    expect(keys).toHaveLength(1);
    const group = result[keys[0]];

    expect(group.filesR1).toHaveLength(2);
    // files.length === 2 was false, so nothing was ever pushed into R2 ...
    expect(group.filesR2).toHaveLength(0);
    // ... and the laneFiles.length > 0 guard skipped the R2 concatenation.
    expect(Object.keys(group.concatenated.files)).toEqual(["SampleA_R1.fastq"]);
    expect(group.concatenated.name).toBe("SampleA");
    expect(group.concatenated.input_files_attributes).toHaveLength(1);
    expect(group.concatenated.input_files_attributes[0].concatenated).toEqual([
      "SampleA_L001_R1.fastq",
      "SampleA_L002_R1.fastq",
    ]);
  });

  it("produces no concatenated files when a sample has no files", () => {
    const result = groupSamplesByLane({
      samples: asSamples([
        {
          name: "Empty_L001",
          input_files_attributes: [],
          files: {},
        },
      ]),
      sampleType: "local",
    }) as Record<string, $TSFixMe>;

    const group = result[Object.keys(result)[0]];
    // files.length > 0 was false for both read positions.
    expect(group.filesR1).toHaveLength(0);
    expect(group.filesR2).toHaveLength(0);
    expect(group.concatenated.files).toEqual({});
    expect(group.concatenated.name).toBe("Empty");
    expect(group.concatenated.input_files_attributes).toEqual([]);
  });

  it("keeps samples with different read pairs in separate groups", () => {
    const samples = [
      {
        name: "SampleA_L001",
        input_files_attributes: [
          { source: "SampleA_L001_R1.fastq", parts: "SampleA_L001_R1.fastq" },
        ],
        files: { r1: new File(["r1"], "SampleA_L001_R1.fastq") },
      },
      {
        name: "SampleA_L002",
        input_files_attributes: [
          { source: "SampleA_L002_R2.fastq", parts: "SampleA_L002_R2.fastq" },
        ],
        files: { r1: new File(["r2"], "SampleA_L002_R2.fastq") },
      },
    ];

    const result = groupSamplesByLane({
      samples: asSamples(samples),
      sampleType: "local",
    }) as Record<string, $TSFixMe>;

    // Same sample id, but the read-pair signatures differ -> two groups.
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("leaves names without a lane or ONT pattern untouched", () => {
    // The `match[2] || ""` fallback: ONT pattern with no file extension.
    expect(removeLaneFromName("ABC_pass_barcode_1")).toBe("ABC_pass_barcode");
    expect(removeLaneFromName("ABC_pass_barcode_1.fastq")).toBe(
      "ABC_pass_barcode.fastq",
    );
    // No pattern matches at all -> the plain Illumina replace is a no-op.
    expect(removeLaneFromName("plain_sample.fastq")).toBe("plain_sample.fastq");
  });
});
