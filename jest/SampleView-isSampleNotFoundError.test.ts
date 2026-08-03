// Frontend coverage:
// app/assets/src/components/views/SampleView/utils/isSampleNotFoundError.ts
//
// SMP-1633: the predicate that tells a genuinely-missing/forbidden sample apart
// from a real render failure, so SampleView can show a friendly message and
// skip the Sentry report for the expected case only.
import { isSampleNotFoundError } from "~/components/views/SampleView/utils/isSampleNotFoundError";

describe("isSampleNotFoundError", () => {
  it("matches the Rails resolver 'Couldn't find Sample' message", () => {
    const error = new Error("Couldn't find Sample with 'id'=278 [WHERE (1=0)]");
    expect(isSampleNotFoundError(error)).toBe(true);
  });

  it("matches the relay fatal-GQL 'returned no data' wrapper", () => {
    const error = new Error(
      '[GQL fatal] SampleViewSampleQuery returned no data: [{"message":"boom"}]',
    );
    expect(isSampleNotFoundError(error)).toBe(true);
  });

  it("accepts a plain string in either signature", () => {
    expect(
      isSampleNotFoundError("Couldn't find Sample with 'id'=1"),
    ).toBe(true);
    expect(
      isSampleNotFoundError("SampleViewSampleQuery returned no data: []"),
    ).toBe(true);
  });

  it("accepts an error-like object with a string message", () => {
    expect(
      isSampleNotFoundError({ message: "Couldn't find Sample with 'id'=9" }),
    ).toBe(true);
  });

  it("rejects unrelated errors", () => {
    expect(isSampleNotFoundError(new Error("network down"))).toBe(false);
    expect(isSampleNotFoundError("some other failure")).toBe(false);
    // A different query returning no data must not be treated as a missing
    // sample -- only the SampleView query counts.
    expect(
      isSampleNotFoundError("[GQL fatal] SomeOtherQuery returned no data: []"),
    ).toBe(false);
  });

  it("rejects non-error inputs without throwing", () => {
    expect(isSampleNotFoundError(null)).toBe(false);
    expect(isSampleNotFoundError(undefined)).toBe(false);
    expect(isSampleNotFoundError(278)).toBe(false);
    expect(isSampleNotFoundError({})).toBe(false);
  });
});
