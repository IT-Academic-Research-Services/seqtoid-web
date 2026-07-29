// Branch coverage:
// app/assets/src/components/views/SampleUploadFlow/components/UploadSampleStep/
//   UploadSampleStep.tsx
//
// The sibling spec (UploadSampleStep-UploadSampleStep.test.tsx) drives the
// happy paths. This one deliberately picks up the conditionals that spec never
// reaches:
//   * componentDidMount's URL pre-selection (?projectId=) and its
//     "no projects came back" fallback,
//   * the window "message" listener that finishes the Basespace OAuth handshake
//     (both the accepted message and one from a window we never opened),
//   * de-selecting one of *two* chosen workflows, which keeps the technology,
//   * a reference sequence whose header is not NCBI GenBank, and the "Unknown"
//     taxon that must be sent upstream as null,
//   * the sequencing-format mismatch marker on local files (and its Nanopore
//     counterpart, which must *not* be flagged),
//   * mergeSamples' customizer, which only runs once samples already exist,
//   * the whole S3/remote tab: file naming, selection, Continue, and the
//     500-sample ceiling.

jest.mock("@biowasm/aioli", () => ({
  __esModule: true,
  default: class {
    tools: $TSFixMe;
    constructor(tools: $TSFixMe) {
      this.tools = tools;
    }
  },
}));

const mockGetProjects = jest.fn();
const mockValidateSampleNames = jest.fn();
const mockValidateSampleFiles = jest.fn();
jest.mock("~/api", () => ({
  getProjects: (...args: $TSFixMe[]) => mockGetProjects(...args),
  validateSampleNames: (...args: $TSFixMe[]) =>
    mockValidateSampleNames(...args),
  validateSampleFiles: (...args: $TSFixMe[]) =>
    mockValidateSampleFiles(...args),
}));

const mockTrackEvent = jest.fn();
jest.mock("~/api/analytics", () => ({
  useTrackEvent: () => mockTrackEvent,
  useWithAnalytics: () => (fn: $TSFixMe) => fn,
  ANALYTICS_EVENT_NAMES: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

jest.mock("~/components/common/UserContext", () => ({
  useAllowedFeatures: () => [],
  UserContext: { Provider: (p: $TSFixMe) => p.children },
}));

const mockGetReadNames = jest.fn();
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadSampleStep/utils",
  () => ({
    ...jest.requireActual(
      "~/components/views/SampleUploadFlow/components/UploadSampleStep/utils",
    ),
    getReadNames: (...args: $TSFixMe[]) => mockGetReadNames(...args),
  }),
);

// The object the component stores as `this._window`; the OAuth message is only
// honoured when event.source is identical to it.
const mockPopupWindow = { name: "basespace-oauth-window" };
const mockOpenBasespacePopup = jest.fn(() => mockPopupWindow);
jest.mock("~/components/views/SampleUploadFlow/utils", () => ({
  ...jest.requireActual("~/components/views/SampleUploadFlow/utils"),
  openBasespaceOAuthPopup: (...args: $TSFixMe[]) =>
    mockOpenBasespacePopup(...args),
}));

// ----- child stubs -----
let projectSelectProps: $TSFixMe = null;
jest.mock("~/components/common/ProjectSelect", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    projectSelectProps = props;
    return <div data-testid="project-select" />;
  },
}));

jest.mock("~/components/common/ProjectCreationModal", () => ({
  __esModule: true,
  default: () => <div data-testid="project-creation-modal" />,
}));

let workflowSelectorProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleUploadFlow/components/WorkflowSelector",
  () => ({
    __esModule: true,
    WorkflowSelector: (props: $TSFixMe) => {
      workflowSelectorProps = props;
      return (
        <div
          data-testid="workflow-selector"
          data-selected={Array.from(props.selectedWorkflows).join(",")}
          data-technology={props.selectedTechnology}
        />
      );
    },
  }),
);

let sampleUploadTableProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadSampleStep/components/SampleUploadTable",
  () => ({
    __esModule: true,
    SampleUploadTable: (props: $TSFixMe) => {
      sampleUploadTableProps = props;
      return (
        <div
          data-testid="sample-upload-table"
          data-count={String(props.samples.length)}
          data-selected-count={String(props.selectedSampleIds.size)}
        />
      );
    },
  }),
);

let localUploadProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadSampleStep/components/LocalSampleFileUpload",
  () => ({
    __esModule: true,
    LocalSampleFileUpload: (props: $TSFixMe) => {
      localUploadProps = props;
      return <div data-testid="local-upload" />;
    },
  }),
);

let remoteUploadProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadSampleStep/components/RemoteSampleFileUpload",
  () => ({
    __esModule: true,
    RemoteSampleFileUpload: (props: $TSFixMe) => {
      remoteUploadProps = props;
      return <div data-testid="remote-upload" />;
    },
  }),
);

let basespaceProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadSampleStep/components/BasespaceSampleImport",
  () => ({
    __esModule: true,
    BasespaceSampleImport: (props: $TSFixMe) => {
      basespaceProps = props;
      return <div data-testid="basespace-import" />;
    },
  }),
);

let preUploadQCProps: $TSFixMe = null;
jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadSampleStep/components/PreUploadQCCheck",
  () => ({
    __esModule: true,
    PreUploadQCCheck: (props: $TSFixMe) => {
      preUploadQCProps = props;
      return (
        <div
          data-testid="pre-upload-qc"
          data-technology={String(props.sequenceTechnology)}
        />
      );
    },
  }),
);

jest.mock("~ui/notifications/IssueGroup", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="issue-group">{props.caption}</div>
  ),
}));

jest.mock("~/components/common/BasicPopup", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <div data-testid="continue-popup">
      {props.trigger}
      {props.children}
    </div>
  ),
}));

jest.mock("~/components/ui/controls/buttons/PrimaryButton", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <button
      data-testid="continue-button"
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.text}
    </button>
  ),
}));
jest.mock("~/components/ui/controls/buttons/SecondaryButton", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <button>{props.text}</button>,
}));
jest.mock("~/components/ui/controls/ExternalLink", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <a href={props.href}>{props.children}</a>,
}));

let tabsProps: $TSFixMe = null;
jest.mock("@czi-sds/components", () => ({
  __esModule: true,
  Callout: (props: $TSFixMe) => <div>{props.children}</div>,
  Tooltip: (props: $TSFixMe) => <span>{props.children}</span>,
  Tabs: (props: $TSFixMe) => {
    tabsProps = props;
    return <div data-testid="upload-tabs">{props.children}</div>;
  },
  Tab: (props: $TSFixMe) => <div>{props.label}</div>,
}));

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { UploadSampleStep } from "~/components/views/SampleUploadFlow/components/UploadSampleStep/UploadSampleStep";
import { MISMATCH_FORMAT_ERROR } from "~/components/views/SampleUploadFlow/components/UploadSampleStep/constants";
import {
  SEQUENCING_TECHNOLOGY_OPTIONS,
  UNKNOWN_TAXON_OPTION,
  UPLOAD_WORKFLOWS,
} from "~/components/views/SampleUploadFlow/constants";

const PROJECT = { id: 9, name: "Reef" };

const defaultProps = () => ({
  onUploadSamples: jest.fn(),
  onDirty: jest.fn(),
  visible: true,
  basespaceClientId: "client",
  basespaceOauthRedirectUri: "https://redirect",
  getPipelineVersionsForExistingProject: jest
    .fn()
    .mockResolvedValue({ pipelineVersions: {} }),
  pipelineVersions: {},
  latestMajorPipelineVersions: {},
});

