// Frontend coverage: UploadProgressModal/upload_progress_utils.ts is the pure
// transform layer that decorates the user's samples with the flags chosen in
// the upload review step (technology, pipeline strategy, workflow-specific
// fields) and attaches BED/reference input files. Drive every conditional-spread
// branch: mNGS+Nanopore guppy field, viral-CG ref/accession/taxon/bed fields,
// covid-CG wetlab/clearlabs/medaka fields, and the DAG vs step-function strategy.
import {
  addAdditionalInputFilesToSamples,
  addFlagsToSamples,
  redirectToProject,
} from "~/components/views/SampleUploadFlow/components/UploadProgressModal/upload_progress_utils";
import {
  INPUT_FILE_TYPES,
  SEQUENCING_TECHNOLOGY_OPTIONS,
  UPLOAD_WORKFLOWS,
  UploadWorkflows,
  WORKFLOWS_BY_UPLOAD_SELECTIONS,
} from "~/components/views/SampleUploadFlow/constants";

const baseArgs = () => ({
  adminOptions: {},
  clearlabs: false,
  guppyBasecallerSetting: undefined,
  medakaModel: null,
  refSeqAccession: null,
  refSeqFileName: undefined,
  refSeqTaxon: null,
  samples: [{ name: "sampleA" }] as any,
  skipSampleProcessing: false,
  technology: null,
  workflows: new Set<UploadWorkflows>(),
  wetlabProtocol: null,
  useStepFunctionPipeline: true,
  bedFileName: undefined,
});

describe("addFlagsToSamples", () => {
  it("applies common flags and the step-function pipeline strategy", () => {
    const args = {
      ...baseArgs(),
      adminOptions: { alignment_config_name: "2021-01-22" },
      skipSampleProcessing: true,
      technology: SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
      workflows: new Set([UPLOAD_WORKFLOWS.MNGS.value]),
    };
    const [out] = addFlagsToSamples(args as any);

    expect(out.name).toBe("sampleA");
    expect(out.alignment_config_name).toBe("2021-01-22");
    expect(out.do_not_process).toBe(true);
    expect(out.pipeline_execution_strategy).toBe("step_function");
    expect(out.workflows).toEqual([
      WORKFLOWS_BY_UPLOAD_SELECTIONS[UPLOAD_WORKFLOWS.MNGS.value][
        SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA
      ],
    ]);
    // Illumina mNGS should not get the Nanopore-only guppy field.
    expect("guppy_basecaller_setting" in out).toBe(false);
  });

  it("falls back to the no-technology mapping when technology is null", () => {
    const [out] = addFlagsToSamples({
      ...baseArgs(),
      technology: null,
      workflows: new Set([UPLOAD_WORKFLOWS.MNGS.value]),
    } as any);
    expect(out.workflows).toEqual([
      WORKFLOWS_BY_UPLOAD_SELECTIONS[UPLOAD_WORKFLOWS.MNGS.value][
        "noTechnologySelected"
      ],
    ]);
  });

  it("uses the DAG strategy when step-function pipeline is off", () => {
    const [out] = addFlagsToSamples({
      ...baseArgs(),
      useStepFunctionPipeline: false,
      technology: SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
      workflows: new Set([UPLOAD_WORKFLOWS.MNGS.value]),
    } as any);
    expect(out.pipeline_execution_strategy).toBe("directed_acyclic_graph");
  });

  it("adds the guppy basecaller setting for Nanopore mNGS", () => {
    const [out] = addFlagsToSamples({
      ...baseArgs(),
      technology: SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE,
      guppyBasecallerSetting: "hac",
      workflows: new Set([UPLOAD_WORKFLOWS.MNGS.value]),
    } as any);
    expect(out.guppy_basecaller_setting).toBe("hac");
  });

  it("adds viral CG fields including accession, taxon, and primer bed", () => {
    const [out] = addFlagsToSamples({
      ...baseArgs(),
      technology: SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
      workflows: new Set([UPLOAD_WORKFLOWS.VIRAL_CONSENSUS_GENOME.value]),
      refSeqFileName: "ref.fasta",
      refSeqAccession: { id: "MN908947.3", name: "SARS-CoV-2" } as any,
      refSeqTaxon: { id: 2697049, name: "SARS-CoV-2" } as any,
      bedFileName: "primers.bed",
    } as any);
    expect(out.ref_fasta).toBe("ref.fasta");
    expect(out.accession_id).toBe("MN908947.3");
    expect(out.accession_name).toBe("SARS-CoV-2");
    expect(out.taxon_id).toBe(2697049);
    expect(out.taxon_name).toBe("SARS-CoV-2");
    expect(out.primer_bed).toBe("primers.bed");
  });

  it("omits optional viral CG fields when not provided", () => {
    const [out] = addFlagsToSamples({
      ...baseArgs(),
      technology: SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
      workflows: new Set([UPLOAD_WORKFLOWS.VIRAL_CONSENSUS_GENOME.value]),
      refSeqFileName: "ref.fasta",
    } as any);
    expect(out.ref_fasta).toBe("ref.fasta");
    expect("accession_id" in out).toBe(false);
    expect("taxon_id" in out).toBe(false);
    expect("primer_bed" in out).toBe(false);
  });

  it("adds covid CG wetlab plus clearlabs/medaka only for Nanopore", () => {
    const [ont] = addFlagsToSamples({
      ...baseArgs(),
      technology: SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE,
      workflows: new Set([UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value]),
      wetlabProtocol: "artic",
      clearlabs: true,
      medakaModel: "r941_min_high_g360",
    } as any);
    expect(ont.wetlab_protocol).toBe("artic");
    expect(ont.clearlabs).toBe(true);
    expect(ont.medaka_model).toBe("r941_min_high_g360");

    const [illumina] = addFlagsToSamples({
      ...baseArgs(),
      technology: SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
      workflows: new Set([UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value]),
      wetlabProtocol: "msspe",
    } as any);
    expect(illumina.wetlab_protocol).toBe("msspe");
    expect("clearlabs" in illumina).toBe(false);
    expect("medaka_model" in illumina).toBe(false);
  });
});

