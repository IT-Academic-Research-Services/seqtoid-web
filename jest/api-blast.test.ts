// Coverage: app/assets/src/api/blast.ts
// Small wrapper module; the only branch is the `countType = CountTypes.NT`
// default, so drive both the defaulted and the explicit-NR call.
import {
  createAnnotation,
  fetchLongestContigsForTaxonId,
  fetchLongestReadsForTaxonId,
} from "~/api/blast";
import { get, postWithCSRF } from "~/api/core";
import { CountTypes } from "~/components/views/SampleView/components/ModalManager/components/BlastModals/constants";

jest.mock("~/api/core", () => ({
  get: jest.fn(),
  postWithCSRF: jest.fn(),
}));

const mockedGet = get as jest.Mock;
const mockedPost = postWithCSRF as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockedGet.mockResolvedValue([]);
  mockedPost.mockResolvedValue({ ok: true });
});

describe("fetchLongestContigsForTaxonId", () => {
  it("defaults count_type to NT when countType is not supplied", async () => {
    await expect(
      fetchLongestContigsForTaxonId({
        sampleId: 100,
        pipelineVersion: "7.1",
        taxonId: 573,
      }),
    ).resolves.toEqual([]);

    expect(mockedGet).toHaveBeenCalledWith(
      "/samples/100/taxid_contigs_for_blast.json",
      {
        params: {
          taxid: 573,
          pipeline_version: "7.1",
          count_type: CountTypes.NT,
        },
      },
    );
  });

  it("uses the supplied countType when given", async () => {
    await fetchLongestContigsForTaxonId({
      countType: CountTypes.NR,
      sampleId: 101,
      pipelineVersion: "8.0",
      taxonId: 1,
    });

    expect(mockedGet.mock.calls[0][0]).toBe(
      "/samples/101/taxid_contigs_for_blast.json",
    );
    expect(mockedGet.mock.calls[0][1].params.count_type).toBe(CountTypes.NR);
  });
});

describe("fetchLongestReadsForTaxonId", () => {
  it("sends tax_level and defaults count_type to NT", async () => {
    mockedGet.mockResolvedValueOnce(["ACGT"]);
    await expect(
      fetchLongestReadsForTaxonId({
        sampleId: 200,
        pipelineVersion: "7.1",
        taxonId: 573,
        taxonLevel: 1,
      }),
    ).resolves.toEqual(["ACGT"]);

    expect(mockedGet).toHaveBeenCalledWith(
      "/samples/200/taxon_five_longest_reads.json",
      {
        params: {
          taxid: 573,
          tax_level: 1,
          pipeline_version: "7.1",
          count_type: CountTypes.NT,
        },
      },
    );
  });

  it("honours an explicit NR countType", async () => {
    await fetchLongestReadsForTaxonId({
      countType: CountTypes.NR,
      sampleId: 201,
      pipelineVersion: "7.1",
      taxonId: 2,
      taxonLevel: 2,
    });
    expect(mockedGet.mock.calls[0][1].params.count_type).toBe(CountTypes.NR);
  });

  it("propagates a request failure", async () => {
    mockedGet.mockRejectedValueOnce(new Error("500"));
    await expect(
      fetchLongestReadsForTaxonId({ sampleId: 1, taxonId: 1, taxonLevel: 1 }),
    ).rejects.toThrow("500");
  });
});

describe("createAnnotation", () => {
  it("posts the annotation content keyed by pipeline run and tax id", async () => {
    await createAnnotation({
      pipelineRunId: 55,
      taxId: 573,
      annotationType: "hit",
    });

    expect(mockedPost).toHaveBeenCalledWith("/annotations.json", {
      pipeline_run_id: 55,
      tax_id: 573,
      content: "hit",
    });
  });
});