const renderStep = async (overrides: $TSFixMe = {}) => {
  const props = { ...defaultProps(), ...overrides };
  const utils = render(<UploadSampleStep {...(props as $TSFixMe)} />);
  await waitFor(() => expect(mockGetProjects).toHaveBeenCalled());
  await act(async () => undefined);
  return { ...utils, props };
};

const continueButton = () =>
  screen.getByTestId("continue-button") as HTMLButtonElement;
const tooltipText = () =>
  screen.getByTestId("upload-continue-tooltip").textContent;
const table = () => screen.getByTestId("sample-upload-table");

const selectProject = async () => {
  await act(async () => {
    await projectSelectProps.onChange(PROJECT);
  });
};

const chooseWorkflow = async (workflow: $TSFixMe, technology?: $TSFixMe) => {
  await act(async () => {
    workflowSelectorProps.onWorkflowToggle(workflow, technology);
  });
};

const switchTab = async (index: number) => {
  await act(async () => {
    tabsProps.onChange(null, index);
  });
};

const addLocalSamples = async (samples: $TSFixMe[]) => {
  await act(async () => {
    await localUploadProps.onChange(samples);
  });
};

const addRemoteSamples = async (samples: $TSFixMe[]) => {
  await act(async () => {
    await remoteUploadProps.onChange(samples);
  });
};

const localSample = (name: string, extra: $TSFixMe = {}) => ({
  name,
  files: { [`${name}.fastq`]: new File(["ACGT"], `${name}.fastq`) },
  input_files_attributes: [{ source: `${name}.fastq`, parts: `${name}.fastq` }],
  finishedValidating: true,
  isValid: true,
  ...extra,
});

const remoteSample = (name: string) => ({
  name,
  input_files_attributes: [
    { source: `s3://bucket/${name}.fastq`, parts: `${name}.fastq` },
  ],
});

// The component only trusts a message whose `source` is the window object it
// got back from openBasespaceOAuthPopup, so the event is built by hand.
const dispatchBasespaceMessage = async (detail: $TSFixMe) => {
  const event = Object.assign(new Event("message"), detail);
  await act(async () => {
    window.dispatchEvent(event);
  });
  await act(async () => undefined);
};

beforeEach(() => {
  jest.clearAllMocks();
  projectSelectProps = null;
  workflowSelectorProps = null;
  sampleUploadTableProps = null;
  localUploadProps = null;
  remoteUploadProps = null;
  basespaceProps = null;
  preUploadQCProps = null;
  tabsProps = null;
  window.history.replaceState({}, "", "/");
  mockOpenBasespacePopup.mockReturnValue(mockPopupWindow);
  mockGetProjects.mockResolvedValue({ projects: [PROJECT] });
  mockValidateSampleNames.mockImplementation(async (_id, names) => names);
  mockValidateSampleFiles.mockImplementation(async (names: string[]) =>
    names.map(() => true),
  );
  mockGetReadNames.mockResolvedValue(null);
});

describe("UploadSampleStep mount-time project pre-selection", () => {
  it("pre-selects the project named in the projectId URL param", async () => {
    window.history.replaceState({}, "", "/samples/upload?projectId=9");

    const { props } = await renderStep();

    expect(props.getPipelineVersionsForExistingProject).toHaveBeenCalledWith(9);
    expect(projectSelectProps.value).toBe(9);
    // The params are wiped once they have been consumed.
    expect(window.location.search).toBe("");
  });

  it("leaves the project unset when the projectId param matches nothing", async () => {
    window.history.replaceState({}, "", "/samples/upload?projectId=4242");

    const { props } = await renderStep();

    expect(props.getPipelineVersionsForExistingProject).not.toHaveBeenCalled();
    expect(projectSelectProps.value).toBeUndefined();
    expect(tooltipText()).toBe("Please select a project to continue");
  });

  it("still renders when the projects request comes back empty-handed", async () => {
    mockGetProjects.mockResolvedValue(undefined);

    await renderStep();

    expect(projectSelectProps.projects).toBeUndefined();
    expect(screen.getByTestId("local-upload")).toBeTruthy();
  });
});

