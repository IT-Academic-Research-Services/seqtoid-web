// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteModal/BulkDeleteModal.tsx
//
// BulkDeleteModal wraps a Relay query/mutation. The Relay hooks are stubbed so
// the assertions land on this file's own logic: the closed short-circuit, the
// null/error data guard (logs + renders nothing), the valid render (title count,
// invalid-sample warning), and the delete callback's success and error branches
// (redirect vs toast, onSuccess, error logging).
const mockUseLazyLoadQuery = jest.fn();
const mockCommit = jest.fn();
const mockLogError = jest.fn();
const mockShowToast = jest.fn();

jest.mock("react-relay", () => ({
  useLazyLoadQuery: (...args: unknown[]) => mockUseLazyLoadQuery(...args),
  useMutation: () => [mockCommit, false],
}));

jest.mock("~/api/utils", () => ({
  getCsrfToken: () => "csrf-token",
}));

jest.mock("~/components/utils/logUtil", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

jest.mock("~/components/utils/toast", () => ({
  showToast: (...args: unknown[]) => mockShowToast(...args),
}));

jest.mock("~/components/utils/workflows", () => ({
  getWorkflowTypeFromLabel: () => "short-read-mngs",
  WorkflowLabelType: {},
}));

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteModal/DeleteSampleModalText",
  () => {
    const ReactLib = require("react");
    return {
      DeleteSampleModalText: () =>
        ReactLib.createElement("div", { "data-testid": "modal-text" }),
    };
  },
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteModal/InvalidSampleDeletionWarning",
  () => {
    const ReactLib = require("react");
    return {
      InvalidSampleDeletionWarning: (props: $TSFixMe) =>
        ReactLib.createElement(
          "div",
          { "data-testid": "invalid-warning" },
          props.invalidSampleNames.join(","),
        ),
    };
  },
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteModal/DeleteSuccessNotification",
  () => ({ DeleteSuccessNotification: () => null }),
);

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteModal/DeleteErrorNotification",
  () => ({ DeleteErrorNotification: () => null }),
);

import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { BulkDeleteModal } from "~/components/views/DiscoveryView/components/SamplesView/components/BulkDeleteModal/BulkDeleteModal";

const _React: typeof React = React;

const baseProps = (overrides: $TSFixMe = {}) => ({
  isOpen: true,
  onClose: jest.fn(),
  selectedIds: [1, 2],
  workflowLabel: "Metagenomic",
  ...overrides,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockUseLazyLoadQuery.mockReturnValue({
    ValidateUserCanDeleteObjects: {
      validIdsStrings: ["1", "2"],
      invalidSampleNames: [],
      error: null,
    },
  });
});

describe("BulkDeleteModal", () => {
  it("renders nothing when closed", () => {
    const { container } = render(
      <BulkDeleteModal {...baseProps({ isOpen: false })} />,
    );
    expect(container.firstChild).toBeNull();
    // Relay query is not even reached when the modal is closed.
    expect(mockUseLazyLoadQuery).not.toHaveBeenCalled();
  });

  it("logs and renders nothing when the query returns an error", () => {
    mockUseLazyLoadQuery.mockReturnValue({
      ValidateUserCanDeleteObjects: {
        validIdsStrings: null,
        invalidSampleNames: null,
        error: "permission denied",
      },
    });
    render(<BulkDeleteModal {...baseProps()} />);
    expect(mockLogError).toHaveBeenCalledWith({ message: "permission denied" });
    expect(screen.queryByTestId("bulk-delete-modal")).toBeNull();
  });

  it("logs a fallback message when data is null", () => {
    mockUseLazyLoadQuery.mockReturnValue({
      ValidateUserCanDeleteObjects: null,
    });
    render(<BulkDeleteModal {...baseProps()} />);
    expect(mockLogError).toHaveBeenCalledWith({
      message: "Error retrieving deletion permissions",
    });
  });

  it("renders the delete dialog with the valid-id count", () => {
    render(<BulkDeleteModal {...baseProps()} />);
    expect(screen.getByTestId("bulk-delete-modal")).toBeTruthy();
    expect(
      screen.getByText(/Are you sure you want to delete 2 Metagenomic runs/),
    ).toBeTruthy();
    expect(screen.getByTestId("modal-text")).toBeTruthy();
    expect(screen.queryByTestId("invalid-warning")).toBeNull();
  });

  it("shows the invalid-sample warning when some ids are invalid", () => {
    mockUseLazyLoadQuery.mockReturnValue({
      ValidateUserCanDeleteObjects: {
        validIdsStrings: ["1"],
        invalidSampleNames: ["sample-bad"],
        error: null,
      },
    });
    render(<BulkDeleteModal {...baseProps()} />);
    expect(screen.getByTestId("invalid-warning").textContent).toContain(
      "sample-bad",
    );
  });

  it("cancel button invokes onClose", () => {
    const onClose = jest.fn();
    render(<BulkDeleteModal {...baseProps({ onClose })} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("delete success (no redirect) closes, toasts and calls onSuccess", () => {
    const onClose = jest.fn();
    const onSuccess = jest.fn();
    mockCommit.mockImplementation(({ onCompleted }) => {
      onCompleted({ DeleteSamples: { error: null } });
    });
    render(
      <BulkDeleteModal
        {...baseProps({ onClose, onSuccess, redirectOnSuccess: false })}
      />,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(mockCommit).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalled();
  });

  it("delete success with redirect skips the toast", () => {
    const onClose = jest.fn();
    mockCommit.mockImplementation(({ onCompleted }) => {
      onCompleted({ DeleteSamples: { error: null } });
    });
    render(
      <BulkDeleteModal {...baseProps({ onClose, redirectOnSuccess: true })} />,
    );
    fireEvent.click(screen.getByText("Delete"));
    expect(mockShowToast).not.toHaveBeenCalled();
  });

  it("delete failure (mutation error field) toasts and logs", () => {
    const onClose = jest.fn();
    mockCommit.mockImplementation(({ onCompleted }) => {
      onCompleted({ DeleteSamples: { error: "backend boom" } });
    });
    render(<BulkDeleteModal {...baseProps({ onClose })} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(onClose).toHaveBeenCalled();
    expect(mockShowToast).toHaveBeenCalled();
    expect(mockLogError).toHaveBeenCalledWith({
      message: "Delete failed: backend boom",
    });
  });

  it("delete network error path routes through onError", () => {
    mockCommit.mockImplementation(({ onError }) => {
      onError(new Error("network down"));
    });
    render(<BulkDeleteModal {...baseProps()} />);
    fireEvent.click(screen.getByText("Delete"));
    expect(mockLogError).toHaveBeenCalledWith({
      message: "Delete failed: network down",
    });
  });
});
