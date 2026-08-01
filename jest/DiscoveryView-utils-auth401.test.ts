// SMP-1620: expired-session (HTTP 401) handling for the /my_data discovery loaders.
// isUnauthorizedError recognizes the Rails 401 payload that api/core.ts rejects with
// ({ error: "Unauthorized", code: 401 }); handleDiscoveryLoadError redirects to the
// login flow for that case (swallowing it, so it is neither an unhandled rejection nor
// Sentry noise) and re-throws every genuine, non-401 failure so it still propagates.
import {
  handleDiscoveryLoadError,
  isUnauthorizedError,
} from "~/components/views/DiscoveryView/utils";

describe("isUnauthorizedError", () => {
  it("matches the api/core.ts 401 response body", () => {
    expect(isUnauthorizedError({ error: "Unauthorized", code: 401 })).toBe(true);
  });

  it("matches on code 401 alone", () => {
    expect(isUnauthorizedError({ code: 401 })).toBe(true);
  });

  it("matches on status 401 alone", () => {
    expect(isUnauthorizedError({ status: 401 })).toBe(true);
  });

  it("matches a raw (un-unwrapped) axios error", () => {
    expect(isUnauthorizedError({ response: { status: 401 } })).toBe(true);
  });

  it("does not match a non-401 error payload", () => {
    expect(isUnauthorizedError({ error: "Server Error", code: 500 })).toBe(
      false,
    );
    expect(isUnauthorizedError({ response: { status: 500 } })).toBe(false);
  });

  it("does not match non-object values", () => {
    expect(isUnauthorizedError(null)).toBe(false);
    expect(isUnauthorizedError(undefined)).toBe(false);
    expect(isUnauthorizedError("Unauthorized")).toBe(false);
    expect(isUnauthorizedError(401)).toBe(false);
  });
});

describe("handleDiscoveryLoadError", () => {
  const originalLocation = window.location;

  beforeEach(() => {
    // jsdom's window.location is not writable; swap in a plain stand-in so the
    // redirect target can be asserted.
    delete (window as $TSFixMe).location;
    (window as $TSFixMe).location = { href: "" };
  });

  afterEach(() => {
    (window as $TSFixMe).location = originalLocation;
  });

  it("redirects to the login flow on an expired-session 401 and swallows it", () => {
    expect(() =>
      handleDiscoveryLoadError({ error: "Unauthorized", code: 401 }),
    ).not.toThrow();
    expect(window.location.href).toBe("/auth0/login");
  });

  it("re-throws a genuine non-401 error without redirecting", () => {
    const err = { error: "Server Error", code: 500 };
    expect(() => handleDiscoveryLoadError(err)).toThrow();
    expect(window.location.href).toBe("");
  });

  it("re-throws a thrown Error instance unchanged", () => {
    const err = new Error("boom");
    expect(() => handleDiscoveryLoadError(err)).toThrow("boom");
    expect(window.location.href).toBe("");
  });
});
