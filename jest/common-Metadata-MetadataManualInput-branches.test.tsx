// Coverage: app/assets/src/components/common/Metadata/MetadataManualInput.tsx
//
// Companion to common-Metadata-MetadataManualInput.test.tsx. That spec covers
// the mainline grid/edit/apply-to-all behaviour; this one drives the arms it
// never reaches:
//   * applyToAll()'s location special-case (dataType === "location"), for both
//     a human host (city stripped for privacy) and a non-human host,
//   * the "collection_location_*" extra-width class on the input,
//   * updateHostGenome()'s id-to-name conversion when the search box hands
//     back a bare host genome id rather than a result object,
//   * the hostGenomes fallback when the prop is missing,
//   * componentDidUpdate()'s "water control default already re-synced" arm.
import { fireEvent, render, screen } from "@testing-library/react";

const LOCATION = {
  name: "Los Angeles, California, USA",
  geo_level: "city",
  city_name: "Los Angeles",
  subdivision_name: "Los Angeles",
  state_name: "California",
  country_name: "USA",
};

jest.mock("~/components/common/Metadata/MetadataInput", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ metadataType, value, onChange, className }: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        null,
        ReactLib.createElement("input", {
          "data-testid": `metadata-input-${metadataType.key}`,
          "data-classname": String(className),
          value:
            value === undefined || value === null
              ? ""
              : typeof value === "object"
              ? (value as $TSFixMe).name
              : String(value),
          onChange: (e: $TSFixMe) => onChange(metadataType.key, e.target.value),
        }),
        ReactLib.createElement(
          "button",
          {
            "data-testid": `pick-location-${metadataType.key}`,
            onClick: () => onChange(metadataType.key, { ...LOCATION }),
          },
          "pick location",
        ),
      ),
  };
});

jest.mock("~/components/common/HostOrganismSearchBox", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({ value, onResultSelect, hostGenomes }: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        { "data-testid": "host-box", "data-count": String(hostGenomes.length) },
        ReactLib.createElement(
          "button",
          {
            "data-testid": "host-pick-id",
            onClick: () => onResultSelect({ result: 1 }),
          },
          value || "unset",
        ),
        ReactLib.createElement(
          "button",
          {
            "data-testid": "host-pick-unknown-id",
            onClick: () => onResultSelect({ result: 987 }),
          },
          "unknown",
        ),
      ),
  };
});

import MetadataManualInput from "~/components/common/Metadata/MetadataManualInput";

const HUMAN = {
  id: 1,
  name: "Human",
  samples_count: 100,
  taxa_category: "human",
};
const MOSQUITO = {
  id: 2,
  name: "Mosquito",
  samples_count: 5,
  taxa_category: "insect",
};

const LOCATION_FIELD = {
  key: "collection_location_v2",
  name: "Collection Location",
  dataType: "location",
  is_required: 1,
  host_genome_ids: [1, 2],
};

const SAMPLE_TYPE_FIELD = {
  key: "sample_type",
  name: "Sample Type",
  dataType: "string",
  is_required: 1,
  host_genome_ids: [1, 2],
};

const WATER_CONTROL_FIELD = {
  key: "water_control",
  name: "Water Control",
  dataType: "string",
  is_required: 0,
  host_genome_ids: [1, 2],
};

// samplesAreNew resolves the host genome through the "Host Organism" metadata
// value, so seed it directly on the samples.
const humanSample = {
  name: "Sample A",
  host_genome_id: 1,
  metadata: { "Host Organism": "Human" },
};
const insectSample = {
  name: "Sample B",
  host_genome_id: 2,
  metadata: { "Host Organism": "Mosquito" },
};

const renderInput = (props: Record<string, unknown> = {}) => {
  const onMetadataChange = jest.fn();
  const utils = render(
    <MetadataManualInput
      {...({
        samples: [humanSample, insectSample],
        projectMetadataFields: {
          sample_type: SAMPLE_TYPE_FIELD,
          collection_location_v2: LOCATION_FIELD,
        },
        hostGenomes: [HUMAN, MOSQUITO],
        sampleTypes: [],
        samplesAreNew: true,
        onMetadataChange,
        ...props,
      } as $TSFixMe)}
    />,
  );
  return { ...utils, onMetadataChange };
};

const lastPayload = (onMetadataChange: jest.Mock) =>
  onMetadataChange.mock.calls[onMetadataChange.mock.calls.length - 1][0]
    .metadata;

