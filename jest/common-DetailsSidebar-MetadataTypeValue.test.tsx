// Coverage: app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/
//           components/MetadataTab/components/MetadataTypeValue/MetadataTypeValue.tsx
//
// MetadataTypeValue looks a metadata value up by its type key and, for human
// host genomes only, pushes string values through the HIPAA compliance filter
// before handing them to MetadataValue. The tests drive both sides of the
// human/non-human check, the null-additionalInfo optional chain, and the
// string/non-string guard (a location object must bypass the filter).
import { render } from "@testing-library/react";

// jest.config maps the webpack "~/" alias before its blanket scss -> styleMock
// rule, so this transitively-imported scss has to be stubbed explicitly.
jest.mock(
  "~/components/common/DetailsSidebar/SampleDetailsMode/sample_details_mode.scss",
  () => ({}),
  { virtual: true },
);

import { MetadataTypeValue } from "~/components/common/DetailsSidebar/SampleDetailsMode/components/MetadataTab/components/MetadataTypeValue/MetadataTypeValue";

const ageType = { key: "host_age", name: "Host Age" } as $TSFixMe;
const sampleType = { key: "sample_type", name: "Sample Type" } as $TSFixMe;
const locationType = {
  key: "collection_location_v2",
  name: "Collection Location",
} as $TSFixMe;

const renderValue = (props: Record<string, unknown>) =>
  render(<MetadataTypeValue {...(props as $TSFixMe)} />);

describe("MetadataTypeValue HIPAA handling", () => {
  it("caps an over-max host age for human host genomes", () => {
    const { container } = renderValue({
      additionalInfo: { host_genome_taxa_category: "human" },
      metadata: { host_age: "97" },
      metadataType: ageType,
    });
    // 97 is at/above the HIPAA max, so it is bucketed rather than shown.
    expect(container.textContent).not.toBe("97");
    expect(container.textContent).toContain("≥");
  });

  it("leaves an under-max host age untouched for human host genomes", () => {
    const { container } = renderValue({
      additionalInfo: { host_genome_taxa_category: "human" },
      metadata: { host_age: "34" },
      metadataType: ageType,
    });
    expect(container.textContent).toBe("34");
  });

  it("does not apply the HIPAA filter for a non-human host genome", () => {
    const { container } = renderValue({
      additionalInfo: { host_genome_taxa_category: "non-human" },
      metadata: { host_age: "97" },
      metadataType: ageType,
    });
    expect(container.textContent).toBe("97");
  });

  it("does not apply the HIPAA filter when additionalInfo is null", () => {
    const { container } = renderValue({
      additionalInfo: null,
      metadata: { host_age: "97" },
      metadataType: ageType,
    });
    expect(container.textContent).toBe("97");
  });

  it("leaves non-age fields alone even for human host genomes", () => {
    const { container } = renderValue({
      additionalInfo: { host_genome_taxa_category: "human" },
      metadata: { sample_type: "Nasopharyngeal Swab" },
      metadataType: sampleType,
    });
    expect(container.textContent).toBe("Nasopharyngeal Swab");
  });
});

describe("MetadataTypeValue non-string and missing values", () => {
  it("passes an object value straight through without HIPAA processing", () => {
    const { container } = renderValue({
      additionalInfo: { host_genome_taxa_category: "human" },
      metadata: { collection_location_v2: { name: "Redwood City, USA" } },
      metadataType: locationType,
    });
    expect(container.textContent).toBe("Redwood City, USA");
  });

  it("renders the placeholder when the metadata key is absent", () => {
    const { container } = renderValue({
      additionalInfo: { host_genome_taxa_category: "human" },
      metadata: {},
      metadataType: sampleType,
    });
    expect(container.textContent).toBe("--");
  });
});
