// Coverage: app/assets/src/relay/identify.ts
//
// getValidIdentity short-circuits when a still-valid `identityExpiresAt` is in
// localStorage, and otherwise re-fetches /identify and caches the new
// expiration. Every branch of the private isIdentityValid guard is driven from
// the outside: missing key, empty string, unparseable date, already-expired,
// and comfortably-in-the-future.
const mockGet = jest.fn();
jest.mock("~/api/core", () => ({
  get: (...args: unknown[]) => mockGet(...args),
}));

import { getValidIdentity } from "~/relay/identify";

const KEY = "identityExpiresAt";

describe("getValidIdentity", () => {
  beforeEach(() => {
    mockGet.mockReset();
    localStorage.clear();
  });

  it("fetches /identify and caches the expiration when nothing is stored", async () => {
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockGet.mockResolvedValue({ expires_at: expiresAt });

    await getValidIdentity();

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith("/identify");
    expect(localStorage.getItem(KEY)).toBe(expiresAt);
  });

  it("treats an empty stored value as missing and refetches", async () => {
    localStorage.setItem(KEY, "");
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockGet.mockResolvedValue({ expires_at: expiresAt });

    await getValidIdentity();

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).toBe(expiresAt);
  });

  it("does not refetch while the stored identity is still valid", async () => {
    const stillValid = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    localStorage.setItem(KEY, stillValid);

    await getValidIdentity();

    expect(mockGet).not.toHaveBeenCalled();
    // The cached value is left exactly as it was.
    expect(localStorage.getItem(KEY)).toBe(stillValid);
  });

  // Regression for the units bug (SMP-1497 / SMP-1501): the threshold is
  // twoMinutesInMs = 2 * 60 * 1000, compared against a millisecond delta from
  // Date.parse() - Date.now(). A token that expires 1 minute out is INSIDE the
  // 2-minute buffer and must be treated as invalid so it refetches proactively.
  // Under the old `2 * 60` (120 ms) threshold this same token read as valid and
  // never refetched -- proving the fix.
  it("refetches when the stored identity expires within the 2-minute buffer", async () => {
    localStorage.setItem(KEY, new Date(Date.now() + 60 * 1000).toISOString());
    const fresh = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockGet.mockResolvedValue({ expires_at: fresh });

    await getValidIdentity();

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).toBe(fresh);
  });

  // The other side of the 2-minute boundary: comfortably beyond the buffer is valid
  // and must NOT refetch (guards against over-correcting the threshold).
  it("does not refetch when the identity expires well beyond the 2-minute buffer", async () => {
    const beyondBuffer = new Date(Date.now() + 5 * 60 * 1000).toISOString();
    localStorage.setItem(KEY, beyondBuffer);

    await getValidIdentity();

    expect(mockGet).not.toHaveBeenCalled();
    expect(localStorage.getItem(KEY)).toBe(beyondBuffer);
  });

  it("refetches once the stored identity has already expired", async () => {
    localStorage.setItem(KEY, new Date(Date.now() - 1000).toISOString());
    const fresh = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    mockGet.mockResolvedValue({ expires_at: fresh });

    await getValidIdentity();

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).toBe(fresh);
  });

  it("refetches when the stored value is not a parseable date", async () => {
    // Date.parse -> NaN, and every NaN comparison is false, so the identity is
    // treated as invalid rather than accidentally accepted.
    localStorage.setItem(KEY, "not-a-date");
    const fresh = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    mockGet.mockResolvedValue({ expires_at: fresh });

    await getValidIdentity();

    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(KEY)).toBe(fresh);
  });

  it("propagates a failure from the /identify request and leaves the cache alone", async () => {
    mockGet.mockRejectedValue(new Error("identify unavailable"));

    await expect(getValidIdentity()).rejects.toThrow("identify unavailable");
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("resolves to undefined on both the cached and the refetched path", async () => {
    const stillValid = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    localStorage.setItem(KEY, stillValid);
    await expect(getValidIdentity()).resolves.toBeUndefined();

    localStorage.clear();
    mockGet.mockResolvedValue({ expires_at: stillValid });
    await expect(getValidIdentity()).resolves.toBeUndefined();
  });
});