describe("addAdditionalInputFilesToSamples", () => {
  const bedFile = { name: "primers.bed" } as File;
  const refSeqFile = { name: "ref.fasta" } as File;

  it("attaches both bed and reference files to each sample", () => {
    const samples = [{ name: "s1" }] as any;
    const result = addAdditionalInputFilesToSamples({
      samples,
      bedFile,
      refSeqFile,
    });
    const sample = result![0];
    expect(sample.input_files_attributes).toHaveLength(2);
    expect(sample.input_files_attributes[0]).toMatchObject({
      source: "primers.bed",
      file_type: INPUT_FILE_TYPES.PRIMER_BED,
      upload_client: "web",
    });
    expect(sample.input_files_attributes[1]).toMatchObject({
      source: "ref.fasta",
      file_type: INPUT_FILE_TYPES.REFERENCE_SEQUENCE,
    });
    expect(sample.files["primers.bed"]).toBe(bedFile);
    expect(sample.files["ref.fasta"]).toBe(refSeqFile);
  });

  it("appends to existing attributes and files rather than replacing", () => {
    const existingFastq = { name: "reads.fastq" } as File;
    const samples = [
      {
        name: "s1",
        input_files_attributes: [{ source: "reads.fastq" }],
        files: { "reads.fastq": existingFastq },
      },
    ] as any;
    const result = addAdditionalInputFilesToSamples({
      samples,
      bedFile,
      refSeqFile: null,
    });
    expect(result![0].input_files_attributes).toHaveLength(2);
    expect(result![0].input_files_attributes[0].source).toBe("reads.fastq");
    // Pre-existing files map is preserved, not reset.
    expect(result![0].files["reads.fastq"]).toBe(existingFastq);
    expect(result![0].files["primers.bed"]).toBe(bedFile);
  });

  it("initializes attributes/files when only a reference file is added", () => {
    // No bedFile, so the refSeq branch must lazily create input_files_attributes
    // and files on a fresh sample.
    const samples = [{ name: "s1" }] as any;
    const result = addAdditionalInputFilesToSamples({
      samples,
      bedFile: null,
      refSeqFile,
    });
    const sample = result![0];
    expect(sample.input_files_attributes).toHaveLength(1);
    expect(sample.input_files_attributes[0].file_type).toBe(
      INPUT_FILE_TYPES.REFERENCE_SEQUENCE,
    );
    expect(sample.files["ref.fasta"]).toBe(refSeqFile);
  });

  it("returns samples untouched when there are no extra files", () => {
    const samples = [{ name: "s1" }] as any;
    const result = addAdditionalInputFilesToSamples({
      samples,
      bedFile: null,
      refSeqFile: null,
    });
    expect(result![0].input_files_attributes).toBeUndefined();
  });

  it("returns null samples unchanged", () => {
    expect(
      addAdditionalInputFilesToSamples({
        samples: null,
        bedFile,
        refSeqFile,
      }),
    ).toBeNull();
  });
});

describe("redirectToProject", () => {
  let originalLocation: Location;
  beforeEach(() => {
    originalLocation = window.location;
    delete (window as any).location;
    (window as any).location = { href: "" };
  });
  afterEach(() => {
    (window as any).location = originalLocation;
  });

  it("navigates to the project home url", () => {
    redirectToProject("55");
    expect(window.location.href).toBe("/home?project_id=55");
  });
});
