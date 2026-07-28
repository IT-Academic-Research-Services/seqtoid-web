// Frontend coverage for BlastContigsModal: it fetches the longest contigs for a
// taxon, lets the user pick contigs, and builds the NCBI BLAST URL(s) from the
// selection -- a single combined URL normally, but one URL per contig once the
// combined sequence exceeds NCBI's ~7500bp limit (which also surfaces an
// explanatory notification). Continue either redirects straight away (session
// auto-redirect) or opens the BlastRedirectionModal first.
//
// The virtualized contigs table and the redirection modal are stubbed so
// selection and the continue/cancel callbacks can be driven directly.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BlastContigsModal } from "~/components/views/SampleView/components/ModalManager/components/BlastModals/BlastContigsModal";

const mockFetchLongestContigs = jest.fn();
const mockOpenUrlInNewTab = jest.fn();
const mockShowBlastNotification = jest.fn();
const mockTrackEvent = jest.fn();

jest.mock("~/api/blast", () => ({
  fetchLongestContigsForTaxonId: (...args: unknown[]) =>
    mockFetchLongestContigs(...args),
}));

jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: {
    BLAST_CONTIGS_MODAL_CONTINUE_BUTTON_CLICKED: "contigs-continue",
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
  "~/components/views/SampleView/components/ModalManager/components/BlastModals/BlastContigsTable",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => (
      <div data-testid="contigs-table">
        <span data-testid="contig-count">{props.contigs.length}</span>
        <span data-testid="selected-count">{props.selectedContigs.size}</span>
        {props.contigs.map((contig: $TSFixMe) => (
          <button
            key={contig.contig_id}
            data-testid={`select-${contig.contig_id}`}
            onClick={() => props.onContigSelection(contig.contig_id, true)}
          />
        ))}
        <button
          data-testid="deselect-1"
          onClick={() => props.onContigSelection(1, false)}
        />
        <button
          data-testid="select-all"
          onClick={() => props.onAllContigsSelected(true)}
        />
        <button
          data-testid="deselect-all"
          onClick={() => props.onAllContigsSelected(false)}
        />
      </div>
    ),
  }),
);

jest.mock(
  "~/components/views/SampleView/components/ModalManager/components/BlastModals/BlastRedirectionModal",
  () => ({
    __esModule: true,
    default: (props: $TSFixMe) => (
      <div data-testid="redirection-modal">
        <span data-testid="multiple-tabs">
          {String(!!props.shouldOpenMultipleTabs)}
        </span>
        <button data-testid="redirect-close" onClick={() => props.onClose()} />
        <button
          data-testid="redirect-continue-auto"
          onClick={() => props.onContinue(true)}
        />
        <button
          data-testid="redirect-continue-once"
          onClick={() => props.onContinue(false)}
        />
      </div>
    ),
  }),
);

const shortContigs = [
  {
    contig_id: 1,
    contig_length: 100,
    contig_name: "contig_1",
    fasta_sequence: "ACGT",
    num_reads: 5,
  },
  {
    contig_id: 2,
    contig_length: 200,
    contig_name: "contig_2",
    fasta_sequence: "TTTT",
    num_reads: 6,
  },
];

const longContigs = [
  {
    contig_id: 1,
    contig_length: 5000,
    contig_name: "contig_1",
    fasta_sequence: "AAAA",
    num_reads: 5,
  },
  {
    contig_id: 2,
    contig_length: 5000,
    contig_name: "contig_2",
    fasta_sequence: "CCCC",
    num_reads: 6,
  },
];

const baseProps = {
  context: { source: "report" },
  onClose: jest.fn(),
  open: true,
  sampleId: 12,
  pipelineVersion: "8.0",
  taxonName: "Klebsiella pneumoniae",
  taxonId: 573,
  blastModalInfo: {
    showCountTypeTabs: true,
    availableCountTypeTabsForContigs: ["NT", "NR"],
    selectedBlastType: "blastn",
  },
};

const renderModal = (props = {}) =>
  render(
    <BlastContigsModal {...(baseProps as $TSFixMe)} {...(props as $TSFixMe)} />,
  );

beforeEach(() => {
  jest.clearAllMocks();
  sessionStorage.clear();
  mockFetchLongestContigs.mockResolvedValue({ contigs: shortContigs });
});

