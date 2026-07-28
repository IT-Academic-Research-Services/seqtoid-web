// Coverage for
// app/assets/src/components/views/DiscoveryView/components/SamplesView/components/MetadataUploadModal/ReviewPage.tsx
//
// ReviewPage renders a DataTable of the uploaded metadata rows, but first
// clones them and, for human hosts, redacts an out-of-range "Host Age" into a
// HIPAA-safe form. The DataTable is stubbed so the assertions land on the
// clone/redaction logic and the early null-render guard. The real HIPAA helper
// (returnHipaaCompliantMetadata) runs unmocked so the >= 90 branch is exercised
// end to end.
import { render } from "@testing-library/react";
import React from "react";

const _React: typeof React = React;

let capturedProps: $TSFixMe = null;

jest.mock("~/components/visualizations/table/DataTable", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    capturedProps = props;
    return <div data-testid="data-table" />;
  },
}));

import ReviewPage from "~/components/views/DiscoveryView/components/SamplesView/components/MetadataUploadModal/ReviewPage";

beforeEach(() => {
  capturedProps = null;
});

describe("ReviewPage null guard", () => {
  it("renders nothing when metadata is undefined", () => {
    const { container } = render(<ReviewPage samples={[] as $TSFixMe} />);
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing when samples is undefined", () => {
    const { container } = render(
      <ReviewPage metadata={{ rows: [], headers: [] }} />,
    );
    expect(container.firstChild).toBeNull();
  });
});

describe("ReviewPage table wiring", () => {
  it("passes the headers, column width and rows through to DataTable", () => {
    render(
      <ReviewPage
        metadata={{
          headers: ["Sample Name", "Host Organism"],
          rows: [{ sample_name: "s1", "Host Organism": "Mosquito" }],
        }}
        samples={[] as $TSFixMe}
      />,
    );
    expect(capturedProps.columns).toEqual(["Sample Name", "Host Organism"]);
    expect(capturedProps.columnWidth).toBe(120);
    expect(capturedProps.data).toHaveLength(1);
  });

  it("does not mutate the original metadata rows (clones before redacting)", () => {
    const original = {
      headers: ["Sample Name", "Host Organism", "Host Age"],
      rows: [
        { sample_name: "s1", "Host Organism": "Human", "Host Age": "150" },
      ],
    };
    render(<ReviewPage metadata={original} samples={[] as $TSFixMe} />);
    // The source row is left intact; only the rendered clone is redacted.
    expect(original.rows[0]["Host Age"]).toBe("150");
    expect(capturedProps.data[0]["Host Age"]).not.toBe("150");
  });
});

describe("ReviewPage HIPAA redaction", () => {
  it("redacts an out-of-range Host Age for human hosts", () => {
    render(
      <ReviewPage
        metadata={{
          headers: ["Sample Name", "host_genome", "Host Age"],
          rows: [{ sample_name: "s1", host_genome: "Human", "Host Age": "95" }],
        }}
        samples={[] as $TSFixMe}
      />,
    );
    expect(capturedProps.data[0]["Host Age"]).toBe("≥ 90");
  });

  it("leaves an in-range human Host Age untouched", () => {
    render(
      <ReviewPage
        metadata={{
          headers: ["Sample Name", "Host Organism", "Host Age"],
          rows: [
            { sample_name: "s1", "Host Organism": "Human", "Host Age": "40" },
          ],
        }}
        samples={[] as $TSFixMe}
      />,
    );
    expect(capturedProps.data[0]["Host Age"]).toBe("40");
  });

  it("does not redact Host Age for a non-human host", () => {
    render(
      <ReviewPage
        metadata={{
          headers: ["Sample Name", "Host Organism", "Host Age"],
          rows: [
            {
              sample_name: "s1",
              "Host Organism": "Mosquito",
              "Host Age": "99",
            },
          ],
        }}
        samples={[] as $TSFixMe}
      />,
    );
    expect(capturedProps.data[0]["Host Age"]).toBe("99");
  });

  it("ignores the Host Age branch entirely when the column is absent", () => {
    render(
      <ReviewPage
        metadata={{
          headers: ["Sample Name", "Host Organism"],
          rows: [{ sample_name: "s1", "Host Organism": "Human" }],
        }}
        samples={[] as $TSFixMe}
      />,
    );
    expect("Host Age" in capturedProps.data[0]).toBe(false);
  });
});