describe("MetadataManualInput location and host genome branches", () => {
  it("strips the city from a human host location but leaves other hosts alone", () => {
    const { onMetadataChange } = renderInput();

    // Set a city-level location on the first (human) sample, then copy it to all.
    fireEvent.click(
      screen.getAllByTestId("pick-location-collection_location_v2")[0],
    );
    fireEvent.click(screen.getByText("Apply to All"));

    const rows = lastPayload(onMetadataChange).rows;
    const human = rows.find((r: $TSFixMe) => r.sample_name === "Sample A");
    const insect = rows.find((r: $TSFixMe) => r.sample_name === "Sample B");

    // Human: city (and the duplicate subdivision) removed, flagged for refetch.
    expect(human.collection_location_v2.city_name).toBe("");
    expect(human.collection_location_v2.subdivision_name).toBe("");
    expect(human.collection_location_v2.name).toBe("California, USA");
    expect(human.collection_location_v2.refetch_adjusted_location).toBe(true);
    expect(human.collection_location_v2.geo_level).toBe("state");

    // Non-human: the city-level location is preserved verbatim.
    expect(insect.collection_location_v2.city_name).toBe("Los Angeles");
    expect(insect.collection_location_v2.name).toBe(
      "Los Angeles, California, USA",
    );
    expect(
      insect.collection_location_v2.refetch_adjusted_location,
    ).toBeUndefined();
  });

  it("does not run the location special-case on non-location columns", () => {
    const { onMetadataChange } = renderInput();

    fireEvent.change(screen.getAllByTestId("metadata-input-sample_type")[0], {
      target: { value: "CSF" },
    });
    fireEvent.click(screen.getByText("Apply to All"));

    const rows = lastPayload(onMetadataChange).rows;
    expect(rows.map((r: $TSFixMe) => r.sample_type)).toEqual(["CSF", "CSF"]);
  });

  it("shows the picked location object only on the edited row", () => {
    renderInput();

    const before = screen.getAllByTestId(
      "metadata-input-collection_location_v2",
    ) as HTMLInputElement[];
    expect(before).toHaveLength(2);
    expect(before[0].value).toBe("");
    expect(before[1].value).toBe("");

    fireEvent.click(
      screen.getAllByTestId("pick-location-collection_location_v2")[0],
    );

    const after = screen.getAllByTestId(
      "metadata-input-collection_location_v2",
    ) as HTMLInputElement[];
    // getMetadataValue returns the edited object for row 1 and nothing for row 2.
    expect(after[0].value).toBe("Los Angeles, California, USA");
    expect(after[1].value).toBe("");
  });

  it("converts a bare host genome id from the search box into its name", () => {
    const { onMetadataChange } = renderInput();

    // Sample B is a mosquito; pick host genome id 1 (Human) for it.
    fireEvent.click(screen.getAllByTestId("host-pick-id")[1]);

    const rows = lastPayload(onMetadataChange).rows;
    const insect = rows.find((r: $TSFixMe) => r.sample_name === "Sample B");
    expect(insect["Host Organism"]).toBe("Human");
  });

  it("passes an unrecognised host genome id through unchanged", () => {
    const { onMetadataChange } = renderInput();

    fireEvent.click(screen.getAllByTestId("host-pick-unknown-id")[0]);

    const rows = lastPayload(onMetadataChange).rows;
    const human = rows.find((r: $TSFixMe) => r.sample_name === "Sample A");
    expect(human["Host Organism"]).toBe(987);
  });

  it("falls back to an empty host genome list when the prop is missing", () => {
    renderInput({ hostGenomes: undefined });

    expect(
      screen.getAllByTestId("host-box")[0].getAttribute("data-count"),
    ).toBe("0");
  });

  it("re-applies the water control default instead of a plain re-sync when samples change", () => {
    const onMetadataChange = jest.fn();
    const props = {
      samples: [humanSample, insectSample],
      projectMetadataFields: {
        sample_type: SAMPLE_TYPE_FIELD,
        water_control: WATER_CONTROL_FIELD,
      },
      hostGenomes: [HUMAN, MOSQUITO],
      sampleTypes: [],
      samplesAreNew: true,
      onMetadataChange,
    };
    const { rerender } = render(
      <MetadataManualInput {...(props as $TSFixMe)} />,
    );
    onMetadataChange.mockClear();

    const thirdSample = {
      name: "Sample C",
      host_genome_id: 1,
      metadata: { "Host Organism": "Human" },
    };
    rerender(
      <MetadataManualInput
        {...({
          ...props,
          samples: [humanSample, insectSample, thirdSample],
        } as $TSFixMe)}
      />,
    );

    // The water-control default path both fills the new sample and syncs the
    // parent, so no extra empty re-sync is needed.
    const rows = lastPayload(onMetadataChange).rows;
    expect(rows).toHaveLength(3);
    rows.forEach((row: $TSFixMe) => expect(row.water_control).toBe("No"));
  });

  it("does not re-run the water control default when there is no such field", () => {
    const onMetadataChange = jest.fn();
    const props = {
      samples: [humanSample, insectSample],
      projectMetadataFields: { sample_type: SAMPLE_TYPE_FIELD },
      hostGenomes: [HUMAN, MOSQUITO],
      sampleTypes: [],
      samplesAreNew: true,
      onMetadataChange,
    };
    const { rerender } = render(
      <MetadataManualInput {...(props as $TSFixMe)} />,
    );
    onMetadataChange.mockClear();

    rerender(
      <MetadataManualInput
        {...({ ...props, samples: [humanSample] } as $TSFixMe)}
      />,
    );

    const rows = lastPayload(onMetadataChange).rows;
    expect(rows).toEqual([{ sample_name: "Sample A" }]);
  });
});
