// Coverage:
// app/assets/src/components/views/SampleUploadFlow/components/UploadSampleStep/
//   UploadSampleStep.tsx
//
// UploadSampleStep is step 1 of the upload wizard: pick a project, pick an
// analysis type + sequencing technology, pick files from one of three sources,
// then Continue. Almost all of its logic is gate-keeping:
//   * which upload tabs exist (S3 needs admin/biohub) and which are disabled,
//   * which workflows stay selectable once one is chosen on a technology
//     (updateAllowedWorkflows / getPermittedSelectedWorkflows),
//   * the long ladder in handleContinueButtonTooltip explaining exactly what is
//     still missing, mirrored by isValid() enabling the Continue button,
//   * de-duping / filtering newly added samples before they reach the table.
//
// Every child is stubbed and its props captured, so the tests drive the
// component through the same callbacks the real children would fire and assert
// on what it computes. Aioli (biowasm) and the three ~/api calls are mocked, so
// nothing here loads a wasm module or hits the network.

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

// parseRefSeqHeader reads the FASTA header through the biowasm CLI; only that
// one helper is replaced so reference-sequence handling stays drivable.
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

const mockOpenBasespacePopup = jest.fn(() => ({ name: "popup" }));
// The lane-grouping helpers are real (the table rendering depends on the shape
// they produce); only the OAuth popup, which would open a window, is replaced.
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
    return (
      <div data-testid="project-select" data-erred={String(props.erred)} />
    );
  },
}));

let projectCreationProps: $TSFixMe = null;
jest.mock("~/components/common/ProjectCreationModal", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    projectCreationProps = props;
    return <div data-testid="project-creation-modal" />;
  },
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
          data-enabled={props.enabledWorkflows.join(",")}
          data-selected={Array.from(props.selectedWorkflows).join(",")}
          data-technology={props.selectedTechnology}
          data-has-refseq-error={String(props.hasRefSeqFileNameError)}
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
          data-names={props.samples.map((s: $TSFixMe) => s.name).join(",")}
          data-selected={Array.from(props.selectedSampleIds).join(",")}
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

jest.mock(
  "~/components/views/SampleUploadFlow/components/UploadSampleStep/components/PreUploadQCCheck",
  () => ({
    __esModule: true,
    PreUploadQCCheck: () => <div data-testid="pre-upload-qc" />,
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
    <div data-testid="continue-popup" data-disabled={String(props.disabled)}>
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
  default: (props: $TSFixMe) => (
    <button onClick={props.onClick}>{props.text}</button>
  ),
}));
jest.mock("~/components/ui/controls/ExternalLink", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <a href={props.href}>{props.children}</a>,
}));

let tabsProps: $TSFixMe = null;
jest.mock("@czi-sds/components", () => ({
  __esModule: true,
  Callout: (props: $TSFixMe) => <div>{props.children}</div>,
  Tooltip: (props: $TSFixMe) => (
    <span data-testid="tab-tooltip" data-title={props.title}>
      {props.children}
    </span>
  ),
  Tabs: (props: $TSFixMe) => {
    tabsProps = props;
    return (
      <div data-testid="upload-tabs" data-value={String(props.value)}>
        {props.children}
      </div>
    );
  },
  Tab: (props: $TSFixMe) => (
    <div
      data-testid={`tab-${props["data-testid"]}`}
      data-disabled={String(!!props.disabled)}
    >
      {props.label}
    </div>
  ),
}));

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { UploadSampleStep } from "~/components/views/SampleUploadFlow/components/UploadSampleStep/UploadSampleStep";
import {
  SEQUENCING_TECHNOLOGY_OPTIONS,
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
  // componentDidMount awaits getProjects + Aioli before the first settled render.
  await waitFor(() => expect(mockGetProjects).toHaveBeenCalled());
  await act(async () => undefined);
  return { ...utils, props };
};

const tooltipText = () =>
  screen.getByTestId("upload-continue-tooltip").textContent;
const continueButton = () =>
  screen.getByTestId("continue-button") as HTMLButtonElement;

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

const chooseTechnology = async (workflow: $TSFixMe, technology: $TSFixMe) => {
  await act(async () => {
    workflowSelectorProps.onTechnologyToggle(workflow, technology);
  });
};

const addLocalSamples = async (samples: $TSFixMe[]) => {
  await act(async () => {
    await localUploadProps.onChange(samples);
  });
};

