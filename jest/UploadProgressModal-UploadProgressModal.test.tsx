// Coverage: app/assets/src/components/views/SampleUploadFlow/components/
//   UploadProgressModal/UploadProgressModal.tsx
//
// This file is a thin router between the local and remote upload progress modals
// plus one data transform. Its branches are:
//   - uploadType === "local" picks LocalUploadProgressModal, anything else picks
//     RemoteUploadProgressModal;
//   - `metadata && processMetadataRows(...)` on the local path passes null through
//     untouched when there is no metadata;
//   - processMetadataRows keys rows by `sample_name` OR the "Sample Name" header
//     and strips both key columns from the value.
// Both child modals are stubbed so the assertions are about the routing/transform.
import { render } from "@testing-library/react";

const mockLocalProps: $TSFixMe[] = [];
const mockRemoteProps: $TSFixMe[] = [];

jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/components/LocalUploadProgressModal",
  () => ({
    __esModule: true,
    LocalUploadProgressModal: (props: $TSFixMe) => {
      mockLocalProps.push(props);
      return <div data-testid="local-modal" />;
    },
  }),
);

jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadProgressModal/components/RemoteUploadProgressModal",
  () => ({
    __esModule: true,
    RemoteUploadProgressModal: (props: $TSFixMe) => {
      mockRemoteProps.push(props);
      return <div data-testid="remote-modal" />;
    },
  }),
);

import { UploadProgressModal } from "~/components/views/SampleUploadFlow/components/UploadProgressModal/UploadProgressModal";

const metadataFixture = {
  headers: ["Sample Name", "Host Organism"],
  rows: [
    { sample_name: "sample-a", "Host Organism": "Human", collection: "CA" },
    { "Sample Name": "sample-b", "Host Organism": "Mosquito" },
  ],
};

const makeProps = (overrides: $TSFixMe = {}) => ({
  adminOptions: { subsample: "1000" },
  bedFile: null,
  clearlabs: false,
  guppyBasecallerSetting: "fast",
  medakaModel: null,
  metadata: metadataFixture,
  onUploadComplete: jest.fn(),
  project: { id: 3, name: "Proj" },
  refSeqAccession: null,
  refSeqFile: null,
  refSeqTaxon: null,
  samples: [{ name: "sample-a" }],
  skipSampleProcessing: false,
  technology: "Illumina",
  uploadType: "local",
  useStepFunctionPipeline: true,
  wetlabProtocol: null,
  workflows: new Set(["short-read-mngs"]),
  ...overrides,
});

beforeEach(() => {
  mockLocalProps.length = 0;
  mockRemoteProps.length = 0;
});

describe("UploadProgressModal upload type routing", () => {
  it("renders the local modal for a local upload", () => {
    const { queryByTestId } = render(
      <UploadProgressModal {...(makeProps() as $TSFixMe)} />,
    );

    expect(queryByTestId("local-modal")).not.toBeNull();
    expect(queryByTestId("remote-modal")).toBeNull();
    expect(mockLocalProps).toHaveLength(1);
    expect(mockRemoteProps).toHaveLength(0);
  });

  it("renders the remote modal for a basespace upload", () => {
    const { queryByTestId } = render(
      <UploadProgressModal
        {...(makeProps({ uploadType: "basespace" }) as $TSFixMe)}
      />,
    );

    expect(queryByTestId("remote-modal")).not.toBeNull();
    expect(queryByTestId("local-modal")).toBeNull();
    expect(mockRemoteProps).toHaveLength(1);
  });

  it("passes guppyBasecallerSetting only to the local modal", () => {
    render(<UploadProgressModal {...(makeProps() as $TSFixMe)} />);
    render(
      <UploadProgressModal
        {...(makeProps({ uploadType: "remote" }) as $TSFixMe)}
      />,
    );

    expect(mockLocalProps[0].guppyBasecallerSetting).toBe("fast");
    expect(mockRemoteProps[0].guppyBasecallerSetting).toBeUndefined();
    // Shared props are forwarded on both paths.
    expect(mockLocalProps[0].adminOptions).toEqual({ subsample: "1000" });
    expect(mockRemoteProps[0].adminOptions).toEqual({ subsample: "1000" });
    expect(mockRemoteProps[0].useStepFunctionPipeline).toBe(true);
  });
});

describe("UploadProgressModal metadata transform", () => {
  it("keys rows by sample name from either column and drops the key columns", () => {
    render(<UploadProgressModal {...(makeProps() as $TSFixMe)} />);

    expect(mockLocalProps[0].metadata).toEqual({
      "sample-a": { "Host Organism": "Human", collection: "CA" },
      "sample-b": { "Host Organism": "Mosquito" },
    });
  });

  it("passes null straight through on the local path when metadata is absent", () => {
    render(
      <UploadProgressModal {...(makeProps({ metadata: null }) as $TSFixMe)} />,
    );

    expect(mockLocalProps[0].metadata).toBeNull();
  });

  it("applies the same transform on the remote path", () => {
    render(
      <UploadProgressModal
        {...(makeProps({ uploadType: "basespace" }) as $TSFixMe)}
      />,
    );

    expect(Object.keys(mockRemoteProps[0].metadata).sort()).toEqual([
      "sample-a",
      "sample-b",
    ]);
    expect(mockRemoteProps[0].metadata["sample-a"].sample_name).toBeUndefined();
  });

  it("produces an empty map for an empty row list", () => {
    render(
      <UploadProgressModal
        {...(makeProps({ metadata: { headers: [], rows: [] } }) as $TSFixMe)}
      />,
    );

    expect(mockLocalProps[0].metadata).toEqual({});
  });
});