describe("UploadSampleStep basespace OAuth message handling", () => {
  const readyForBasespaceAuth = async () => {
    const rendered = await renderStep();
    // Tabs for a non-admin are [Your Computer, Basespace].
    await switchTab(1);
    await selectProject();
    await chooseWorkflow(
      UPLOAD_WORKFLOWS.MNGS.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );
    await act(async () => {
      await basespaceProps.onChange([
        {
          name: "bs-sample",
          file_type: "fastq",
          file_size: 10,
          basespace_project_id: 3,
          basespace_dataset_id: 11,
        },
      ]);
    });
    await act(async () => {
      fireEvent.click(continueButton());
    });
    expect(mockOpenBasespacePopup).toHaveBeenCalled();
    return rendered;
  };

  it("uploads the basespace samples once the popup returns an access token", async () => {
    const { props } = await readyForBasespaceAuth();

    await dispatchBasespaceMessage({
      source: mockPopupWindow,
      origin: window.location.origin,
      data: { basespaceAccessToken: "token-123" },
    });

    await waitFor(() => expect(props.onUploadSamples).toHaveBeenCalled());
    const payload = props.onUploadSamples.mock.calls[0][0];
    expect(payload.uploadType).toBe("basespace");
    expect(payload.project).toEqual(PROJECT);
    expect(payload.samples).toHaveLength(1);
    expect(payload.samples[0].basespace_access_token).toBe("token-123");
    expect(payload.samples[0].name).toBe("bs-sample");
  });

  it("ignores a token posted by a window it never opened", async () => {
    const { props } = await readyForBasespaceAuth();

    await dispatchBasespaceMessage({
      source: { name: "some-other-window" },
      origin: window.location.origin,
      data: { basespaceAccessToken: "token-123" },
    });

    expect(props.onUploadSamples).not.toHaveBeenCalled();
  });
});

describe("UploadSampleStep workflow de-selection", () => {
  it("keeps the chosen technology when one of two workflows is removed", async () => {
    await renderStep();

    await chooseWorkflow(
      UPLOAD_WORKFLOWS.MNGS.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );
    await chooseWorkflow(UPLOAD_WORKFLOWS.AMR.value);
    expect(
      screen
        .getByTestId("workflow-selector")
        .dataset.selected?.split(",")
        .sort(),
    ).toEqual([UPLOAD_WORKFLOWS.AMR.value, UPLOAD_WORKFLOWS.MNGS.value].sort());

    // Toggling AMR back off leaves mNGS selected, so Illumina must survive.
    await chooseWorkflow(UPLOAD_WORKFLOWS.AMR.value);

    const selector = screen.getByTestId("workflow-selector");
    expect(selector.dataset.selected).toBe(UPLOAD_WORKFLOWS.MNGS.value);
    expect(selector.dataset.technology).toBe(
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );
  });
});

describe("UploadSampleStep reference sequence and taxon", () => {
  it("keeps no accession for a non-GenBank header and nulls out the Unknown taxon", async () => {
    // A single header line that is not in NCBI GenBank format.
    mockGetReadNames.mockResolvedValue(["not-a-genbank-header"]);

    const { props } = await renderStep();
    await selectProject();
    await chooseWorkflow(
      UPLOAD_WORKFLOWS.VIRAL_CONSENSUS_GENOME.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );
    await act(async () => {
      workflowSelectorProps.onTaxonChange({ ...UNKNOWN_TAXON_OPTION });
    });
    await act(async () => {
      await workflowSelectorProps.onRefSeqFileChanged(
        new File(["ACGT"], "ref_seq.fasta"),
      );
    });
    await addLocalSamples([localSample("alpha")]);

    expect(continueButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(continueButton());
    });

    const payload = props.onUploadSamples.mock.calls[0][0];
    // Header did not match, so no accession was derived from it.
    expect(payload.refSeqAccession).toBeNull();
    // "Unknown" is a UI-only placeholder and must not reach the backend.
    expect(payload.refSeqTaxon).toBeNull();
    expect(payload.refSeqFile.name).toBe("ref_seq.fasta");
  });

  it("ignores a taxon change that repeats the taxon already selected", async () => {
    const { props } = await renderStep();
    await chooseWorkflow(
      UPLOAD_WORKFLOWS.VIRAL_CONSENSUS_GENOME.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );

    await act(async () => {
      workflowSelectorProps.onTaxonChange({ id: 1, name: "Zika" });
    });
    const dirtyCalls = props.onDirty.mock.calls.length;

    // Same value, different object identity: the guard compares deeply.
    await act(async () => {
      workflowSelectorProps.onTaxonChange({ id: 1, name: "Zika" });
    });

    expect(props.onDirty).toHaveBeenCalledTimes(dirtyCalls);
  });
});