const localSample = (name: string, fileName = `${name}.fastq`) => ({
  name,
  files: { [fileName]: new File(["ACGT"], fileName) },
  input_files_attributes: [{ source: fileName, parts: fileName }],
  finishedValidating: true,
  isValid: true,
});

beforeEach(() => {
  jest.clearAllMocks();
  projectSelectProps = null;
  projectCreationProps = null;
  workflowSelectorProps = null;
  sampleUploadTableProps = null;
  localUploadProps = null;
  remoteUploadProps = null;
  basespaceProps = null;
  tabsProps = null;
  mockGetProjects.mockResolvedValue({ projects: [PROJECT] });
  // By default the API hands names back unchanged and calls every file valid.
  mockValidateSampleNames.mockImplementation(async (_id, names) => names);
  mockValidateSampleFiles.mockImplementation(async (names: string[]) =>
    names.map(() => true),
  );
  // No parseable NCBI GenBank header by default.
  mockGetReadNames.mockResolvedValue(null);
});

describe("UploadSampleStep project selection", () => {
  it("loads the updatable projects into the project select on mount", async () => {
    await renderStep();

    expect(mockGetProjects).toHaveBeenCalledWith({
      domain: "updatable",
      basic: true,
    });
    expect(projectSelectProps.projects).toEqual([PROJECT]);
    expect(projectSelectProps.value).toBeUndefined();
    expect(screen.getByTestId("project-select").dataset.erred).toBe("false");
  });

  it("opens and closes the project creation modal", async () => {
    await renderStep();

    expect(screen.queryByTestId("project-creation-modal")).toBeNull();
    fireEvent.click(screen.getByTestId("create-project"));
    expect(screen.getByTestId("project-creation-modal")).toBeTruthy();
    // The select is disabled while the creation modal is up.
    expect(projectSelectProps.disabled).toBe(true);

    await act(async () => {
      projectCreationProps.onCancel();
    });
    expect(screen.queryByTestId("project-creation-modal")).toBeNull();
  });

  it("fetches the pipeline versions for a newly selected project", async () => {
    const { props } = await renderStep();

    await selectProject();

    expect(props.onDirty).toHaveBeenCalled();
    expect(props.getPipelineVersionsForExistingProject).toHaveBeenCalledWith(9);
    expect(projectSelectProps.value).toBe(9);
  });

  it("flags the project select as erred when a remote upload has no project", async () => {
    await renderStep({ admin: true });

    await act(async () => {
      tabsProps.onChange(null, 1);
    });
    await act(async () => {
      remoteUploadProps.onNoProject();
    });

    expect(screen.getByTestId("project-select").dataset.erred).toBe("true");
  });
});

