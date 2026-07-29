/**
 * Branch coverage for uploadResumeState: the guarded (throwing localStorage) paths and every
 * rejection branch of loadUploadResumeState's shape validation.
 */
import {
  clearUploadResumeState,
  hasResumableUpload,
  loadUploadResumeState,
  saveUploadResumeState,
  UploadResumeState,
} from "../app/assets/src/components/views/SampleUploadFlow/components/UploadProgressModal/uploadResumeState";

const KEY = (projectId: number | string) => `czid-upload-resume:${projectId}`;

afterEach(() => {
  jest.restoreAllMocks();
  window.localStorage.clear();
});

describe("saveUploadResumeState", () => {
  it("writes a project-scoped payload stamped with updatedAt", () => {
    const before = Date.now();
    saveUploadResumeState(42, {
      sampleFileUploadIds: { "samples/42/a_R1": "upload-abc" },
      sampleFileCompleted: { "samples/42/a_R2": true },
    });

    const raw = window.localStorage.getItem(KEY(42));
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as UploadResumeState;
    expect(parsed.sampleFileUploadIds).toEqual({
      "samples/42/a_R1": "upload-abc",
    });
    expect(parsed.sampleFileCompleted).toEqual({ "samples/42/a_R2": true });
    expect(parsed.updatedAt).toBeGreaterThanOrEqual(before);
  });

  it("keys state per project so concurrent uploads do not clobber each other", () => {
    saveUploadResumeState(1, {
      sampleFileUploadIds: { a: "one" },
      sampleFileCompleted: {},
    });
    saveUploadResumeState(2, {
      sampleFileUploadIds: { a: "two" },
      sampleFileCompleted: {},
    });

    expect(loadUploadResumeState(1)?.sampleFileUploadIds).toEqual({ a: "one" });
    expect(loadUploadResumeState(2)?.sampleFileUploadIds).toEqual({ a: "two" });
  });

  it("swallows a localStorage write failure (private mode / quota)", () => {
    jest.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    expect(() =>
      saveUploadResumeState(5, {
        sampleFileUploadIds: {},
        sampleFileCompleted: {},
      }),
    ).not.toThrow();
    // Nothing was persisted, so a later load finds no state.
    expect(loadUploadResumeState(5)).toBeNull();
  });
});

describe("loadUploadResumeState validation", () => {
  it("returns null when nothing is stored for the project", () => {
    expect(loadUploadResumeState("missing")).toBeNull();
  });

  it("returns null on unparseable JSON", () => {
    window.localStorage.setItem(KEY(7), "{not json");
    expect(loadUploadResumeState(7)).toBeNull();
  });

  it("returns null when the stored payload parses to null", () => {
    window.localStorage.setItem(KEY(8), "null");
    expect(loadUploadResumeState(8)).toBeNull();
  });

  it("returns null when the payload is not an object", () => {
    window.localStorage.setItem(KEY(9), '"a string"');
    expect(loadUploadResumeState(9)).toBeNull();
  });

  it("returns null when sampleFileUploadIds is not an object", () => {
    window.localStorage.setItem(
      KEY(10),
      JSON.stringify({ sampleFileUploadIds: "nope" }),
    );
    expect(loadUploadResumeState(10)).toBeNull();
  });

  it("defaults missing sampleFileCompleted / updatedAt", () => {
    window.localStorage.setItem(
      KEY(11),
      JSON.stringify({ sampleFileUploadIds: { k: "u" } }),
    );

    const loaded = loadUploadResumeState(11);
    expect(loaded).toEqual({
      sampleFileUploadIds: { k: "u" },
      sampleFileCompleted: {},
      updatedAt: 0,
    });
  });

  it("returns null when localStorage reads throw", () => {
    jest.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(loadUploadResumeState(12)).toBeNull();
  });
});

describe("clearUploadResumeState", () => {
  it("removes only the requested project's state", () => {
    saveUploadResumeState(1, {
      sampleFileUploadIds: { a: "one" },
      sampleFileCompleted: {},
    });
    saveUploadResumeState(2, {
      sampleFileUploadIds: { a: "two" },
      sampleFileCompleted: {},
    });

    clearUploadResumeState(1);

    expect(loadUploadResumeState(1)).toBeNull();
    expect(loadUploadResumeState(2)).not.toBeNull();
  });

  it("swallows a localStorage removal failure", () => {
    jest.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    expect(() => clearUploadResumeState(3)).not.toThrow();
  });
});

describe("hasResumableUpload", () => {
  it("is false for null state and for state with no in-flight uploadIds", () => {
    expect(hasResumableUpload(null)).toBe(false);
    expect(
      hasResumableUpload({
        sampleFileUploadIds: {},
        sampleFileCompleted: { done: true },
        updatedAt: 1,
      }),
    ).toBe(false);
  });

  it("is true when at least one uploadId is still recorded", () => {
    expect(
      hasResumableUpload({
        sampleFileUploadIds: { "samples/1/a": "upload-1" },
        sampleFileCompleted: {},
        updatedAt: 1,
      }),
    ).toBe(true);
  });
});