describe("UploadSampleStep sequencing format checks", () => {
  it("marks a local file whose format contradicts the chosen technology", async () => {
    await renderStep();
    await selectProject();
    await chooseWorkflow(
      UPLOAD_WORKFLOWS.MNGS.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );
    await addLocalSamples([
      localSample("alpha", {
        format: SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE,
      }),
    ]);

    const row = sampleUploadTableProps.samples[0];
    expect(row.error["alpha.fastq"]).toBe(MISMATCH_FORMAT_ERROR);
    expect(row.isValid["alpha.fastq"]).toBe(false);
  });

  it("accepts a Nanopore file once Nanopore is the chosen technology", async () => {
    await renderStep();
    await selectProject();
    await chooseWorkflow(
      UPLOAD_WORKFLOWS.MNGS.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE,
    );
    await addLocalSamples([
      localSample("alpha", {
        format: SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE,
      }),
    ]);

    const row = sampleUploadTableProps.samples[0];
    expect(row.error["alpha.fastq"]).toBe("");
    expect(row.isValid["alpha.fastq"]).toBe(true);
    // getSequenceTechnology() resolves to Nanopore and is handed to the QC step.
    expect(screen.getByTestId("pre-upload-qc").dataset.technology).toBe(
      SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE,
    );
  });
});

describe("UploadSampleStep merging newly added local samples", () => {
  it("folds a re-added sample into the existing one and leaves the others alone", async () => {
    await renderStep();
    await selectProject();

    await addLocalSamples([localSample("alpha")]);
    // Adding a *different* sample exercises the merge customizer with nothing
    // to merge against.
    await addLocalSamples([localSample("beta")]);
    expect(table().dataset.count).toBe("2");

    // Re-adding "alpha" with a second read must merge, not duplicate.
    await addLocalSamples([
      {
        name: "alpha",
        files: { "alpha_R2.fastq": new File(["ACGT"], "alpha_R2.fastq") },
        input_files_attributes: [
          { source: "alpha_R2.fastq", parts: "alpha_R2.fastq" },
        ],
        finishedValidating: true,
        isValid: true,
      },
    ]);

    expect(table().dataset.count).toBe("2");
    const alphaRow = sampleUploadTableProps.samples.find(
      (sample: $TSFixMe) => sample.name === "alpha",
    );
    expect(alphaRow.file_names_R1).toEqual(["alpha.fastq"]);
    expect(alphaRow.file_names_R2).toEqual(["alpha_R2.fastq"]);
  });

  it("skips file validation entirely when no local samples are added", async () => {
    await renderStep();
    await selectProject();

    await addLocalSamples([]);

    expect(mockValidateSampleFiles).not.toHaveBeenCalled();
    expect(table().dataset.count).toBe("0");
  });
});

