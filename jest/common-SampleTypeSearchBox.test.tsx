// Coverage: app/assets/src/components/common/SampleTypeSearchBox.tsx
//
// SampleTypeSearchBox is a thin adapter over LiveSearchPopBox: all of its own
// logic lives in the `onSearchTriggered` callback it hands down (match, sort,
// group-by-category, build SearchResults). LiveSearchPopBox is stubbed so the
// tests can pull that callback off its props and invoke it directly, which
// exercises every category branch (insect_only / human_only / non-human-animal
// / default) and every buildResults branch (suggested / all / noMatch).
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

import SampleTypeSearchBox from "~/components/common/SampleTypeSearchBox";

const sampleTypes = [
  {
    name: "Plasma",
    group: "Systemic Inflammation",
    insect_only: false,
    human_only: false,
  },
  {
    name: "Whole Blood",
    group: "Systemic Inflammation",
    insect_only: false,
    human_only: true,
  },
  { name: "Guts", group: "Insect", insect_only: true, human_only: false },
  {
    name: "Serum",
    group: "Systemic Inflammation",
    insect_only: false,
    human_only: false,
  },
] as $TSFixMe;

const renderBox = (props: $TSFixMe = {}) => {
  capturedProps = null;
  render(
    <SampleTypeSearchBox
      className="cls"
      value=""
      onResultSelect={jest.fn()}
      sampleTypes={sampleTypes}
      taxaCategory="human"
      {...props}
    />,
  );
  return capturedProps;
};

const search = (query: string, props: $TSFixMe = {}) =>
  renderBox(props).onSearchTriggered(query);

describe("SampleTypeSearchBox wiring", () => {
  it("passes through className, value and the fixed LiveSearchPopBox config", () => {
    const props = renderBox({ className: "myclass", value: "Plasma" });
    expect(props.className).toBe("myclass");
    expect(props.value).toBe("Plasma");
    expect(props.minChars).toBe(0);
    expect(props.shouldSearchOnFocus).toBe(true);
    expect(props.icon).toBe("chevron down");
  });
});

describe("SampleTypeSearchBox category grouping", () => {
  it("puts human_only types in SUGGESTED when the host is human, others in ALL", () => {
    const results = search("", { taxaCategory: "human" });
    const suggestedNames = results.suggested.results.map(
      (r: $TSFixMe) => r.name,
    );
    const allNames = results.all.results.map((r: $TSFixMe) => r.name);
    // Whole Blood is human_only + human host -> SUGGESTED.
    expect(suggestedNames).toContain("Whole Blood");
    // Guts is insect_only but host is human -> ALL.
    expect(allNames).toContain("Guts");
    // Plain non-restricted types -> ALL for a human host.
    expect(allNames).toContain("Plasma");
  });

  it("suggests insect_only types when the host is an insect", () => {
    const results = search("", { taxaCategory: "insect" });
    const suggestedNames = results.suggested.results.map(
      (r: $TSFixMe) => r.name,
    );
    expect(suggestedNames).toContain("Guts");
    // human_only type is not suggested for an insect host.
    const allNames = results.all.results.map((r: $TSFixMe) => r.name);
    expect(allNames).toContain("Whole Blood");
  });

  it("suggests every non-restricted type for a non-human-animal host", () => {
    const results = search("", { taxaCategory: "non-human-animal" });
    const suggestedNames = results.suggested.results.map(
      (r: $TSFixMe) => r.name,
    );
    // Plasma / Serum (no restriction) become SUGGESTED for non-human-animal.
    expect(suggestedNames).toEqual(expect.arrayContaining(["Plasma", "Serum"]));
    // insect_only and human_only still route to ALL.
    const allNames = results.all.results.map((r: $TSFixMe) => r.name);
    expect(allNames).toEqual(expect.arrayContaining(["Guts", "Whole Blood"]));
  });

  it("puts everything unrestricted in ALL for an unknown host category", () => {
    const results = search("", { taxaCategory: "unknown" });
    // No SUGGESTED bucket because nothing qualifies.
    expect(results.suggested).toBeUndefined();
    const allNames = results.all.results.map((r: $TSFixMe) => r.name);
    expect(allNames).toEqual(expect.arrayContaining(["Plasma", "Serum"]));
  });
});

describe("SampleTypeSearchBox buildResults", () => {
  it("includes description only when showDescription is set", () => {
    const withDesc = search("Plasma", {
      showDescription: true,
      taxaCategory: "unknown",
    });
    const plasma = withDesc.all.results.find(
      (r: $TSFixMe) => r.name === "Plasma",
    );
    expect(plasma.description).toBe("Systemic Inflammation");

    const noDesc = search("Plasma", {
      showDescription: false,
      taxaCategory: "unknown",
    });
    const plasma2 = noDesc.all.results.find(
      (r: $TSFixMe) => r.name === "Plasma",
    );
    expect(plasma2.description).toBeNull();
  });

  it("adds a noMatch fallback for a non-empty query that is not an exact suggested match", () => {
    const results = search("Zzz", { taxaCategory: "non-human-animal" });
    expect(results.noMatch).toBeDefined();
    expect(results.noMatch.results[0].name).toBe("Zzz");
  });

  it("omits the noMatch fallback when the query is empty", () => {
    const results = search("", { taxaCategory: "unknown" });
    expect(results.noMatch).toBeUndefined();
  });

  it("omits the noMatch fallback when the query exactly matches the top suggested result", () => {
    // For a non-human-animal host, Plasma is the top SUGGESTED result; an exact
    // query for it must suppress the plain-text fallback.
    const results = search("Plasma", { taxaCategory: "non-human-animal" });
    expect(results.noMatch).toBeUndefined();
  });

  it("returns an empty result set when nothing matches an empty type list", () => {
    const results = renderBox({
      sampleTypes: [],
      taxaCategory: "unknown",
    }).onSearchTriggered("");
    expect(results.suggested).toBeUndefined();
    expect(results.all).toBeUndefined();
    expect(results.noMatch).toBeUndefined();
  });
});