describe("BlastContigsModal", () => {
  it("fetches contigs for the default NT tab and renders them", async () => {
    renderModal();

    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );
    expect(mockFetchLongestContigs).toHaveBeenCalledWith(
      expect.objectContaining({
        countType: "NT",
        sampleId: 12,
        pipelineVersion: "8.0",
        taxonId: 573,
      }),
    );
    expect(screen.getByText("Klebsiella pneumoniae")).toBeTruthy();
    expect(screen.getByText("blastn")).toBeTruthy();
    expect(screen.getByText("Select a contig")).toBeTruthy();
  });

  it("disables the Continue button until at least one contig is selected", async () => {
    renderModal();
    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );

    expect(
      screen.getByText("Continue").closest("button")?.hasAttribute("disabled"),
    ).toBe(true);

    fireEvent.click(screen.getByTestId("select-1"));

    expect(
      screen.getByText("Continue").closest("button")?.hasAttribute("disabled"),
    ).toBe(false);
    expect(screen.getByTestId("selected-count").textContent).toBe("1");
  });

  it("adds and removes contigs from the selection", async () => {
    renderModal();
    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );

    fireEvent.click(screen.getByTestId("select-1"));
    fireEvent.click(screen.getByTestId("select-2"));
    expect(screen.getByTestId("selected-count").textContent).toBe("2");

    fireEvent.click(screen.getByTestId("deselect-1"));
    expect(screen.getByTestId("selected-count").textContent).toBe("1");
  });

  it("selects and clears every contig via the select-all affordance", async () => {
    renderModal();
    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );

    fireEvent.click(screen.getByTestId("select-all"));
    expect(screen.getByTestId("selected-count").textContent).toBe("2");

    fireEvent.click(screen.getByTestId("deselect-all"));
    expect(screen.getByTestId("selected-count").textContent).toBe("0");
  });

  it("shows no long-contig notification for short sequences and opens a single BLAST tab", async () => {
    renderModal();
    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );

    fireEvent.click(screen.getByTestId("select-all"));
    expect(screen.queryByText(/exceeds ~7500 base pairs/)).toBeNull();

    sessionStorage.setItem("blast", "true");
    fireEvent.click(screen.getByText("Continue"));

    // Both sequences are concatenated into one query.
    expect(mockOpenUrlInNewTab).toHaveBeenCalledTimes(1);
    expect(mockOpenUrlInNewTab.mock.calls[0][0]).toContain("QUERY=ACGTTTTT");
  });

  it("warns about long contigs and opens one BLAST tab per contig", async () => {
    mockFetchLongestContigs.mockResolvedValue({ contigs: longContigs });
    const onClose = jest.fn();
    renderModal({ onClose });
    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );

    fireEvent.click(screen.getByTestId("select-all"));
    expect(screen.getByText(/exceeds ~7500 base pairs/)).toBeTruthy();

    fireEvent.click(screen.getByText("Continue"));
    // Not auto-redirecting: redirection modal appears, and it is told to warn
    // about multiple tabs since >1 long contig is selected.
    expect(screen.getByTestId("multiple-tabs").textContent).toBe("true");

    fireEvent.click(screen.getByTestId("redirect-continue-once"));
    expect(mockOpenUrlInNewTab).toHaveBeenCalledTimes(2);
    expect(mockShowBlastNotification).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("logs the continue event and stores auto-redirect when the user opts in", async () => {
    const onClose = jest.fn();
    renderModal({ onClose });
    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );

    fireEvent.click(screen.getByTestId("select-1"));
    fireEvent.click(screen.getByText("Continue"));

    expect(mockTrackEvent).toHaveBeenCalledWith(
      "contigs-continue",
      expect.objectContaining({
        automaticallyRedirectedToNCBI: false,
        numberOfContigs: 1,
        sampleId: 12,
        countType: "NT",
        blastType: "blastn",
        source: "report",
      }),
    );

    fireEvent.click(screen.getByTestId("redirect-continue-auto"));
    expect(sessionStorage.getItem("blast")).toBe("true");
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "redirection-continue",
      expect.objectContaining({ automaticallyRedirectedToNCBI: true }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("redirection-modal")).toBeNull();
  });

  it("skips the redirection modal when auto-redirect is already set for the session", async () => {
    const onClose = jest.fn();
    renderModal({ onClose });
    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );

    sessionStorage.setItem("blast", "true");
    fireEvent.click(screen.getByTestId("select-1"));
    fireEvent.click(screen.getByText("Continue"));

    expect(screen.queryByTestId("redirection-modal")).toBeNull();
    expect(mockOpenUrlInNewTab).toHaveBeenCalledTimes(1);
    expect(mockShowBlastNotification).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "contigs-continue",
      expect.objectContaining({ automaticallyRedirectedToNCBI: true }),
    );
  });

  it("closes the redirection modal without redirecting", async () => {
    renderModal();
    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );

    fireEvent.click(screen.getByTestId("select-1"));
    fireEvent.click(screen.getByText("Continue"));
    expect(screen.getByTestId("redirection-modal")).toBeTruthy();

    fireEvent.click(screen.getByTestId("redirect-close"));
    expect(screen.queryByTestId("redirection-modal")).toBeNull();
    expect(mockOpenUrlInNewTab).not.toHaveBeenCalled();
  });

  it("resets the contig selection and refetches when switching to the NR tab", async () => {
    renderModal();
    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );

    fireEvent.click(screen.getByTestId("select-all"));
    expect(screen.getByTestId("selected-count").textContent).toBe("2");

    mockFetchLongestContigs.mockClear();
    fireEvent.click(screen.getByText("NR hits"));

    await waitFor(() =>
      expect(mockFetchLongestContigs).toHaveBeenCalledWith(
        expect.objectContaining({ countType: "NR" }),
      ),
    );
    expect(screen.getByTestId("selected-count").textContent).toBe("0");
  });

  it("disables the NR tab when there are no NR contigs", async () => {
    renderModal({
      blastModalInfo: {
        showCountTypeTabs: true,
        availableCountTypeTabsForContigs: ["NT"],
        selectedBlastType: "blastn",
      },
    });
    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );

    expect(
      screen.getByText("NT hits").closest("button")?.hasAttribute("disabled"),
    ).toBe(false);
    expect(
      screen.getByText("NR hits").closest("button")?.hasAttribute("disabled"),
    ).toBe(true);
  });

  it("renders no count-type tabs when showCountTypeTabs is false", async () => {
    renderModal({
      blastModalInfo: {
        showCountTypeTabs: false,
        availableCountTypeTabsForContigs: ["NT"],
        selectedBlastType: "blastn",
      },
    });
    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );

    expect(screen.queryByText("NT hits")).toBeNull();
    expect(screen.queryByText("NR hits")).toBeNull();
    expect(mockFetchLongestContigs).toHaveBeenCalledWith(
      expect.objectContaining({ countType: "NT" }),
    );
  });

  it("closes the modal when Cancel is clicked", async () => {
    const onClose = jest.fn();
    renderModal({ onClose });
    await waitFor(() =>
      expect(screen.getByTestId("contig-count").textContent).toBe("2"),
    );

    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockOpenUrlInNewTab).not.toHaveBeenCalled();
  });
});
