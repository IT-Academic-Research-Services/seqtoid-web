// Coverage for NextcladeModal: it validates the selected consensus genome
// workflow runs on mount, works out which of them Nextclade will refuse (non
// SARS-CoV-2 or whole-genome-sequencing uploads), warns admins who selected
// other people's genomes, and then drives the confirm / export / error-retry
// flow.
//
// The reference-tree picker is stubbed so the file-upload and tree-type
// callbacks can be driven directly (the real one is a drag-and-drop
// FilePicker); everything else renders for real.
const mockValidateWorkflowRunIds = jest.fn();
const mockGetWorkflowRunsInfo = jest.fn();
const mockCreateConsensusGenomeCladeExport = jest.fn();
const mockGetConsensusGenomeCladeExportTreeUrl = jest.fn();
const mockOpenUrlInNewTab = jest.fn();
const mockTrackEvent = jest.fn();
// Fake handle for the pre-opened Nextclade tab: the fix calls window.open synchronously inside the
// click gesture, then navigates it once the export url is ready (avoids the popup blocker).
let mockNextcladeTab: {
  location: { href: string };
  opener: unknown;
  close: jest.Mock;
};

jest.mock("~/api", () => ({
  createConsensusGenomeCladeExport: (...args: unknown[]) =>
    mockCreateConsensusGenomeCladeExport(...args),
  getConsensusGenomeCladeExportTreeUrl: (...args: unknown[]) =>
    mockGetConsensusGenomeCladeExportTreeUrl(...args),
  getWorkflowRunsInfo: (...args: unknown[]) => mockGetWorkflowRunsInfo(...args),
}));

jest.mock("~/api/access_control", () => ({
  validateWorkflowRunIds: (...args: unknown[]) =>
    mockValidateWorkflowRunIds(...args),
}));

jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: {
    NEXTCLADE_MODAL_CONFIRMATION_MODAL_CONFIRM_BUTTON_CLICKED: "confirm",
    NEXTCLADE_MODAL_CONFIRMATION_MODAL_CONFIRM_BUTTON_CLICKED_ALLISON_TESTING:
      "confirm-testing",
  },
  useTrackEvent: () => mockTrackEvent,
}));

jest.mock("~/components/utils/links", () => ({
  openUrlInNewTab: (...args: unknown[]) => mockOpenUrlInNewTab(...args),
}));

jest.mock(
  "~/components/views/DiscoveryView/components/SamplesView/components/NextcladeModal/components/NextcladeReferenceTreeOptions",
  () => ({
    __esModule: true,
    NextcladeReferenceTreeOptions: (props: $TSFixMe) => (
      <div>
        <span data-testid="selected-tree-type">{props.selectedType}</span>
        <span data-testid="reference-tree-name">
          {props.referenceTree || "none"}
        </span>
        <button
          data-testid="choose-upload"
          onClick={() => props.onSelect("upload")}
        />
        <button
          data-testid="choose-global"
          onClick={() => props.onSelect("global")}
        />
        <button
          data-testid="upload-tree"
          onClick={() =>
            props.onChange({
              name: "my-tree.json",
              text: async () => '{  "tree":  1 }',
            })
          }
        />
        <button
          data-testid="upload-unparseable-tree"
          onClick={() =>
            props.onChange({
              name: "not-json.json",
              text: async () => ">seq1\nACGT",
            })
          }
        />
        <button
          data-testid="upload-non-tree-json"
          onClick={() =>
            props.onChange({
              name: "array.json",
              text: async () => '[{"tree": 1}]',
            })
          }
        />
        <button
          data-testid="upload-nothing"
          onClick={() => props.onChange(undefined)}
        />
      </div>
    ),
  }),
);

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { UserContext } from "~/components/common/UserContext";
import { NextcladeModal } from "~/components/views/DiscoveryView/components/SamplesView/components/NextcladeModal/NextcladeModal";

// Keeps prettier's organize-imports from dropping the React import that the
// classic JSX runtime needs in scope.
const _React: typeof React = React;

const SARS_COV_2 = "Severe acute respiratory syndrome coronavirus 2";

const cgRun = (overrides: $TSFixMe = {}) => ({
  id: "1",
  name: "cg-1",
  projectId: "p1",
  taxonName: SARS_COV_2,
  creationSource: "SARS-CoV-2 Upload",
  userId: 10,
  ...overrides,
});

