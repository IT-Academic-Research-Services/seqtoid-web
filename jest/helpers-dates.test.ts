// SMP-1816: "Date format warning in UI".
//
// Rails serializes timestamps (pipeline_run.created_at -> "Date Processed",
// workflow_run.executed_at) through a GraphQL String field, so the frontend
// receives Time#to_s / TimeWithZone#to_s strings such as
// "2026-08-31 14:38:05 -0400" or "2026-08-31 14:38:05 UTC". Those are neither
// ISO 8601 nor RFC 2822, so bare moment(value) fell back to the JS Date
// constructor and printed the moment deprecation warning. parseServerDate /
// formatServerDate parse against explicit formats in strict mode, which keeps
// moment off the guessing path.
import moment from "moment";
import { formatServerDate, parseServerDate } from "~/helpers/dates";

// The exact console.warn text moment emits from its non-strict fallback path.
const MOMENT_DEPRECATION_FRAGMENT = "not in a recognized RFC2822 or ISO format";

describe("parseServerDate", () => {
  it("parses the Rails space-separated numeric-offset string", () => {
    const parsed = parseServerDate("2026-08-31 14:38:05 -0400");
    expect(parsed).not.toBeNull();
    expect(parsed?.isValid()).toBe(true);
    // -0400 == 18:38:05 UTC.
    expect(parsed?.utc().format("YYYY-MM-DD HH:mm:ss")).toBe(
      "2026-08-31 18:38:05",
    );
  });

  it("parses the Rails UTC-zone string", () => {
    const parsed = parseServerDate("2026-08-31 14:38:05 UTC");
    expect(parsed?.utc().format("YYYY-MM-DD HH:mm:ss")).toBe(
      "2026-08-31 14:38:05",
    );
  });

  it("parses a plain space-separated datetime with no zone", () => {
    expect(parseServerDate("2026-08-31 14:38:05")?.format("YYYY-MM-DD")).toBe(
      "2026-08-31",
    );
  });

  it("still accepts ISO 8601 input", () => {
    expect(parseServerDate("2026-08-31T14:38:05Z")?.format("YYYY-MM-DD")).toBe(
      "2026-08-31",
    );
    expect(
      parseServerDate("2026-08-31T14:38:05-04:00")?.utc().format("HH:mm"),
    ).toBe("18:38");
  });

  it.each([null, undefined, "", "not a date", "13/40/2026"])(
    "returns null for missing or unparseable value %p",
    value => {
      expect(parseServerDate(value as string | null | undefined)).toBeNull();
    },
  );
});

describe("formatServerDate", () => {
  it("formats a Rails datetime string as YYYY-MM-DD by default", () => {
    expect(formatServerDate("2026-08-31 14:38:05 -0400")).toBe("2026-08-31");
  });

  it("honors a custom output format", () => {
    expect(formatServerDate("2026-08-31 14:38:05 UTC", "MMM D, YYYY")).toBe(
      "Aug 31, 2026",
    );
  });

  it("returns the fallback text for a missing value instead of the current date", () => {
    expect(formatServerDate(undefined)).toBe("unknown");
    expect(formatServerDate(null, "YYYY-MM-DD", "n/a")).toBe("n/a");
  });

  it("returns the fallback text for an unparseable value", () => {
    expect(formatServerDate("garbage", "YYYY-MM-DD", "n/a")).toBe("n/a");
  });
});

describe("no moment deprecation warning (SMP-1816 regression guard)", () => {
  let warnSpy: jest.SpyInstance;

  beforeEach(() => {
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("baseline: bare moment() DOES warn on the Rails offset string", () => {
    // Guards the premise: if moment ever stops warning here, this test tells us
    // the root cause the helper defends against has changed.
    moment("2026-08-31 14:38:05 -0400").format("YYYY-MM-DD");
    const warned = warnSpy.mock.calls
      .map(call => call.join(" "))
      .some(msg => msg.includes(MOMENT_DEPRECATION_FRAGMENT));
    expect(warned).toBe(true);
  });

  it("does not warn when parsing the Rails offset string via the helper", () => {
    formatServerDate("2026-08-31 14:38:05 -0400");
    formatServerDate("2026-08-31 14:38:05 UTC");
    parseServerDate("2026-08-31 14:38:05 -0400");
    const warned = warnSpy.mock.calls
      .map(call => call.join(" "))
      .some(msg => msg.includes(MOMENT_DEPRECATION_FRAGMENT));
    expect(warned).toBe(false);
  });
});
