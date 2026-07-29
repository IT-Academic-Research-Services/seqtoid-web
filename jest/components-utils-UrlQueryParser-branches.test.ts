// Branch coverage top-up for app/assets/src/components/utils/UrlQueryParser.ts.
// UrlQueryParser.test.ts already covers the main paths; these exercise the
// remaining arms: the defaulted constructor argument and the falsy-value side
// of stringifyValue's `!value || empty` guard.
import UrlQueryParser from "../app/assets/src/components/utils/UrlQueryParser";

describe("UrlQueryParser constructor defaulting", () => {
  it("defaults to an empty type map when constructed with no arguments", () => {
    const parser = new UrlQueryParser();
    expect(parser._types).toEqual({});
    // With no declared types every param stays a raw string.
    expect(parser.parse("?workflowRunId=42")).toEqual({ workflowRunId: "42" });
  });
});

describe("UrlQueryParser.stringifyValue falsy object values", () => {
  const parser = new UrlQueryParser({ selectedOptions: "object" } as $TSFixMe);

  it("returns undefined for a null object value", () => {
    expect(parser.stringifyValue(null as $TSFixMe, "object")).toBeUndefined();
  });

  it("returns undefined for an undefined object value", () => {
    expect(
      parser.stringifyValue(undefined as $TSFixMe, "object"),
    ).toBeUndefined();
  });

  it("serializes a populated object", () => {
    expect(parser.stringifyValue({ background: 3 }, "object")).toBe(
      '{"background":3}',
    );
  });
});

describe("UrlQueryParser round trip", () => {
  const parser = new UrlQueryParser({
    workflowRunId: "number",
    selectedOptions: "object",
  } as $TSFixMe);

  it("parses back what it stringified", () => {
    const query = parser.stringify({
      workflowRunId: 12,
      selectedOptions: { background: 4, metric: "nt_r" },
    });
    const parsed = parser.parse(`?${query}`);
    expect(parsed.workflowRunId).toBe(12);
    expect(parsed.selectedOptions).toEqual({ background: 4, metric: "nt_r" });
  });

  it("drops keys whose typed object value is empty when stringifying", () => {
    const query = parser.stringify({
      workflowRunId: 12,
      selectedOptions: {},
    });
    expect(query).toBe("workflowRunId=12");
  });
});

describe("UrlQueryParser.updateQueryStringParameter with typed params", () => {
  const parser = new UrlQueryParser({ workflowRunId: "number" } as $TSFixMe);

  it("replaces the coerced value for an existing key", () => {
    const updated = parser.updateQueryStringParameter(
      "?workflowRunId=1&view=table",
      "workflowRunId",
      99,
    );
    expect(updated).toEqual({ workflowRunId: 99, view: "table" });
  });

  it("returns the parsed params untouched when the key is missing", () => {
    const updated = parser.updateQueryStringParameter(
      "?workflowRunId=1",
      "pipelineVersion",
      "8.0",
    );
    expect(updated).toEqual({ workflowRunId: 1 });
  });
});
