// Coverage: app/assets/src/components/views/SampleView/components/ModalManager/components/ConsensusGenomeModals/ConsensusGenomeCreationModal.tsx
//
// ConsensusGenomeCreationModal drives a Relay mutation to kick off a WGS run.
// Relay, analytics, csrf and logging are stubbed so the assertions land on this
// file's logic: mapping best_accessions into dropdown options (disabled +
// partial/complete/plain subtext), the create guard (missing selection/taxid ->
// logError, no mutation), a valid create (commits + tracks, onCompleted /
// onError branches), and the error modal wiring. Heavy UI children (Modal,
// SubtextDropdown, ErrorModal, tooltip, external link) are stubbed to expose
// their props.
import { fireEvent, render, screen } from "@testing-library/react";

const mockCommit = jest.fn();
const mockTrackEvent = jest.fn();
const mockLogError = jest.fn();
let mockIsInFlight = false;

jest.mock("react-relay", () => ({
  graphql: () => "MUTATION",
  useMutation: () => [mockCommit, mockIsInFlight],
}));

jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: {
    CONSENSUS_GENOME_CREATION_MODAL_CREATE_BUTTON_CLICKED: "cg-create-click",
  },
  useTrackEvent: () => mockTrackEvent,
}));

jest.mock("~/api/utils", () => ({
  getCsrfToken: () => "csrf-token",
}));

jest.mock("~/components/utils/logUtil", () => ({
  logError: (...args: unknown[]) => mockLogError(...args),
}));

jest.mock("~ui/containers/Modal", () => ({
  __esModule: true,
  default: (props: $TSFixMe) =>
    props.open ? <div data-testid="modal">{props.children}</div> : null,
}));

jest.mock("~ui/containers/ErrorModal", () => ({
  __esModule: true,
  default: (props: $TSFixMe) =>
    props.open ? (
      <div data-testid="error-modal">
        <button data-testid="error-cancel" onClick={props.onCancel} />
        <button data-testid="error-confirm" onClick={props.onConfirm} />
      </div>
    ) : null,
}));

jest.mock("~ui/containers/ColumnHeaderTooltip", () => ({
  __esModule: true,
  default: () => <div data-testid="tooltip" />,
}));

jest.mock("~/components/ui/controls/ExternalLink", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <a>{props.children}</a>,
}));

const mockDropdownProps: $TSFixMe[] = [];
jest.mock("~ui/controls/dropdowns", () => ({
  SubtextDropdown: (props: $TSFixMe) => {
    mockDropdownProps.push(props);
    return (
      <div data-testid="subtext-dropdown">
        {props.options.map((o: $TSFixMe) => (
          <button
            key={o.value}
            data-testid={`accession-${o.value}`}
            data-disabled={String(!!o.disabled)}
            data-subtext={o.subtext}
            onClick={() => props.onChange(o.value)}
          />
        ))}
      </div>
    );
  },
}));

import { ConsensusGenomeCreationModal } from "~/components/views/SampleView/components/ModalManager/components/ConsensusGenomeModals/ConsensusGenomeCreationModal";

const sample = {
  id: 99,
  project: { pinned_alignment_config: "cfg-1" },
} as $TSFixMe;

const consensusGenomeData = {
  taxName: "Influenza A",
  taxId: 11320,
  percentIdentity: 98,
  usedAccessions: ["ACC_USED"],
  accessionData: {
    best_accessions: [
      {
        id: "ACC1",
        name: "Influenza A partial cds",
        coverage_depth: 12,
      },
      {
        id: "ACC2",
        name: "Influenza A complete genome",
        coverage_depth: 30,
      },
      {
        id: "ACC_USED",
        name: "Influenza A other",
        coverage_depth: 5,
      },
    ],
  },
} as $TSFixMe;

const renderModal = (props: $TSFixMe = {}) => {
  const handleModalAction = props.handleModalAction || jest.fn();
  const handleConsensusGenomeKickoff =
    props.handleConsensusGenomeKickoff || jest.fn();
  const onClose = props.onClose || jest.fn();
  const utils = render(
    <ConsensusGenomeCreationModal
      open
      onClose={onClose}
      sample={sample}
      consensusGenomeData={props.consensusGenomeData || consensusGenomeData}
      handleModalAction={handleModalAction}
      handleConsensusGenomeKickoff={handleConsensusGenomeKickoff}
      modalsVisible={
        props.modalsVisible || ({ consensusGenomeError: false } as $TSFixMe)
      }
    />,
  );
  return { ...utils, handleModalAction, handleConsensusGenomeKickoff, onClose };
};

beforeEach(() => {
  jest.clearAllMocks();
  mockDropdownProps.length = 0;
  mockIsInFlight = false;
});

