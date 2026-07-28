// Coverage: app/assets/src/components/common/Metadata/MetadataCSVUpload.tsx
//
// MetadataCSVUpload wraps a CSVUpload control and validates the uploaded CSV
// against the server. Its branches: whether the samples are new (validate for
// new samples and remember the sample names + project id) or existing (validate
// for the project); calling onDirty when supplied; and componentDidUpdate
// re-validating when the panel becomes visible again and the samples or project
// changed. The CSVUpload child and the two validation API calls are stubbed so
// the onMetadataChange contract (the validating pulse, then the processed
// result) can be asserted directly.
import { render } from "@testing-library/react";
import React from "react";
import MetadataCSVUpload from "~/components/common/Metadata/MetadataCSVUpload";

const _React: typeof React = React;

jest.mock("~/api/metadata", () => ({
  validateMetadataCSVForNewSamples: jest.fn(),
  validateMetadataCSVForProject: jest.fn(),
}));

jest.mock("~/components/common/Metadata/utils", () => ({
  processCSVMetadata: jest.fn((csv: $TSFixMe) => ({ processed: csv })),
}));

let mockOnCSV: ((csv: $TSFixMe) => void) | null = null;

jest.mock("~ui/controls/CSVUpload", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) => {
      mockOnCSV = props.onCSV;
      return ReactLib.createElement("div", {
        "data-testid": "csv-upload",
        "data-title": props.title,
        className: props.className,
      });
    },
  };
});

import {
  validateMetadataCSVForNewSamples,
  validateMetadataCSVForProject,
} from "~/api/metadata";
import { processCSVMetadata } from "~/components/common/Metadata/utils";

const mockedNewSamples =
  validateMetadataCSVForNewSamples as unknown as jest.Mock;
const mockedProject = validateMetadataCSVForProject as unknown as jest.Mock;
const mockedProcess = processCSVMetadata as unknown as jest.Mock;

const CSV = { headers: ["Sample Name"], rows: [["s1"]] };
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe("MetadataCSVUpload", () => {
  beforeEach(() => {
    mockOnCSV = null;
    mockedNewSamples.mockReset();
    mockedProject.mockReset();
    mockedProcess.mockClear();
    mockedNewSamples.mockResolvedValue({
      issues: { errors: ["err"], warnings: [] },
      newHostGenomes: [{ id: 1 }],
    });
    mockedProject.mockResolvedValue({
      issues: { errors: [], warnings: ["warn"] },
    });
  });

  it("shows the upload prompt title before any metadata is present", () => {
    const { getByTestId } = render(
      <MetadataCSVUpload
        samples={[{ name: "s1" }] as $TSFixMe}
        project={{ id: 42 } as $TSFixMe}
        onMetadataChange={jest.fn()}
        samplesAreNew
        visible
      />,
    );
    expect(getByTestId("csv-upload").getAttribute("data-title")).toBe(
      "Upload your metadata CSV",
    );
  });

  it("validates for new samples and reports the validating pulse then result", async () => {
    const onMetadataChange = jest.fn();
    const onDirty = jest.fn();
    render(
      <MetadataCSVUpload
        samples={[{ name: "s1" }] as $TSFixMe}
        project={{ id: 42 } as $TSFixMe}
        onMetadataChange={onMetadataChange}
        onDirty={onDirty}
        samplesAreNew
        visible
      />,
    );

    await React.act(async () => {
      mockOnCSV!(CSV);
      await flush();
    });

    expect(onDirty).toHaveBeenCalled();
    // First call: the "validating" pulse with cleared issues.
    expect(onMetadataChange.mock.calls[0][0]).toEqual({
      metadata: null,
      issues: { errors: [], warnings: [] },
      validatingCSV: true,
    });
    expect(mockedNewSamples).toHaveBeenCalledWith([{ name: "s1" }], CSV);
    // Final call: the processed result with the server issues + host genomes.
    const finalArg = onMetadataChange.mock.calls[1][0];
    expect(finalArg.validatingCSV).toBe(false);
    expect(finalArg.issues).toEqual({ errors: ["err"], warnings: [] });
    expect(finalArg.newHostGenomes).toEqual([{ id: 1 }]);
    expect(mockedProcess).toHaveBeenCalledWith(CSV);
  });

  it("validates against the project for existing samples", async () => {
    const onMetadataChange = jest.fn();
    render(
      <MetadataCSVUpload
        samples={[{ name: "s1" }] as $TSFixMe}
        project={{ id: 99 } as $TSFixMe}
        onMetadataChange={onMetadataChange}
        samplesAreNew={false}
        visible
      />,
    );

    await React.act(async () => {
      mockOnCSV!(CSV);
      await flush();
    });

    expect(mockedProject).toHaveBeenCalledWith(99, CSV);
    expect(mockedNewSamples).not.toHaveBeenCalled();
    const finalArg = onMetadataChange.mock.calls[1][0];
    expect(finalArg.issues).toEqual({ errors: [], warnings: ["warn"] });
  });

  it("does not throw when no onDirty handler is supplied", async () => {
    render(
      <MetadataCSVUpload
        samples={[{ name: "s1" }] as $TSFixMe}
        project={{ id: 1 } as $TSFixMe}
        onMetadataChange={jest.fn()}
        samplesAreNew
        visible
      />,
    );
    await React.act(async () => {
      expect(() => mockOnCSV!(CSV)).not.toThrow();
      await flush();
    });
  });

  it("re-validates when it becomes visible again after the samples change", async () => {
    const onMetadataChange = jest.fn();
    const { rerender } = render(
      <MetadataCSVUpload
        samples={[{ name: "s1" }] as $TSFixMe}
        project={{ id: 1 } as $TSFixMe}
        onMetadataChange={onMetadataChange}
        samplesAreNew
        visible={false}
      />,
    );

    // Load the CSV while hidden -> establishes state.metadata + lastSampleNames.
    await React.act(async () => {
      mockOnCSV!(CSV);
      await flush();
    });
    mockedNewSamples.mockClear();

    // Become visible again with a different sample set -> re-validate.
    await React.act(async () => {
      rerender(
        <MetadataCSVUpload
          samples={[{ name: "s2" }] as $TSFixMe}
          project={{ id: 1 } as $TSFixMe}
          onMetadataChange={onMetadataChange}
          samplesAreNew
          visible
        />,
      );
      await flush();
    });

    expect(mockedNewSamples).toHaveBeenCalledWith([{ name: "s2" }], CSV);
  });

  it("does not re-validate on visibility change when nothing changed", async () => {
    const onMetadataChange = jest.fn();
    const props = {
      samples: [{ name: "s1" }] as $TSFixMe,
      project: { id: 1 } as $TSFixMe,
      onMetadataChange,
      samplesAreNew: true,
    };
    const { rerender } = render(
      <MetadataCSVUpload {...props} visible={false} />,
    );

    await React.act(async () => {
      mockOnCSV!(CSV);
      await flush();
    });
    mockedNewSamples.mockClear();

    await React.act(async () => {
      // Same samples + project -> no re-validation.
      rerender(<MetadataCSVUpload {...props} visible />);
      await flush();
    });

    expect(mockedNewSamples).not.toHaveBeenCalled();
  });
});
