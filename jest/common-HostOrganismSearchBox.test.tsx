// Coverage: app/assets/src/components/common/HostOrganismSearchBox.tsx
//
// HostOrganismSearchBox adapts LiveSearchPopBox like SampleTypeSearchBox. Its
// own logic (showAsOption filtering, sort by descending sample count, the
// ercc_only description branch and the plain-text noMatch fallback) lives in
// the onSearchTriggered callback, so LiveSearchPopBox is stubbed and that
// callback is invoked directly.
import { render } from "@testing-library/react";

let capturedProps: $TSFixMe = null;

jest.mock("~ui/controls/LiveSearchPopBox", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    capturedProps = props;
    return require("react").createElement("div", {
      "data-testid": "live-search",
    });
  },
}));

import HostOrganismSearchBox from "~/components/common/HostOrganismSearchBox";

const hostGenomes = [
  {
    id: 1,
    name: "Human",
    showAsOption: true,
    samples_count: 100,
    ercc_only: false,
  },
  {
    id: 2,
    name: "Mosquito",
    showAsOption: true,
    samples_count: 50,
    ercc_only: false,
  },
  {
    id: 3,
    name: "ERCC only",
    showAsOption: true,
    samples_count: 5,
    ercc_only: true,
  },
  {
    id: 4,
    name: "Hidden",
    showAsOption: false,
    samples_count: 999,
    ercc_only: false,
  },
] as $TSFixMe;

const renderBox = (props: $TSFixMe = {}) => {
  capturedProps = null;
  render(
    <HostOrganismSearchBox
      onResultSelect={jest.fn()}
      hostGenomes={hostGenomes}
      {...props}
    />,
  );
  return capturedProps;
};

const search = (query: string, props: $TSFixMe = {}) =>
  renderBox(props).onSearchTriggered(query);

describe("HostOrganismSearchBox wiring", () => {
  it("defaults the value to an empty string and passes the fixed config", () => {
    const props = renderBox();
    expect(props.value).toBe("");
    expect(props.minChars).toBe(0);
    expect(props.shouldSearchOnFocus).toBe(true);

    const props2 = renderBox({ value: "Human", className: "c" });
    expect(props2.value).toBe("Human");
    expect(props2.className).toBe("c");
  });
});

describe("HostOrganismSearchBox results", () => {
  it("excludes host genomes that are not shown as an option", () => {
    const results = search("");
    const names = results.suggested.results.map((r: $TSFixMe) => r.title);
    expect(names).not.toContain("Hidden");
    expect(names).toEqual(
      expect.arrayContaining(["Human", "Mosquito", "ERCC only"]),
    );
  });

  it("sorts suggestions by descending sample count", () => {
    const results = search("");
    const names = results.suggested.results.map((r: $TSFixMe) => r.title);
    expect(names).toEqual(["Human", "Mosquito", "ERCC only"]);
  });

  it("maps the host id into name and describes ercc_only genomes", () => {
    const results = search("");
    const ercc = results.suggested.results.find(
      (r: $TSFixMe) => r.title === "ERCC only",
    );
    expect(ercc.name).toBe(3);
    expect(ercc.description).toBe("Host will not be subtracted");

    const human = results.suggested.results.find(
      (r: $TSFixMe) => r.title === "Human",
    );
    expect(human.description).toBeNull();
  });

  it("omits the suggested group when nothing matches the query", () => {
    const results = search("ZZZZZ");
    expect(results.suggested).toBeUndefined();
    // A non-empty query with no exact match still yields the plain-text fallback.
    expect(results.noMatch).toBeDefined();
    expect(results.noMatch.results[0].name).toBe("ZZZZZ");
    expect(results.noMatch.results[0].description).toBe(
      "Host will not be subtracted",
    );
  });

  it("omits the noMatch fallback for an empty query", () => {
    const results = search("");
    expect(results.noMatch).toBeUndefined();
  });

  it("omits the noMatch fallback when the query exactly matches the top result name", () => {
    // The guard compares the query against the top *raw* genome's `.name`
    // ("Human"), so an exact-name query suppresses the plain-text fallback.
    const results = search("Human");
    expect(results.suggested.results[0].title).toBe("Human");
    expect(results.noMatch).toBeUndefined();
  });
});