describe("ConsensusGenomeCreationModal render + accession options", () => {
  it("renders the taxon name and the create button", () => {
    renderModal();
    expect(screen.getByText("Influenza A")).toBeTruthy();
    expect(screen.getByText("Create Consensus Genome")).toBeTruthy();
  });

  it("builds one option per accession, disabling already-used ones", () => {
    renderModal();
    expect(
      screen.getByTestId("accession-0").getAttribute("data-disabled"),
    ).toBe("false");
    expect(
      screen.getByTestId("accession-2").getAttribute("data-disabled"),
    ).toBe("true");
  });

  it("labels partial, complete and plain accessions in the subtext", () => {
    renderModal();
    expect(
      screen.getByTestId("accession-0").getAttribute("data-subtext"),
    ).toContain("Partial Sequence");
    expect(
      screen.getByTestId("accession-1").getAttribute("data-subtext"),
    ).toContain("Complete Sequence");
    // Third accession name has neither keyword -> undefined completeness.
    expect(
      screen.getByTestId("accession-2").getAttribute("data-subtext"),
    ).toContain("undefined");
  });

  it("passes an empty option list when there is no accession data", () => {
    renderModal({
      consensusGenomeData: { taxName: "X", taxId: 1 } as $TSFixMe,
    });
    expect(screen.queryByTestId("accession-0")).toBeNull();
  });

  it("shows the in-flight label while a mutation is committing", () => {
    mockIsInFlight = true;
    renderModal();
    expect(screen.getByText("Creating Consensus Genome")).toBeTruthy();
    expect(screen.queryByText("Create Consensus Genome")).toBeNull();
  });
});

describe("ConsensusGenomeCreationModal create guard", () => {
  it("logs an error and does not commit when no accession is selected", () => {
    renderModal();
    fireEvent.click(screen.getByText("Create Consensus Genome"));
    expect(mockLogError).toHaveBeenCalledWith(
      expect.objectContaining({
        message:
          "ModalManage: handleConsensusGenomeCreate called with invalid params",
      }),
    );
    expect(mockCommit).not.toHaveBeenCalled();
  });

  it("logs an error when taxId is missing even with a selection", () => {
    renderModal({
      consensusGenomeData: {
        ...consensusGenomeData,
        taxId: undefined,
      } as $TSFixMe,
    });
    fireEvent.click(screen.getByTestId("accession-0"));
    fireEvent.click(screen.getByText("Create Consensus Genome"));
    expect(mockLogError).toHaveBeenCalled();
    expect(mockCommit).not.toHaveBeenCalled();
  });
});

describe("ConsensusGenomeCreationModal create success/error", () => {
  it("commits the mutation and tracks the event for a valid selection", () => {
    renderModal();
    fireEvent.click(screen.getByTestId("accession-1"));
    fireEvent.click(screen.getByText("Create Consensus Genome"));

    expect(mockCommit).toHaveBeenCalledTimes(1);
    const config = mockCommit.mock.calls[0][0];
    expect(config.variables.sampleId).toBe("99");
    expect(config.variables.input.inputs_json.accession_id).toBe("ACC2");
    expect(config.variables.input.inputs_json.taxon_id).toBe("11320");
    expect(config.variables.input.authenticityToken).toBe("csrf-token");
    expect(mockTrackEvent).toHaveBeenCalledWith(
      "cg-create-click",
      expect.objectContaining({ accessionId: "ACC2", sampleId: 99 }),
    );
  });

  it("kicks off the run in the mutation onCompleted callback", () => {
    const handleConsensusGenomeKickoff = jest.fn();
    renderModal({ handleConsensusGenomeKickoff });
    fireEvent.click(screen.getByTestId("accession-0"));
    fireEvent.click(screen.getByText("Create Consensus Genome"));
    const config = mockCommit.mock.calls[0][0];
    config.onCompleted();
    expect(handleConsensusGenomeKickoff).toHaveBeenCalledWith(sample);
  });

  it("opens the error modal in the mutation onError callback", () => {
    const handleModalAction = jest.fn();
    renderModal({ handleModalAction });
    fireEvent.click(screen.getByTestId("accession-0"));
    fireEvent.click(screen.getByText("Create Consensus Genome"));
    const config = mockCommit.mock.calls[0][0];
    config.onError(new Error("boom"));
    expect(handleModalAction).toHaveBeenCalledWith([
      ["open", "consensusGenomeError"],
    ]);
  });

  it("opens the error modal when commitMutation throws synchronously", () => {
    const handleModalAction = jest.fn();
    mockCommit.mockImplementationOnce(() => {
      throw new Error("commit failed");
    });
    renderModal({ handleModalAction });
    fireEvent.click(screen.getByTestId("accession-0"));
    fireEvent.click(screen.getByText("Create Consensus Genome"));
    expect(handleModalAction).toHaveBeenCalledWith([
      ["open", "consensusGenomeError"],
    ]);
  });
});

describe("ConsensusGenomeCreationModal error modal", () => {
  it("renders the error modal and closes it via onCancel", () => {
    const handleModalAction = jest.fn();
    renderModal({
      handleModalAction,
      modalsVisible: { consensusGenomeError: true } as $TSFixMe,
    });
    expect(screen.getByTestId("error-modal")).toBeTruthy();
    fireEvent.click(screen.getByTestId("error-cancel"));
    expect(handleModalAction).toHaveBeenCalledWith([
      ["close", "consensusGenomeError"],
    ]);
  });

  it("hides the error modal when consensusGenomeError is false", () => {
    renderModal();
    expect(screen.queryByTestId("error-modal")).toBeNull();
  });
});