const renderModal = (props: $TSFixMe = {}, userContext: $TSFixMe = {}) =>
  render(
    <UserContext.Provider
      value={{ admin: false, userId: 10, ...userContext } as $TSFixMe}
    >
      <NextcladeModal
        isOpen
        onClose={props.onClose || jest.fn()}
        selectedIds={new Set(["1", "2"])}
        {...props}
      />
    </UserContext.Provider>,
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockValidateWorkflowRunIds.mockResolvedValue({
    validIds: ["1", "2"],
    invalidSampleNames: [],
    error: null,
  });
  mockGetWorkflowRunsInfo.mockResolvedValue({
    workflowRunInfo: [cgRun(), cgRun({ id: "2", name: "cg-2" })],
  });
  mockCreateConsensusGenomeCladeExport.mockResolvedValue({
    external_url: "https://clades.nextstrain.org/export/abc",
  });
  mockGetConsensusGenomeCladeExportTreeUrl.mockResolvedValue({
    url: "https://s3.example/put-tree",
    key: "clade_exports/trees/temp-abcde",
  });
  // The reference tree is PUT straight to S3 via the presigned url; stub fetch to succeed.
  global.fetch = jest
    .fn()
    .mockResolvedValue({ ok: true, status: 200 }) as $TSFixMe;
  // The export opens the Nextclade tab synchronously (window.open) and navigates it after the async
  // work; give window.open a fake handle so the pre-open path is exercised.
  mockNextcladeTab = { location: { href: "" }, opener: {}, close: jest.fn() };
  window.open = jest.fn(() => mockNextcladeTab) as $TSFixMe;
});

describe("NextcladeModal validation on mount", () => {
  it("validates the selected workflow runs and fetches their info", async () => {
    renderModal();
    await waitFor(() =>
      expect(mockValidateWorkflowRunIds).toHaveBeenCalledWith({
        basic: false,
        workflowRunIds: ["1", "2"],
        workflow: "consensus-genome",
      }),
    );
    expect(mockGetWorkflowRunsInfo).toHaveBeenCalledWith(["1", "2"]);
  });

  it("does nothing when no ids are selected", async () => {
    renderModal({ selectedIds: undefined });
    await waitFor(() =>
      expect(screen.getByText(/Consensus Genomes? selected/)).toBeTruthy(),
    );
    expect(mockValidateWorkflowRunIds).not.toHaveBeenCalled();
    expect(screen.getByText("0 Consensus Genomes selected")).toBeTruthy();
  });

  it("counts every SARS-CoV-2 genome as sendable", async () => {
    renderModal();
    expect(
      await screen.findByText("2 Consensus Genomes selected"),
    ).toBeTruthy();
  });

  it("excludes non SARS-CoV-2 genomes from the count", async () => {
    mockGetWorkflowRunsInfo.mockResolvedValue({
      workflowRunInfo: [
        cgRun(),
        cgRun({ id: "2", name: "cg-2", taxonName: "Influenza A virus" }),
      ],
    });
    renderModal();
    // One of two is excluded, so the singular form is used.
    expect(await screen.findByText("1 Consensus Genome selected")).toBeTruthy();
  });

  it("excludes whole-genome-sequencing uploads from the count", async () => {
    mockGetWorkflowRunsInfo.mockResolvedValue({
      workflowRunInfo: [
        cgRun({ creationSource: "Viral CG Upload" }),
        cgRun({ id: "2", name: "cg-2", creationSource: "Viral CG Upload" }),
      ],
    });
    renderModal();
    expect(
      await screen.findByText("0 Consensus Genomes selected"),
    ).toBeTruthy();
  });

  it("disables the submit button while there are no valid ids", async () => {
    mockValidateWorkflowRunIds.mockResolvedValue({
      validIds: [],
      invalidSampleNames: ["broken-cg"],
      error: null,
    });
    mockGetWorkflowRunsInfo.mockResolvedValue({ workflowRunInfo: [] });
    renderModal();
    await waitFor(() => expect(mockGetWorkflowRunsInfo).toHaveBeenCalled());
    const button = (await screen.findByText("View QC in Nextclade")).closest(
      "button",
    ) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
  });

  it("enables the submit button once valid ids arrive", async () => {
    renderModal();
    await waitFor(() => {
      const button = screen
        .getByText("View QC in Nextclade")
        .closest("button") as HTMLButtonElement;
      expect(button.disabled).toBe(false);
    });
  });
});

