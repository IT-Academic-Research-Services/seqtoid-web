// Frontend coverage for BlastReadsModal: the modal fetches the longest reads
// for a taxon, renders the NT/NR count-type tabs (disabling the ones that have
// no hits), builds an NCBI BLAST URL from the fetched reads, and then drives
// the "Continue" flow -- which either redirects straight away (when the user
// previously opted into auto-redirect for the session) or opens the
// BlastRedirectionModal first.
//
// The redirection modal and the blast notification are stubbed so the
// continue/cancel callbacks can be driven directly; everything else (tabs,
// buttons, alignment-range copy) renders for real.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BlastReadsModal } from "~/components/views/SampleView/components/ModalManager/components/BlastModals/BlastReadsModal";

const mockFetchLongestReads = jest.fn();
const mockOpenUrlInNewTab = jest.fn();
const mockShowBlastNotification = jest.fn();
const mockTrackEvent = jest.fn();

jest.mock("~/api/blast", () => ({
  fetchLongestReadsForTaxonId: (...args: unknown[]) =>
    mockFetchLongestReads(...args),
}));

jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: {
    BLAST_REDIRECTION_MODAL_CONTINUE_BUTTON_CLICKED: "redirection-continue",
  },
  useTrackEvent: () => mockTrackEvent,
}));

jest.mock("~/components/utils/links", () => ({
  openUrlInNewTab: (...args: unknown[]) => mockOpenUrlInNewTab(...args),
}));

jest.mock(
  "~/components/views/SampleView/components/ModalManager/components/BlastModals/BlastNotification",
  () => ({
    showBlastNotification: () => mockShowBlastNotification(),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/ModalManager/components/BlastModals/BlastRedirectionModal",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => (
      <div data-testid="redirection-modal">
        <button
          data-testid="redirect-close"
          onClick={() => props.onClose()}
        ></button>
        <button
          data-testid="redirect-continue-auto"
          onClick={() => props.onContinue(true)}
        ></button>
        <button
          data-testid="redirect-continue-once"
          onClick={() => props.onContinue(false)}
        ></button>
      </div>
    ),
  }),
);

const baseProps = {
  context: { source: "report" },
  onClose: jest.fn(),
  open: true,
  sampleId: 12,
  pipelineVersion: "8.0",
  taxonName: "Klebsiella pneumoniae",
  taxonLevel: 1,
  taxonId: 573,
};

const renderModal = (props = {}) =>
  render(
    <BlastReadsModal
      {...(baseProps as $TSFixMe)}
      onClose={(props as $TSFixMe).onClose ?? baseProps.onClose}
      {...(props as $TSFixMe)}
    />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  mockFetchLongestReads.mockResolvedValue({
    reads: [">read1\nACGT\n", ">read2\nTTTT\n"],
    shortestAlignmentLength: 42,
    longestAlignmentLength: 108,
  });
});

