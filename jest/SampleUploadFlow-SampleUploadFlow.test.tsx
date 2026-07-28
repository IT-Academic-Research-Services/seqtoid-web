// Coverage: app/assets/src/components/views/SampleUploadFlow/SampleUploadFlow.tsx
//
// SampleUploadFlow is the three-step upload wizard container. It owns the step
// state machine (sample -> metadata -> review), enables/disables steps, wires a
// beforeunload guard, caches per-project pipeline versions, and -- on metadata
// upload -- stitches host-genome ids onto each sample plus enforces the HIPAA
// host-age cap. All four step children plus NarrowContainer are stubbed so the
// assertions land on this container's state transitions and data-massaging
// logic; the pipeline-versions API is mocked to test the cache branch.
import { act, render } from "@testing-library/react";
import React from "react";

const mockGetProjectPipelineVersions = jest.fn();
jest.mock("~/api", () => ({
  __esModule: true,
  getProjectPipelineVersions: (...args: $TSFixMe[]) =>
    mockGetProjectPipelineVersions(...args),
}));

// Each step child records the props it was rendered with so tests can read the
// container's current state through them.
const headerProps: $TSFixMe[] = [];
const sampleStepProps: $TSFixMe[] = [];
const metadataStepProps: $TSFixMe[] = [];
const reviewStepProps: $TSFixMe[] = [];