describe("NextcladeModal admin warning", () => {
  it("warns an admin who selected another user's consensus genomes", async () => {
    const alertSpy = jest
      .spyOn(window, "alert")
      .mockImplementation(() => undefined);
    mockGetWorkflowRunsInfo.mockResolvedValue({
      workflowRunInfo: [cgRun(), cgRun({ id: "2", userId: 99 })],
    });
    renderModal({}, { admin: true, userId: 10 });
    await waitFor(() => expect(alertSpy).toHaveBeenCalled());
    expect(alertSpy.mock.calls[0][0]).toContain("Admin warning");
    alertSpy.mockRestore();
  });

  it("does not warn an admin who only selected their own genomes", async () => {
    const alertSpy = jest
      .spyOn(window, "alert")
      .mockImplementation(() => undefined);
    renderModal({}, { admin: true, userId: 10 });
    await waitFor(() => expect(mockGetWorkflowRunsInfo).toHaveBeenCalled());
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  it("does not warn a non-admin who selected another user's genomes", async () => {
    const alertSpy = jest
      .spyOn(window, "alert")
      .mockImplementation(() => undefined);
    mockGetWorkflowRunsInfo.mockResolvedValue({
      workflowRunInfo: [cgRun({ userId: 99 })],
    });
    renderModal({}, { admin: false, userId: 10 });
    await waitFor(() => expect(mockGetWorkflowRunsInfo).toHaveBeenCalled());
    expect(alertSpy).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });
});

describe("NextcladeModal reference tree selection", () => {
  it("starts on the global tree with no uploaded file", async () => {
    renderModal();
    await waitFor(() => expect(mockGetWorkflowRunsInfo).toHaveBeenCalled());
    expect(screen.getByTestId("selected-tree-type").textContent).toBe("global");
    expect(screen.getByTestId("reference-tree-name").textContent).toBe("none");
  });

  it("switches to the upload option and records the chosen file", async () => {
    renderModal();
    await waitFor(() => expect(mockGetWorkflowRunsInfo).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("choose-upload"));
    expect(screen.getByTestId("selected-tree-type").textContent).toBe("upload");
    fireEvent.click(screen.getByTestId("upload-tree"));
    await waitFor(() =>
      expect(screen.getByTestId("reference-tree-name").textContent).toBe(
        "my-tree.json",
      ),
    );
    fireEvent.click(screen.getByTestId("choose-global"));
    expect(screen.getByTestId("selected-tree-type").textContent).toBe("global");
  });
});

describe("NextcladeModal export flow", () => {
  const openConfirmation = async () => {
    const button = await screen.findByText("View QC in Nextclade");
    await waitFor(() =>
      expect((button.closest("button") as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    fireEvent.click(button.closest("button") as HTMLElement);
    return screen.findByText("Confirm");
  };

  it("opens and cancels the confirmation modal", async () => {
    renderModal();
    await openConfirmation();
    expect(
      screen.getByText(/ready to send your consensus genomes/),
    ).toBeTruthy();
    const cancels = screen.getAllByText("Cancel");
    fireEvent.click(
      cancels[cancels.length - 1].closest("button") as HTMLElement,
    );
    await waitFor(() => expect(screen.queryByText("Confirm")).toBeNull());
  });

  it("exports with no reference tree and closes on success", async () => {
    const onClose = jest.fn();
    renderModal({ onClose });
    const confirm = await openConfirmation();
    fireEvent.click(confirm.closest("button") as HTMLElement);
    await waitFor(() =>
      expect(mockCreateConsensusGenomeCladeExport).toHaveBeenCalledWith({
        workflowRunIds: ["1", "2"],
        referenceTreeS3Key: null,
      }),
    );
    expect(mockNextcladeTab.location.href).toBe(
      "https://clades.nextstrain.org/export/abc",
    );
    expect(mockTrackEvent).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it("sends the minified uploaded tree when the upload option is chosen", async () => {
    renderModal();
    await waitFor(() => expect(mockGetWorkflowRunsInfo).toHaveBeenCalled());
    fireEvent.click(screen.getByTestId("choose-upload"));
    fireEvent.click(screen.getByTestId("upload-tree"));
    await waitFor(() =>
      expect(screen.getByTestId("reference-tree-name").textContent).toBe(
        "my-tree.json",
      ),
    );
    const confirm = await openConfirmation();
    fireEvent.click(confirm.closest("button") as HTMLElement);
    await waitFor(() =>
      expect(mockCreateConsensusGenomeCladeExport).toHaveBeenCalledWith({
        workflowRunIds: ["1", "2"],
        referenceTreeS3Key: "clade_exports/trees/temp-abcde",
      }),
    );
    // The validated tree was PUT directly to S3 via the presigned url, not sent through the app.
    expect(mockGetConsensusGenomeCladeExportTreeUrl).toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalledWith(
      "https://s3.example/put-tree",
      expect.objectContaining({ method: "PUT" }),
    );
    // The key regression check: after the async tree PUT + export, the pre-opened tab is navigated
    // to Nextclade (a deferred window.open here would be popup-blocked and never open).
    expect(mockNextcladeTab.location.href).toBe(
      "https://clades.nextstrain.org/export/abc",
    );
  });

  it("shows the error modal when the export fails, and retries successfully", async () => {
    const onClose = jest.fn();
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    mockCreateConsensusGenomeCladeExport.mockRejectedValueOnce(
      new Error("export blew up"),
    );
    renderModal({ onClose });
    const confirm = await openConfirmation();
    fireEvent.click(confirm.closest("button") as HTMLElement);
    expect(
      await screen.findByText(
        "Sorry! There was an error sending your consensus genomes to Nextclade.",
      ),
    ).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();

    // Retry: this time the export resolves, so the modal closes.
    const retry = await screen.findByText("Try Again");
    fireEvent.click(retry.closest("button") as HTMLElement);
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mockNextcladeTab.location.href).toBe(
      "https://clades.nextstrain.org/export/abc",
    );
    errorSpy.mockRestore();
  });
});

// SMP-1660: a tree that never parsed used to leave referenceTreeContents null
// while the export button stayed live, so the samples went to Nextclade with no
// tree at all and the request returned 200. Every path below must end with the
// export blocked and the reason on screen.
describe("NextcladeModal uploaded reference tree guard", () => {
  const nextcladeButton = () =>
    screen
      .getByText("View QC in Nextclade")
      .closest("button") as HTMLButtonElement;

  const chooseUploadAfterValidation = async () => {
    renderModal();
    await waitFor(() => expect(nextcladeButton().disabled).toBe(false));
    fireEvent.click(screen.getByTestId("choose-upload"));
  };

  it("blocks the export as soon as Upload a Tree is chosen with no file", async () => {
    await chooseUploadAfterValidation();

    expect(nextcladeButton().disabled).toBe(true);
    expect(
      screen.getByText(
        "Upload a reference tree in Auspice JSON format, or choose the Nextclade Default Tree, before continuing.",
      ),
    ).toBeTruthy();
  });

  it("surfaces a parse failure and keeps the export blocked", async () => {
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await chooseUploadAfterValidation();

    fireEvent.click(screen.getByTestId("upload-unparseable-tree"));

    expect(
      await screen.findByText(/We couldn't read that reference tree/),
    ).toBeTruthy();
    expect(nextcladeButton().disabled).toBe(true);
    // The underlying SyntaxError is logged, not swallowed.
    expect(errorSpy).toHaveBeenCalled();
    expect(mockCreateConsensusGenomeCladeExport).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });

  it("rejects JSON that is not an Auspice tree document", async () => {
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await chooseUploadAfterValidation();

    fireEvent.click(screen.getByTestId("upload-non-tree-json"));

    expect(
      await screen.findByText(/We couldn't read that reference tree/),
    ).toBeTruthy();
    expect(nextcladeButton().disabled).toBe(true);
    errorSpy.mockRestore();
  });

  it("keeps the export blocked when the picker hands back no file", async () => {
    await chooseUploadAfterValidation();

    fireEvent.click(screen.getByTestId("upload-nothing"));

    await waitFor(() =>
      expect(screen.getByTestId("reference-tree-name").textContent).toBe(
        "none",
      ),
    );
    expect(nextcladeButton().disabled).toBe(true);
  });

  it("enables the export once a tree parses, and clears the error", async () => {
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await chooseUploadAfterValidation();

    fireEvent.click(screen.getByTestId("upload-unparseable-tree"));
    expect(
      await screen.findByText(/We couldn't read that reference tree/),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId("upload-tree"));

    await waitFor(() => expect(nextcladeButton().disabled).toBe(false));
    expect(
      screen.queryByText(/We couldn't read that reference tree/),
    ).toBeNull();
    errorSpy.mockRestore();
  });

  it("re-blocks the export when a good tree is replaced by a bad one", async () => {
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await chooseUploadAfterValidation();

    fireEvent.click(screen.getByTestId("upload-tree"));
    await waitFor(() => expect(nextcladeButton().disabled).toBe(false));

    fireEvent.click(screen.getByTestId("upload-unparseable-tree"));

    await waitFor(() => expect(nextcladeButton().disabled).toBe(true));
    expect(
      screen.getByText(/We couldn't read that reference tree/),
    ).toBeTruthy();
    errorSpy.mockRestore();
  });

  it("drops the upload error when the user falls back to the default tree", async () => {
    const errorSpy = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    await chooseUploadAfterValidation();

    fireEvent.click(screen.getByTestId("upload-unparseable-tree"));
    expect(
      await screen.findByText(/We couldn't read that reference tree/),
    ).toBeTruthy();

    fireEvent.click(screen.getByTestId("choose-global"));

    await waitFor(() => expect(nextcladeButton().disabled).toBe(false));
    expect(
      screen.queryByText(/We couldn't read that reference tree/),
    ).toBeNull();
    errorSpy.mockRestore();
  });
});