describe("BlastReadsModal", () => {
  it("fetches reads for the default NT tab and renders the alignment range", async () => {
    renderModal({
      blastModalInfo: {
        showCountTypeTabs: true,
        availableCountTypeTabsForReads: ["NT", "NR"],
        selectedBlastType: "blastn",
      },
    });

    await waitFor(() => expect(mockFetchLongestReads).toHaveBeenCalled());

    expect(mockFetchLongestReads).toHaveBeenCalledWith(
      expect.objectContaining({
        countType: "NT",
        sampleId: 12,
        pipelineVersion: "8.0",
        taxonId: 573,
        taxonLevel: 1,
      }),
    );
    expect(await screen.findByText(/Up to 5 NT reads/)).toBeTruthy();
    expect(screen.getByText(/42/)).toBeTruthy();
    expect(screen.getByText(/108/)).toBeTruthy();
    expect(screen.getByText("Klebsiella pneumoniae")).toBeTruthy();
    expect(screen.getByText("blastn")).toBeTruthy();
    expect(screen.getByText("Confirm reads")).toBeTruthy();
  });

  it("renders no count-type tabs when showCountTypeTabs is false", async () => {
    renderModal({
      blastModalInfo: {
        showCountTypeTabs: false,
        availableCountTypeTabsForReads: ["NT"],
        selectedBlastType: "blastn",
      },
    });

    await waitFor(() => expect(mockFetchLongestReads).toHaveBeenCalled());
    expect(screen.queryByText("NT hits")).toBeNull();
    expect(screen.queryByText("NR hits")).toBeNull();
    // Falls back to NT when there is no selected tab.
    expect(mockFetchLongestReads).toHaveBeenCalledWith(
      expect.objectContaining({ countType: "NT" }),
    );
  });

  it("disables the NR tab (and only that tab) when there are no NR hits", async () => {
    renderModal({
      blastModalInfo: {
        showCountTypeTabs: true,
        availableCountTypeTabsForReads: ["NT"],
        selectedBlastType: "blastn",
      },
    });

    await waitFor(() => expect(mockFetchLongestReads).toHaveBeenCalled());

    const ntTab = screen.getByText("NT hits").closest("button");
    const nrTab = screen.getByText("NR hits").closest("button");
    expect(ntTab?.hasAttribute("disabled")).toBe(false);
    expect(nrTab?.hasAttribute("disabled")).toBe(true);
  });

  it("disables the NT tab when only NR hits are available", async () => {
    renderModal({
      blastModalInfo: {
        showCountTypeTabs: true,
        availableCountTypeTabsForReads: ["NR"],
        selectedBlastType: "blastx",
      },
    });

    await waitFor(() => expect(mockFetchLongestReads).toHaveBeenCalled());

    expect(
      screen.getByText("NT hits").closest("button")?.hasAttribute("disabled"),
    ).toBe(true);
    expect(
      screen.getByText("NR hits").closest("button")?.hasAttribute("disabled"),
    ).toBe(false);
    // First available tab for reads is NR -> index 1 -> NR fetched.
    expect(mockFetchLongestReads).toHaveBeenCalledWith(
      expect.objectContaining({ countType: "NR" }),
    );
  });

  it("refetches with the NR count type when the user switches tabs", async () => {
    renderModal({
      blastModalInfo: {
        showCountTypeTabs: true,
        availableCountTypeTabsForReads: ["NT", "NR"],
        selectedBlastType: "blastn",
      },
    });

    await waitFor(() => expect(mockFetchLongestReads).toHaveBeenCalled());
    mockFetchLongestReads.mockClear();

    fireEvent.click(screen.getByText("NR hits"));

    await waitFor(() =>
      expect(mockFetchLongestReads).toHaveBeenCalledWith(
        expect.objectContaining({ countType: "NR" }),
      ),
    );
    expect(await screen.findByText(/Up to 5 NR reads/)).toBeTruthy();
  });

  it("opens the redirection modal on Continue when auto-redirect is not set", async () => {
    renderModal({
      blastModalInfo: {
        showCountTypeTabs: true,
        availableCountTypeTabsForReads: ["NT", "NR"],
        selectedBlastType: "blastn",
      },
    });
    await waitFor(() => expect(mockFetchLongestReads).toHaveBeenCalled());

    expect(screen.queryByTestId("redirection-modal")).toBeNull();
    fireEvent.click(screen.getByText("Continue"));

    expect(screen.getByTestId("redirection-modal")).toBeTruthy();
    expect(mockOpenUrlInNewTab).not.toHaveBeenCalled();
    expect(mockShowBlastNotification).not.toHaveBeenCalled();

    // Closing the redirection modal returns to the reads modal.
    fireEvent.click(screen.getByTestId("redirect-close"));
    expect(screen.queryByTestId("redirection-modal")).toBeNull();
  });

  it("redirects immediately on Continue when auto-redirect was stored in the session", async () => {
    const onClose = jest.fn();
    renderModal({
      onClose,
      blastModalInfo: {
        showCountTypeTabs: true,
        availableCountTypeTabsForReads: ["NT", "NR"],
        selectedBlastType: "blastn",
      },
    });
    await waitFor(() => expect(mockFetchLongestReads).toHaveBeenCalled());

    sessionStorage.setItem("blast", "true");
    fireEvent.click(screen.getByText("Continue"));

    expect(mockOpenUrlInNewTab).toHaveBeenCalledTimes(1);
    expect(mockOpenUrlInNewTab.mock.calls[0][0]).toContain(
      "blast.ncbi.nlm.nih.gov",
    );
    expect(mockShowBlastNotification).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("redirection-modal")).toBeNull();
  });

  it("logs the blast event and stores the auto-redirect preference when continuing with auto-redirect", async () => {
    const onClose = jest.fn();
    renderModal({
      onClose,
      blastModalInfo: {
        showCountTypeTabs: true,
        availableCountTypeTabsForReads: ["NT", "NR"],
        selectedBlastType: "blastn",
      },
    });
    await waitFor(() => expect(mockFetchLongestReads).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByTestId("redirect-continue-auto"));

    expect(sessionStorage.getItem("blast")).toBe("true");
    expect(mockOpenUrlInNewTab).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "redirection-continue",
      expect.objectContaining({
        automaticallyRedirectedToNCBI: true,
        numberOfReads: 2,
        shortestAlignmentLength: 42,
        longestAlignmentLength: 108,
        sampleId: 12,
        countType: "NT",
        blastType: "blastn",
        source: "report",
      }),
    );
    expect(mockShowBlastNotification).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not store the auto-redirect preference when continuing just once", async () => {
    renderModal({
      blastModalInfo: {
        showCountTypeTabs: true,
        availableCountTypeTabsForReads: ["NT", "NR"],
        selectedBlastType: "blastn",
      },
    });
    await waitFor(() => expect(mockFetchLongestReads).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByTestId("redirect-continue-once"));

    expect(sessionStorage.getItem("blast")).toBeNull();
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "redirection-continue",
      expect.objectContaining({ automaticallyRedirectedToNCBI: false }),
    );
    expect(mockOpenUrlInNewTab).toHaveBeenCalledTimes(1);
  });

  it("closes the modal when Cancel is clicked", async () => {
    const onClose = jest.fn();
    renderModal({
      onClose,
      blastModalInfo: {
        showCountTypeTabs: false,
        availableCountTypeTabsForReads: ["NT"],
        selectedBlastType: "blastn",
      },
    });
    await waitFor(() => expect(mockFetchLongestReads).toHaveBeenCalled());

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockOpenUrlInNewTab).not.toHaveBeenCalled();
  });
});