describe("UploadSampleStep upload tabs", () => {
  it("hides the S3 tab from non-admins without the biohub flag", async () => {
    await renderStep();

    expect(screen.queryByTestId("tab-s-3")).toBeNull();
    expect(screen.getByTestId("tab-your-computer")).toBeTruthy();
    expect(screen.getByTestId("tab-basespace")).toBeTruthy();
    expect(screen.getByTestId("local-upload")).toBeTruthy();
  });

  it("shows the S3 tab to admins and switches its content", async () => {
    const { props } = await renderStep({ admin: true });

    expect(screen.getByTestId("tab-s-3")).toBeTruthy();

    await act(async () => {
      tabsProps.onChange(null, 1);
    });

    expect(props.onDirty).toHaveBeenCalled();
    expect(screen.getByTestId("remote-upload")).toBeTruthy();
    expect(screen.queryByTestId("local-upload")).toBeNull();
    expect(screen.getByTestId("upload-tabs").dataset.value).toBe("1");
  });

  it("shows the S3 tab when biohub S3 upload is enabled", async () => {
    await renderStep({ biohubS3UploadEnabled: true });

    expect(screen.getByTestId("tab-s-3")).toBeTruthy();
  });

  it("disables and explains the Nanopore-incompatible tabs", async () => {
    await renderStep({ admin: true });

    await chooseWorkflow(UPLOAD_WORKFLOWS.MNGS.value);
    await chooseTechnology(
      UPLOAD_WORKFLOWS.MNGS.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE,
    );

    expect(screen.getByTestId("tab-s-3").dataset.disabled).toBe("true");
    expect(screen.getByTestId("tab-basespace").dataset.disabled).toBe("true");
    // Disabled tabs are wrapped in an explanatory tooltip.
    expect(screen.getAllByTestId("tab-tooltip").length).toBe(2);
  });

  it("switches to the basespace importer and authorizes from there", async () => {
    const { props } = await renderStep();

    await act(async () => {
      tabsProps.onChange(null, 1);
    });
    expect(screen.getByTestId("basespace-import")).toBeTruthy();
    expect(basespaceProps.basespaceClientId).toBe("client");

    await selectProject();
    await chooseWorkflow(UPLOAD_WORKFLOWS.MNGS.value);
    await chooseTechnology(
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

    expect(continueButton().textContent).toBe("Authorize");
    await act(async () => {
      fireEvent.click(continueButton());
    });

    // The basespace tab routes Continue to the OAuth popup, asking for read
    // access to each distinct source project, instead of uploading directly.
    expect(mockOpenBasespacePopup).toHaveBeenCalledWith({
      client_id: "client",
      redirect_uri: "https://redirect",
      scope: "browse+global,read+project+3",
    });
    expect(props.onUploadSamples).not.toHaveBeenCalled();
  });
});

describe("UploadSampleStep workflow and technology gating", () => {
  it("starts with every workflow enabled and none selected", async () => {
    await renderStep();

    const selector = screen.getByTestId("workflow-selector");
    expect(selector.dataset.selected).toBe("");
    expect(selector.dataset.enabled?.split(",").sort()).toEqual(
      [
        UPLOAD_WORKFLOWS.MNGS.value,
        UPLOAD_WORKFLOWS.AMR.value,
        UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
        UPLOAD_WORKFLOWS.VIRAL_CONSENSUS_GENOME.value,
      ].sort(),
    );
  });

  it("narrows the enabled workflows once Illumina mNGS is chosen", async () => {
    await renderStep();

    await chooseWorkflow(UPLOAD_WORKFLOWS.MNGS.value);
    await chooseTechnology(
      UPLOAD_WORKFLOWS.MNGS.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );

    const selector = screen.getByTestId("workflow-selector");
    expect(selector.dataset.technology).toBe(
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );
    expect(selector.dataset.selected).toContain(UPLOAD_WORKFLOWS.MNGS.value);
    // Illumina mNGS can be combined with AMR and viral CG, but not covid CG.
    expect(selector.dataset.enabled).not.toContain(
      UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
    );
    expect(mockTrackEvent).toHaveBeenCalledWith(
      `UploadSampleStep_${UPLOAD_WORKFLOWS.MNGS.value}-workflow_selected`,
    );
  });

  it("deselects a workflow and restores the full enabled list", async () => {
    await renderStep();

    await chooseWorkflow(UPLOAD_WORKFLOWS.MNGS.value);
    expect(screen.getByTestId("workflow-selector").dataset.selected).toBe(
      UPLOAD_WORKFLOWS.MNGS.value,
    );

    await chooseWorkflow(UPLOAD_WORKFLOWS.MNGS.value);
    const selector = screen.getByTestId("workflow-selector");
    expect(selector.dataset.selected).toBe("");
    expect(selector.dataset.enabled).toContain(
      UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
    );
  });

  it("drops an incompatible earlier choice when covid CG is selected", async () => {
    await renderStep();

    await chooseWorkflow(UPLOAD_WORKFLOWS.MNGS.value);
    await chooseTechnology(
      UPLOAD_WORKFLOWS.MNGS.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );
    await chooseWorkflow(
      UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );

    const selected =
      screen.getByTestId("workflow-selector").dataset.selected ?? "";
    expect(selected).toContain(UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value);
    expect(selected).not.toContain(UPLOAD_WORKFLOWS.MNGS.value);
  });

  it("forces the clear-labs defaults when Nanopore covid CG is used with Clear Labs", async () => {
    await renderStep();

    await chooseWorkflow(UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value);
    await act(async () => {
      workflowSelectorProps.onClearLabsChange(true);
    });
    expect(workflowSelectorProps.selectedWetlabProtocol).toBeTruthy();

    await chooseTechnology(
      UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE,
    );
    // The default wetlab + medaka options survive the technology switch.
    expect(workflowSelectorProps.selectedWetlabProtocol).toBeTruthy();
    expect(workflowSelectorProps.selectedMedakaModel).toBeTruthy();

    await act(async () => {
      workflowSelectorProps.onClearLabsChange(false);
    });
    expect(workflowSelectorProps.usedClearLabs).toBe(false);
  });

  it("clears the wetlab protocol when covid CG switches to Illumina without Clear Labs", async () => {
    await renderStep();

    await chooseWorkflow(UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value);
    await act(async () => {
      workflowSelectorProps.onWetlabProtocolChange("artic");
    });
    expect(workflowSelectorProps.selectedWetlabProtocol).toBe("artic");

    await chooseTechnology(
      UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );
    expect(workflowSelectorProps.selectedWetlabProtocol).toBeNull();
  });
});

describe("UploadSampleStep continue gating", () => {
  it("asks for a project first", async () => {
    await renderStep();

    expect(tooltipText()).toBe("Please select a project to continue");
    expect(continueButton().disabled).toBe(true);
  });

  it("asks for an analysis type once a project is chosen", async () => {
    await renderStep();
    await selectProject();

    expect(tooltipText()).toBe("Please select an analysis type to continue");
  });

  it("asks for a basecaller for Nanopore mNGS", async () => {
    await renderStep();
    await selectProject();
    await chooseWorkflow(UPLOAD_WORKFLOWS.MNGS.value);
    await chooseTechnology(
      UPLOAD_WORKFLOWS.MNGS.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.NANOPORE,
    );

    expect(tooltipText()).toBe("Please select a basecaller to continue");

    await act(async () => {
      workflowSelectorProps.onGuppyBasecallerSettingChange("fast");
    });
    expect(tooltipText()).toBe("Please select a sample to continue");
  });

  it("asks for a wetlab protocol for covid CG", async () => {
    await renderStep();
    await selectProject();
    await chooseWorkflow(
      UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );

    expect(tooltipText()).toBe("Please select a wetlab protocol to continue");
  });

  it("walks the viral CG taxon / reference-sequence ladder", async () => {
    await renderStep();
    await selectProject();
    await chooseWorkflow(
      UPLOAD_WORKFLOWS.VIRAL_CONSENSUS_GENOME.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );

    expect(tooltipText()).toBe("Please select a taxon to continue");

    await act(async () => {
      workflowSelectorProps.onTaxonChange({ id: 1, name: "Zika" });
    });
    expect(tooltipText()).toBe(
      "Please upload a reference sequence to continue",
    );

    // A reference sequence with an unacceptable name is reported as such.
    await act(async () => {
      await workflowSelectorProps.onRefSeqFileChanged(
        new File(["ACGT"], "bad name!.txt"),
      );
    });
    expect(screen.getByTestId("workflow-selector").dataset.hasRefseqError).toBe(
      "true",
    );
    expect(tooltipText()).not.toBe(
      "Please upload a reference sequence to continue",
    );

    // A well-named one clears that complaint and moves on to sample selection.
    mockGetReadNames.mockResolvedValue([">NC_045512.2 Severe acute virus"]);
    await act(async () => {
      await workflowSelectorProps.onRefSeqFileChanged(
        new File(["ACGT"], "ref_seq.fasta"),
      );
    });
    expect(screen.getByTestId("workflow-selector").dataset.hasRefseqError).toBe(
      "false",
    );
    expect(tooltipText()).toBe("Please select a sample to continue");

    // Clearing the file puts the reference-sequence complaint back.
    await act(async () => {
      await workflowSelectorProps.onRefSeqFileChanged(undefined);
    });
    expect(tooltipText()).toBe(
      "Please upload a reference sequence to continue",
    );
  });

  it("rejects a bed file whose name breaks the allowed pattern", async () => {
    await renderStep();
    await selectProject();
    await chooseWorkflow(
      UPLOAD_WORKFLOWS.COVID_CONSENSUS_GENOME.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );
    await act(async () => {
      workflowSelectorProps.onWetlabProtocolChange("artic");
    });
    expect(tooltipText()).toBe("Please select a sample to continue");

    await act(async () => {
      workflowSelectorProps.onBedFileChanged(new File([""], "not ok!.txt"));
    });
    expect(tooltipText()).toContain("Bed file name can only contain");

    await act(async () => {
      workflowSelectorProps.onBedFileChanged(new File([""], "primers.bed"));
    });
    expect(tooltipText()).toBe("Please select a sample to continue");
  });
});

describe("UploadSampleStep sample handling", () => {
  it("validates added local samples and lists them in the table", async () => {
    await renderStep();
    await selectProject();
    await addLocalSamples([localSample("alpha"), localSample("beta")]);

    expect(mockValidateSampleFiles).toHaveBeenCalledWith([
      "alpha.fastq",
      "beta.fastq",
    ]);
    expect(screen.getByTestId("sample-upload-table").dataset.names).toBe(
      "alpha,beta",
    );
    // Newly added samples start out selected.
    expect(screen.getByTestId("sample-upload-table").dataset.selected).not.toBe(
      "",
    );
  });

  it("drops files the backend rejects and warns about them", async () => {
    mockValidateSampleFiles.mockImplementation(async (names: string[]) =>
      names.map(name => name !== "beta.fastq"),
    );

    await renderStep();
    await selectProject();
    await addLocalSamples([localSample("alpha"), localSample("beta")]);

    // beta lost its only file, so the sample itself is dropped.
    expect(screen.getByTestId("sample-upload-table").dataset.names).toBe(
      "alpha",
    );
    expect(screen.getByTestId("issue-group").textContent).toContain(
      "1 files were invalid",
    );
  });

  it("renames samples that collide with existing ones in the project", async () => {
    mockValidateSampleNames.mockImplementation(async (_id, names: string[]) =>
      names.map(name => `${name}_1`),
    );

    await renderStep();
    await selectProject();
    await addLocalSamples([localSample("alpha")]);

    expect(screen.getByTestId("sample-upload-table").dataset.names).toBe(
      "alpha_1",
    );
  });

  it("ignores selection of an invalid sample but honours a valid one", async () => {
    await renderStep();
    await selectProject();
    await addLocalSamples([
      localSample("alpha"),
      { ...localSample("beta"), isValid: false },
    ]);

    const ids = sampleUploadTableProps.samples.map(
      (sample: $TSFixMe) => sample._selectId,
    );
    // Deselect everything, then try to re-select each sample in turn.
    await act(async () => {
      sampleUploadTableProps.onAllSamplesSelect(false);
    });
    expect(screen.getByTestId("sample-upload-table").dataset.selected).toBe("");

    await act(async () => {
      sampleUploadTableProps.onSampleSelect(ids[1], true);
    });
    expect(screen.getByTestId("sample-upload-table").dataset.selected).toBe("");

    await act(async () => {
      sampleUploadTableProps.onSampleSelect(ids[0], true);
    });
    expect(screen.getByTestId("sample-upload-table").dataset.selected).toBe(
      ids[0],
    );

    await act(async () => {
      sampleUploadTableProps.onSampleSelect(ids[0], false);
    });
    expect(screen.getByTestId("sample-upload-table").dataset.selected).toBe("");
  });

  it("removes samples from the table", async () => {
    await renderStep();
    await selectProject();
    await addLocalSamples([localSample("alpha"), localSample("beta")]);

    const ids = sampleUploadTableProps.samples.map(
      (sample: $TSFixMe) => sample._selectId,
    );
    await act(async () => {
      sampleUploadTableProps.onSamplesRemove([ids[0]]);
    });

    expect(screen.getByTestId("sample-upload-table").dataset.names).toBe(
      "beta",
    );
  });

  it("enables Continue and hands the whole selection upstream", async () => {
    const { props } = await renderStep();
    await selectProject();
    await chooseWorkflow(UPLOAD_WORKFLOWS.MNGS.value);
    await chooseTechnology(
      UPLOAD_WORKFLOWS.MNGS.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );
    await addLocalSamples([localSample("alpha")]);

    expect(tooltipText()).toBeFalsy();
    expect(continueButton().disabled).toBe(false);
    expect(screen.getByTestId("continue-popup").dataset.disabled).toBe("true");

    await act(async () => {
      fireEvent.click(continueButton());
    });

    expect(props.onUploadSamples).toHaveBeenCalledWith(
      expect.objectContaining({
        project: PROJECT,
        uploadType: "local",
        technology: SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
      }),
    );
    const payload = props.onUploadSamples.mock.calls[0][0];
    expect(payload.samples.map((s: $TSFixMe) => s.name)).toEqual(["alpha"]);
    expect(Array.from(payload.workflows)).toEqual([
      UPLOAD_WORKFLOWS.MNGS.value,
    ]);
  });

  it("waits for file validation before allowing Continue", async () => {
    await renderStep();
    await selectProject();
    await chooseWorkflow(UPLOAD_WORKFLOWS.MNGS.value);
    await chooseTechnology(
      UPLOAD_WORKFLOWS.MNGS.value,
      SEQUENCING_TECHNOLOGY_OPTIONS.ILLUMINA,
    );
    await addLocalSamples([
      { ...localSample("alpha"), finishedValidating: false },
    ]);

    expect(tooltipText()).toBe("Please wait for file validation to complete");
    expect(continueButton().disabled).toBe(true);
  });
});