describe("UploadSampleStep PreUploadQCCheck de-selection callback", () => {
  it("removes and restores a select id on behalf of the QC step", async () => {
    await renderStep();
    await selectProject();
    await addLocalSamples([localSample("alpha")]);

    const selectId = sampleUploadTableProps.samples[0]._selectId;
    expect(table().dataset.selectedCount).toBe("1");

    await act(async () => {
      preUploadQCProps.handleSampleDeselect(selectId, false, "local");
    });
    expect(table().dataset.selectedCount).toBe("0");

    await act(async () => {
      preUploadQCProps.handleSampleDeselect(selectId, true, "local");
    });
    expect(table().dataset.selectedCount).toBe("1");
    expect(Array.from(sampleUploadTableProps.selectedSampleIds)).toEqual([
      selectId,
    ]);
  });
});

describe("UploadSampleStep remote (S3) tab", () => {
  const renderRemote = async (overrides: $TSFixMe = {}) => {
    const rendered = await renderStep({ admin: true, ...overrides });
    // Tabs for an admin are [Your Computer, S3, Basespace].
    await switchTab(1);
    await selectProject();
    await chooseWorkflow(
      UPLOAD_WORKFLOWS.MNGS.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );
    return rendered;
  };

  it("labels remote files by name when they have one and by source otherwise", async () => {
    await renderRemote();

    await addRemoteSamples([
      {
        name: "alpha",
        input_files_attributes: [
          { name: "alpha_R1.fastq", source: "s3://bucket/alpha_R1.fastq" },
          { source: "s3://bucket/alpha_R2.fastq" },
        ],
      },
    ]);

    const row = sampleUploadTableProps.samples[0];
    expect(row.name).toBe("alpha");
    expect(row.file_names_R1).toEqual(["alpha_R1.fastq"]);
    expect(row.file_names_R2).toEqual(["s3://bucket/alpha_R2.fastq"]);
  });

  it("selects remote samples without running the local validity check", async () => {
    await renderRemote();
    await addRemoteSamples([remoteSample("alpha"), remoteSample("beta")]);

    const ids = sampleUploadTableProps.samples.map(
      (sample: $TSFixMe) => sample._selectId,
    );

    await act(async () => {
      sampleUploadTableProps.onAllSamplesSelect(false);
    });
    expect(table().dataset.selectedCount).toBe("0");

    // Remote samples carry no isValid flag; selection must still go through.
    await act(async () => {
      sampleUploadTableProps.onSampleSelect(ids[0], true);
    });
    expect(Array.from(sampleUploadTableProps.selectedSampleIds)).toEqual([
      ids[0],
    ]);

    await act(async () => {
      sampleUploadTableProps.onAllSamplesSelect(true);
    });
    expect(Array.from(sampleUploadTableProps.selectedSampleIds).sort()).toEqual(
      [...ids].sort(),
    );
  });

  it("hands the remote selection straight to onUploadSamples", async () => {
    const { props } = await renderRemote();
    await addRemoteSamples([remoteSample("alpha")]);

    expect(continueButton().textContent).toBe("Continue");
    expect(continueButton().disabled).toBe(false);
    await act(async () => {
      fireEvent.click(continueButton());
    });

    const payload = props.onUploadSamples.mock.calls[0][0];
    expect(payload.uploadType).toBe("remote");
    expect(payload.samples.map((sample: $TSFixMe) => sample.name)).toEqual([
      "alpha",
    ]);
    // No lane concatenation happens off the local tab.
    expect(payload.samples[0].input_files_attributes[0].source).toBe(
      "s3://bucket/alpha.fastq",
    );
  });

  it("refuses an upload of more than 500 selected samples", async () => {
    await renderRemote();

    await addRemoteSamples(
      Array.from({ length: 501 }, (_unused, i) => remoteSample(`s-${i}`)),
    );

    expect(table().dataset.selectedCount).toBe("501");
    expect(tooltipText()).toBe(
      "SeqtoID supports a max of 500 samples per upload. Remove some samples and try again.",
    );
    expect(continueButton().disabled).toBe(true);
  });
});
