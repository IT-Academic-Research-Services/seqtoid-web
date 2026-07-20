// Coverage: app/assets/src/helpers/url.ts
// Pure URL param (de)serialization plus the two clipboard helpers.
// copy-to-clipboard and the ~/api shortenUrl network call are mocked so the
// suite stays deterministic and offline.
import {
  copyShortUrlToClipboard,
  copyUrlToClipboard,
  getURLParamString,
  parseUrlParams,
} from "../app/assets/src/helpers/url";

jest.mock("copy-to-clipboard", () => jest.fn());
jest.mock("~/api", () => ({
  shortenUrl: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const copy = require("copy-to-clipboard") as jest.Mock;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { shortenUrl } = require("~/api") as { shortenUrl: jest.Mock };

const setSearch = (search: string) => {
  window.history.replaceState({}, "", search || "/");
};

describe("helpers/url.ts", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setSearch("/");
  });

  describe("parseUrlParams", () => {
    it("JSON-parses booleans and numbers", () => {
      setSearch("?flag=true&count=5");
      expect(parseUrlParams()).toEqual({ flag: true, count: 5 });
    });

    it("leaves non-JSON strings as strings", () => {
      setSearch("?name=abc");
      expect(parseUrlParams()).toEqual({ name: "abc" });
    });

    it("preserves pipeline_version as a string (3.10 != 3.1)", () => {
      setSearch("?pipeline_version=3.10");
      const result = parseUrlParams();
      expect(result.pipeline_version).toBe("3.10");
      expect(typeof result.pipeline_version).toBe("string");
    });

    it("keeps bracketed array params as arrays", () => {
      setSearch("?tags[]=a&tags[]=b");
      expect(parseUrlParams()).toEqual({ tags: ["a", "b"] });
    });

    it("returns an empty object when there is no query string", () => {
      setSearch("/");
      expect(parseUrlParams()).toEqual({});
    });
  });

  describe("getURLParamString", () => {
    it("serializes scalar key/value pairs", () => {
      expect(getURLParamString({ a: 1, b: "x" })).toBe("a=1&b=x");
    });

    it("expands arrays into bracketed repeated keys", () => {
      expect(getURLParamString({ tags: ["a", "b"] })).toBe("tags[]=a&tags[]=b");
    });

    it("drops plain-object values but keeps other params", () => {
      expect(getURLParamString({ obj: { x: 1 }, a: 1 })).toBe("a=1");
    });

    it("drops undefined values", () => {
      expect(getURLParamString({ a: undefined, b: 2 })).toBe("b=2");
    });

    it("filters nested objects out of array values", () => {
      expect(getURLParamString({ tags: ["a", { x: 1 }, "b"] })).toBe(
        "tags[]=a&tags[]=b",
      );
    });

    it("returns an empty string for no serializable params", () => {
      expect(getURLParamString({})).toBe("");
    });
  });

  describe("copyShortUrlToClipboard", () => {
    it("shortens the given url then copies origin + short key", async () => {
      shortenUrl.mockResolvedValue({ unique_key: "key123" });
      await copyShortUrlToClipboard("http://example.com/long");
      expect(shortenUrl).toHaveBeenCalledWith("http://example.com/long");
      expect(copy).toHaveBeenCalledWith(window.location.origin + "/key123");
    });

    it("falls back to window.location.href when no url is passed", async () => {
      shortenUrl.mockResolvedValue({ unique_key: "abc" });
      await copyShortUrlToClipboard();
      expect(shortenUrl).toHaveBeenCalledWith(window.location.href);
      expect(copy).toHaveBeenCalledWith(window.location.origin + "/abc");
    });
  });

  describe("copyUrlToClipboard", () => {
    it("copies the provided url verbatim", async () => {
      await copyUrlToClipboard("http://example.com/x");
      expect(copy).toHaveBeenCalledWith("http://example.com/x");
    });

    it("falls back to window.location.href when no url is passed", async () => {
      await copyUrlToClipboard();
      expect(copy).toHaveBeenCalledWith(window.location.href);
    });
  });
});
