// CZID-462 (#586) coverage: app/assets/src/api/core.ts and app/assets/src/api/utils.ts
import axios from "axios";
import {
  deleteWithCSRF,
  get,
  MAX_SAMPLES_FOR_GET_REQUEST,
  postWithCSRF,
  putWithCSRF,
} from "../app/assets/src/api/core";
import { getCsrfToken } from "../app/assets/src/api/utils";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

// core.ts reads the CSRF token off the DOM via a <meta name="csrf-token">.
const setCsrfToken = (token: string) => {
  document.head.innerHTML = `<meta name="csrf-token" content="${token}">`;
};

describe("api/utils.ts getCsrfToken", () => {
  it("reads the token content from the DOM", () => {
    setCsrfToken("tok-123");
    expect(getCsrfToken()).toBe("tok-123");
  });
});

describe("api/core.ts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setCsrfToken("csrf-abc");
  });

  describe("postWithCSRF", () => {
    it("posts params plus the CSRF token and returns data", async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: { ok: true } });
      const result = await postWithCSRF("/foo", { a: 1 });
      expect(mockedAxios.post).toHaveBeenCalledWith("/foo", {
        a: 1,
        authenticity_token: "csrf-abc",
      });
      expect(result).toEqual({ ok: true });
    });
    it("rejects with the response data on error", async () => {
      mockedAxios.post.mockRejectedValueOnce({ response: { data: "bad" } });
      await expect(postWithCSRF("/foo")).rejects.toBe("bad");
    });
  });

  describe("putWithCSRF", () => {
    it("puts params plus the CSRF token and returns data", async () => {
      mockedAxios.put.mockResolvedValueOnce({ data: { updated: 1 } });
      const result = await putWithCSRF("/bar", { b: 2 });
      expect(mockedAxios.put).toHaveBeenCalledWith("/bar", {
        b: 2,
        authenticity_token: "csrf-abc",
      });
      expect(result).toEqual({ updated: 1 });
    });
    it("rejects with the response data on error", async () => {
      mockedAxios.put.mockRejectedValueOnce({ response: { data: "err" } });
      await expect(putWithCSRF("/bar")).rejects.toBe("err");
    });
  });

  describe("get", () => {
    it("passes through the config and returns data", async () => {
      mockedAxios.get.mockResolvedValueOnce({ data: [1, 2, 3] });
      const config = { params: { q: "x" } };
      const result = await get("/baz", config);
      expect(mockedAxios.get).toHaveBeenCalledWith("/baz", config);
      expect(result).toEqual([1, 2, 3]);
    });
    it("rejects with the response data on error", async () => {
      mockedAxios.get.mockRejectedValueOnce({ response: { data: "nope" } });
      await expect(get("/baz")).rejects.toBe("nope");
    });

    it("does NOT retry a real HTTP error -- rejects on the first attempt", async () => {
      mockedAxios.get.mockRejectedValueOnce({ response: { data: "boom" } });
      await expect(get("/baz")).rejects.toBe("boom");
      expect(mockedAxios.get).toHaveBeenCalledTimes(1);
    });

    // SMP-1589: transient network errors on the idempotent GET are retried with
    // backoff. This repo is on Jest 26, which has no jest.advanceTimersByTimeAsync;
    // instead of fake timers we stub setTimeout to invoke the scheduled callback
    // immediately, so the backoff runs instantly and the test stays deterministic
    // (no wall-clock waits, no timer-API version coupling).
    describe("transient-network retry", () => {
      const netErr = { message: "Network Error", response: undefined };
      let setTimeoutSpy: jest.SpyInstance;

      beforeEach(() => {
        setTimeoutSpy = jest
          .spyOn(global, "setTimeout")
          .mockImplementation((cb: (...args: unknown[]) => void) => {
            cb();
            return 0 as unknown as ReturnType<typeof setTimeout>;
          });
      });
      afterEach(() => setTimeoutSpy.mockRestore());

      it("retries a transient network error (no response) then succeeds", async () => {
        mockedAxios.get
          .mockRejectedValueOnce(netErr)
          .mockResolvedValueOnce({ data: { ok: true } });
        await expect(get("/baz")).resolves.toEqual({ ok: true });
        expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      });

      it("gives up after 3 transient attempts and rejects with the network error", async () => {
        mockedAxios.get.mockRejectedValue(netErr);
        await expect(get("/baz")).rejects.toBe(netErr);
        expect(mockedAxios.get).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe("deleteWithCSRF", () => {
    it("sends the CSRF token in the request body and returns data", async () => {
      mockedAxios.delete.mockResolvedValueOnce({ data: { deleted: true } });
      const result = await deleteWithCSRF("/qux");
      expect(mockedAxios.delete).toHaveBeenCalledWith("/qux", {
        data: { authenticity_token: "csrf-abc" },
      });
      expect(result).toEqual({ deleted: true });
    });
    it("rejects with the response data on error", async () => {
      mockedAxios.delete.mockRejectedValueOnce({ response: { data: "fail" } });
      await expect(deleteWithCSRF("/qux")).rejects.toBe("fail");
    });
  });

  // Regression (Sentry DEV-REACTJS-PROJECT-8/-5/-A): on a NETWORK error (timeout / abort /
  // offline / CORS) axios rejects with an error that has NO `response`, so `e.response.data`
  // threw a TypeError ("undefined is not an object (evaluating 'r.response.data')") that
  // cascaded through the Discovery view. With the `e.response?.data ?? e` guard, each method
  // must reject with the error object itself instead of crashing. Reverting the guard makes
  // these reject with a TypeError, not the network error -> the toBe assertion fails.
  describe("network error (no response object)", () => {
    const netErr = { message: "Network Error", code: "ERR_NETWORK" };
    it("post rejects with the error, not a TypeError", async () => {
      mockedAxios.post.mockRejectedValueOnce(netErr);
      await expect(postWithCSRF("/foo")).rejects.toBe(netErr);
    });
    it("put rejects with the error, not a TypeError", async () => {
      mockedAxios.put.mockRejectedValueOnce(netErr);
      await expect(putWithCSRF("/bar")).rejects.toBe(netErr);
    });
    // NOTE: `get` also rejects with the raw network error rather than a TypeError,
    // but since SMP-1589 it does so only after retrying the transient error -- that
    // path is covered by the "transient-network retry" describe above (which stubs
    // the backoff), so it is intentionally not repeated here to avoid a real-timer
    // wait. post/put/delete are NOT retried, so they still reject on first attempt.
    it("delete rejects with the error, not a TypeError", async () => {
      mockedAxios.delete.mockRejectedValueOnce(netErr);
      await expect(deleteWithCSRF("/qux")).rejects.toBe(netErr);
    });
  });

  it("exposes the max-samples GET constant", () => {
    expect(MAX_SAMPLES_FOR_GET_REQUEST).toBe(256);
  });
});
