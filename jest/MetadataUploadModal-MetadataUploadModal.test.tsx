// Coverage for
// app/assets/src/components/views/DiscoveryView/components/SamplesView/components/MetadataUploadModal/MetadataUploadModal.tsx
//
// A wizard-hosting modal. On mount it fetches the project's samples and copies
// details.metadata up to sample.metadata for the downstream manual-input step.
// handleComplete keys the collected rows by sample name, uploads them and shows
// either a success or an error toast. The Modal/Wizard/UploadPage/ReviewPage
// children and the api/toast side effects are stubbed so the mount reshaping
// and the upload success/error branches are exercised directly off the
// component instance.
import { act, render, waitFor } from "@testing-library/react";
import React from "react";

const _React: typeof React = React;

const mockGetSamples = jest.fn();
const mockUploadMetadataForProject = jest.fn();
const mockShowToast = jest.fn();

jest.mock("~/api", () => ({
  getSamples: (...args: unknown[]) => mockGetSamples(...args),
}));

jest.mock("~/api/metadata", () => ({
  uploadMetadataForProject: (...args: unknown[]) =>
    mockUploadMetadataForProject(...args),
}));

jest.mock("~/components/utils/toast", () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

jest.mock("~ui/containers/Modal", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <div data-testid="modal">{props.children}</div>,
}));

jest.mock("~ui/containers/Wizard", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="wizard">{props.children}</div>
  ),
}));

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/MetadataUploadModal/UploadPage",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => (
      <div
        data-testid="upload-page"
        data-samples={(props.samples || []).length}
      />
    ),
  }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/MetadataUploadModal/ReviewPage",
  () => ({
    __esModule: true,
    default: () => <div data-testid="review-page" />,
  }),
);

jest.mock("~ui/notifications/ListNotification", () => ({
  __esModule: true,
  default: () => <div />,
}));

jest.mock("~ui/notifications/Notification", () => ({
  __esModule: true,
  default: () => <div />,
}));

import MetadataUploadModal from "~/components/views/DiscoveryView/components/SamplesView/components/MetadataUploadModal/MetadataUploadModal";

const project = { id: 12, name: "My Project" } as $TSFixMe;

const renderModal = (props: $TSFixMe = {}) => {
  const ref = React.createRef<$TSFixMe>();
  const utils = render(
    <MetadataUploadModal ref={ref} project={project} {...props} />,
  );
  return { ...utils, instance: () => ref.current };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSamples.mockResolvedValue({ samples: [] });
});

describe("MetadataUploadModal mount", () => {
  it("fetches the project samples and lifts details.metadata onto sample.metadata", async () => {
    mockGetSamples.mockResolvedValue({
      samples: [
        { name: "s1", details: { metadata: { collection_location: "SF" } } },
      ],
    });
    const { instance } = renderModal();
    await waitFor(() => expect(instance().state.projectSamples).not.toBeNull());
    expect(mockGetSamples).toHaveBeenCalledWith({ projectId: 12 });
    expect(instance().state.projectSamples[0].metadata).toEqual({
      collection_location: "SF",
    });
  });

  it("renders the modal with the upload and review wizard pages", async () => {
    const { getByTestId } = renderModal();
    await waitFor(() => expect(getByTestId("modal")).toBeTruthy());
    expect(getByTestId("upload-page")).toBeTruthy();
    expect(getByTestId("review-page")).toBeTruthy();
  });
});

describe("MetadataUploadModal handleMetadataChange", () => {
  it("stores the collected metadata and issues in state", async () => {
    const { instance } = renderModal();
    await waitFor(() => expect(instance()).toBeTruthy());
    act(() => {
      instance().handleMetadataChange({
        metadata: { headers: ["a"], rows: [{ sample_name: "s1", a: "1" }] },
        issues: { errors: [] },
      });
    });
    expect(instance().state.metadata.rows).toHaveLength(1);
    expect(instance().state.issues).toEqual({ errors: [] });
  });
});

describe("MetadataUploadModal handleComplete", () => {
  const setUpWithRows = async () => {
    const onClose = jest.fn();
    const onComplete = jest.fn();
    const { instance } = renderModal({ onClose, onComplete });
    await waitFor(() => expect(instance()).toBeTruthy());
    act(() => {
      instance().setState({
        metadata: {
          headers: ["Sample Name", "Host Age"],
          rows: [
            { sample_name: "s1", "Host Age": "40" },
            { "Sample Name": "s2", "Host Age": "50" },
          ],
        },
      });
    });
    return { instance, onClose, onComplete };
  };

  it("closes, uploads the keyed rows and toasts success", async () => {
    mockUploadMetadataForProject.mockResolvedValue({ errors: [] });
    const { instance, onClose, onComplete } = await setUpWithRows();

    await act(async () => {
      await instance().handleComplete();
    });

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockUploadMetadataForProject.mock.calls[0][0]).toBe(12);
    // Rows are keyed by sample name with the name columns stripped.
    expect(mockUploadMetadataForProject.mock.calls[0][1]).toEqual({
      s1: { "Host Age": "40" },
      s2: { "Host Age": "50" },
    });
    expect(mockShowToast).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("toasts the error notification when the upload returns errors", async () => {
    mockUploadMetadataForProject.mockResolvedValue({
      errors: ["bad row"],
    });
    const { instance, onComplete } = await setUpWithRows();

    await act(async () => {
      await instance().handleComplete();
    });

    expect(mockShowToast).toHaveBeenCalledTimes(1);
    // Error toast is called with only the render fn (no autoClose options).
    expect(mockShowToast.mock.calls[0].length).toBe(1);
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not blow up when no onComplete handler is supplied", async () => {
    mockUploadMetadataForProject.mockResolvedValue({ errors: [] });
    const onClose = jest.fn();
    const { instance } = renderModal({ onClose });
    await waitFor(() => expect(instance()).toBeTruthy());
    act(() => {
      instance().setState({
        metadata: {
          headers: ["Sample Name"],
          rows: [{ sample_name: "s1" }],
        },
      });
    });
    await act(async () => {
      await expect(instance().handleComplete()).resolves.toBeUndefined();
    });
    expect(mockShowToast).toHaveBeenCalled();
  });
});