jest.mock(
  "~/components/views/SampleUploadFlow/components/SampleUploadFlowHeader",
  () => ({
    __esModule: true,
    SampleUploadFlowHeader: (props: $TSFixMe) => {
      headerProps.push(props);
      return (
        <div
          data-testid="header"
          data-step={props.currentStep}
          data-metaenabled={String(props.stepsEnabled?.uploadMetadata)}
          data-reviewenabled={String(props.stepsEnabled?.review)}
          data-sampleenabled={String(props.stepsEnabled?.uploadSamples)}
        />
      );
    },
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadSampleStep",
  () => ({
    __esModule: true,
    UploadSampleStep: (props: $TSFixMe) => {
      sampleStepProps.push(props);
      return (
        <div
          data-testid="sample-step"
          data-visible={String(props.visible)}
          data-pipelineversions={JSON.stringify(props.pipelineVersions)}
        />
      );
    },
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadMetadataStep",
  () => ({
    __esModule: true,
    UploadMetadataStep: (props: $TSFixMe) => {
      metadataStepProps.push(props);
      return (
        <div data-testid="metadata-step" data-visible={String(props.visible)} />
      );
    },
  }),
);

jest.mock("~/components/views/SampleUploadFlow/components/ReviewStep", () => ({
  __esModule: true,
  ReviewStep: (props: $TSFixMe) => {
    reviewStepProps.push(props);
    return (
      <div
        data-testid="review-step"
        data-visible={String(props.visible)}
        data-samples={JSON.stringify(props.samples)}
        data-metadata={JSON.stringify(props.metadata)}
      />
    );
  },
}));

jest.mock("~/components/layout/NarrowContainer", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="narrow">{props.children}</div>
  ),
}));

import SampleUploadFlow from "~/components/views/SampleUploadFlow/SampleUploadFlow";

const baseProps = (overrides: $TSFixMe = {}) => ({
  basespaceClientId: "client",
  basespaceOauthRedirectUri: "http://redirect",
  hostGenomes: [
    { id: 1, name: "Human" },
    { id: 2, name: "Mosquito" },
  ],
  ...overrides,
});

const renderFlow = (overrides: $TSFixMe = {}) => {
  const ref = React.createRef<$TSFixMe>();
  const utils = render(
    <SampleUploadFlow ref={ref} {...baseProps(overrides)} />,
  );
  return { ...utils, ref };
};

beforeEach(() => {
  jest.clearAllMocks();
  headerProps.length = 0;
  sampleStepProps.length = 0;
  metadataStepProps.length = 0;
  reviewStepProps.length = 0;
  window.onbeforeunload = null;
});

describe("SampleUploadFlow initial render", () => {
  it("shows the sample step but not the metadata/review steps", () => {
    const { getByTestId, queryByTestId } = renderFlow();
    expect(getByTestId("sample-step")).toBeTruthy();
    expect(queryByTestId("metadata-step")).toBeNull();
    expect(queryByTestId("review-step")).toBeNull();
    // Starts on the sample step.
    expect(getByTestId("header").getAttribute("data-step")).toBe(
      "uploadSamples",
    );
  });

  it("installs a beforeunload guard on mount", () => {
    renderFlow();
    expect(typeof window.onbeforeunload).toBe("function");
    expect((window.onbeforeunload as $TSFixMe)()).toMatch(/leave/);
  });
});

describe("SampleUploadFlow step transitions", () => {
  it("advances to the metadata step after samples are uploaded", () => {
    const { ref, getByTestId } = renderFlow();
    act(() =>
      ref.current.handleUploadSamples({
        samples: [{ name: "s1" }],
        project: { id: 3 },
        uploadType: "local",
        workflows: new Set(),
      }),
    );
    expect(getByTestId("header").getAttribute("data-step")).toBe(
      "uploadMetadata",
    );
    expect(getByTestId("header").getAttribute("data-metaenabled")).toBe("true");
    expect(getByTestId("metadata-step")).toBeTruthy();
  });

  it("handleStepSelect switches the visible step without changing enablement", () => {
    const { ref, getByTestId } = renderFlow();
    act(() => ref.current.handleStepSelect("review"));
    expect(getByTestId("header").getAttribute("data-step")).toBe("review");
  });

  it("samplesChanged resets metadata + review enablement", () => {
    const { ref, getByTestId } = renderFlow();
    act(() => ref.current.handleUploadSamples({ samples: [{ name: "s1" }] }));
    act(() => ref.current.samplesChanged());
    const header = getByTestId("header");
    expect(header.getAttribute("data-sampleenabled")).toBe("true");
    expect(header.getAttribute("data-metaenabled")).toBe("false");
    expect(header.getAttribute("data-reviewenabled")).toBe("false");
  });

  it("metadataChanged keeps sample+metadata enabled but disables review", () => {
    const { ref, getByTestId } = renderFlow();
    act(() => ref.current.metadataChanged());
    const header = getByTestId("header");
    expect(header.getAttribute("data-metaenabled")).toBe("true");
    expect(header.getAttribute("data-reviewenabled")).toBe("false");
  });

  it("onUploadStatusChange disables every step while uploading", () => {
    const { ref, getByTestId } = renderFlow();
    act(() => ref.current.onUploadStatusChange(true));
    const header = getByTestId("header");
    expect(header.getAttribute("data-sampleenabled")).toBe("false");
    expect(header.getAttribute("data-metaenabled")).toBe("false");
    expect(header.getAttribute("data-reviewenabled")).toBe("false");
  });

  it("onUploadComplete clears the beforeunload guard", () => {
    const { ref } = renderFlow();
    expect(window.onbeforeunload).not.toBeNull();
    act(() => ref.current.onUploadComplete());
    expect(window.onbeforeunload).toBeNull();
  });
});

describe("SampleUploadFlow metadata stitching", () => {
  const advance = (ref: $TSFixMe, samples: $TSFixMe) =>
    act(() =>
      ref.current.handleUploadSamples({
        samples,
        project: { id: 3 },
        workflows: new Set(),
      }),
    );

  it("assigns host-genome ids and caps HIPAA host age for humans", () => {
    const { ref, getByTestId } = renderFlow();
    advance(ref, [{ name: "s1" }]);
    act(() =>
      ref.current.handleUploadMetadata({
        metadata: {
          rows: [
            { sample_name: "s1", host_genome: "Human", "Host Age": "120" },
          ],
          headers: ["sample_name", "host_genome", "Host Age"],
        },
        issues: null,
        newHostGenomes: [],
      }),
    );

    const review = getByTestId("review-step");
    const samples = JSON.parse(review.getAttribute("data-samples") as string);
    expect(samples[0].host_genome_id).toBe(1);
    expect(samples[0].host_genome_name).toBe("Human");

    const metadata = JSON.parse(review.getAttribute("data-metadata") as string);
    // Age of 120 is capped to maxValue+1 = 91.
    expect(metadata.rows[0]["Host Age"]).toBe("91");
    // host_genome is stripped from both rows and headers.
    expect(metadata.rows[0].host_genome).toBeUndefined();
    expect(metadata.headers).not.toContain("host_genome");
    // Advances to the review step.
    expect(getByTestId("header").getAttribute("data-step")).toBe("review");
  });

  it("does not cap age for a non-human host genome", () => {
    const { ref, getByTestId } = renderFlow();
    advance(ref, [{ name: "s1" }]);
    act(() =>
      ref.current.handleUploadMetadata({
        metadata: {
          rows: [
            { sample_name: "s1", host_genome: "Mosquito", "Host Age": "120" },
          ],
          headers: ["sample_name", "host_genome", "Host Age"],
        },
        issues: null,
        newHostGenomes: [],
      }),
    );
    const review = getByTestId("review-step");
    const samples = JSON.parse(review.getAttribute("data-samples") as string);
    expect(samples[0].host_genome_id).toBe(2);
    const metadata = JSON.parse(review.getAttribute("data-metadata") as string);
    expect(metadata.rows[0]["Host Age"]).toBe("120");
  });

  it("resolves the host genome from a newly-added host genome", () => {
    const { ref, getByTestId } = renderFlow();
    advance(ref, [{ name: "s1" }]);
    act(() =>
      ref.current.handleUploadMetadata({
        metadata: {
          rows: [{ sample_name: "s1", host_genome: "Cat" }],
          headers: ["sample_name", "host_genome"],
        },
        issues: null,
        newHostGenomes: [{ id: 99, name: "Cat" }],
      }),
    );
    const samples = JSON.parse(
      getByTestId("review-step").getAttribute("data-samples") as string,
    );
    expect(samples[0].host_genome_id).toBe(99);
  });
});

describe("SampleUploadFlow pipeline-version cache", () => {
  it("fetches versions once and serves later requests from the cache", async () => {
    mockGetProjectPipelineVersions.mockResolvedValue({
      projectPipelineVersions: { "short-read-mngs": "8.0.0" },
      latestMajorPipelineVersions: { "short-read-mngs": "8" },
    });
    const { ref } = renderFlow();

    await act(async () => {
      await ref.current.getPipelineVersionsForExistingProject(3);
    });
    expect(mockGetProjectPipelineVersions).toHaveBeenCalledTimes(1);

    // Cached -> resolves without a second API hit.
    const cached = await ref.current.getPipelineVersionsForExistingProject(3);
    expect(mockGetProjectPipelineVersions).toHaveBeenCalledTimes(1);
    expect(cached.pipelineVersions).toEqual({ "short-read-mngs": "8.0.0" });
  });
});
