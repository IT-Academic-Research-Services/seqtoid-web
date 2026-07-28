/**
 * Remaining branch coverage for uploadFileHandleStore.
 *
 * Three guards still had an untaken arm:
 *   * openDb's `if (!db.objectStoreNames.contains(STORE_NAME))` during
 *     onupgradeneeded -- the store-already-exists arm (a version bump on a
 *     database that was created by an earlier session).
 *   * persistFileHandle's `handle.name ?? ""` -- the fallback for a handle whose
 *     name is undefined.
 *   * reReadFileFromHandle's `if (handle.queryPermission)` -- the arm for a handle
 *     that does not implement queryPermission, which must fall through to the
 *     assumed-granted state rather than throwing.
 *
 * jsdom ships neither IndexedDB nor the File System Access API, so both are faked.
 */
import {
  PersistableFileHandle,
  persistFileHandle,
  reReadFileFromHandle,
} from "../app/assets/src/components/views/SampleUploadFlow/components/UploadProgressModal/uploadFileHandleStore";

const later = (fn: () => void) => setTimeout(fn, 0);

/* eslint-disable @typescript-eslint/no-explicit-any */
type PutRecord = { key: string; name?: string; handle?: unknown };

class FakeRequest {
  result: unknown;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

class FakeObjectStore {
  constructor(private readonly puts: PutRecord[]) {}
  put(rec: PutRecord): FakeRequest {
    const req = new FakeRequest();
    this.puts.push(rec);
    req.result = rec.key;
    return req;
  }
}

class FakeTransaction {
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor(private readonly puts: PutRecord[]) {
    later(() => this.oncomplete?.());
  }
  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.puts);
  }
}

// `storeExists` drives the onupgradeneeded guard; createObjectStore is a spy so
// the test can prove the store was (or was not) created.
const makeEnv = (storeExists: boolean) => {
  const puts: PutRecord[] = [];
  const createObjectStore = jest.fn(() => ({ createIndex: () => undefined }));
  const upgradesSeen: boolean[] = [];

  const db = {
    objectStoreNames: { contains: () => storeExists },
    createObjectStore,
    transaction: () => new FakeTransaction(puts),
    close: () => undefined,
  };

  (global as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      const req = new FakeRequest();
      req.result = db;
      later(() => {
        upgradesSeen.push(storeExists);
        // A version bump always fires onupgradeneeded before onsuccess.
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
  (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker =
    () => Promise.resolve([]);

  return { puts, createObjectStore, upgradesSeen };
};

afterEach(() => {
  delete (global as unknown as { indexedDB?: unknown }).indexedDB;
  delete (window as unknown as { showOpenFilePicker?: unknown })
    .showOpenFilePicker;
});
/* eslint-enable @typescript-eslint/no-explicit-any */

const handle = (
  overrides: Partial<PersistableFileHandle> = {},
): PersistableFileHandle =>
  ({
    kind: "file",
    name: "sample_R1.fastq.gz",
    getFile: async () => new File([new Uint8Array(2)], "sample_R1.fastq.gz"),
    ...overrides,
  } as PersistableFileHandle);

describe("openDb onupgradeneeded", () => {
  it("creates the object store when the upgrade finds it missing", async () => {
    const { createObjectStore, upgradesSeen } = makeEnv(false);

    expect(await persistFileHandle(1, "samples/1/a", handle())).toBe(true);

    expect(upgradesSeen).toEqual([false]);
    expect(createObjectStore).toHaveBeenCalledTimes(1);
  });

  it("leaves an existing object store alone on a re-upgrade", async () => {
    const { createObjectStore, upgradesSeen } = makeEnv(true);

    expect(await persistFileHandle(1, "samples/1/a", handle())).toBe(true);

    expect(upgradesSeen).toEqual([true]);
    // The store already exists -- recreating it would throw in a real IndexedDB.
    expect(createObjectStore).not.toHaveBeenCalled();
  });
});

describe("persistFileHandle name fallback", () => {
  it("stores the handle name when the handle has one", async () => {
    const { puts } = makeEnv(true);

    await persistFileHandle(4, "samples/4/named", handle());

    expect(puts).toHaveLength(1);
    expect(puts[0].name).toBe("sample_R1.fastq.gz");
  });

  it("stores an empty string when the handle has no name", async () => {
    const { puts } = makeEnv(true);

    await persistFileHandle(
      4,
      "samples/4/anonymous",
      handle({ name: undefined }),
    );

    expect(puts).toHaveLength(1);
    expect(puts[0].name).toBe("");
    expect(puts[0].key).toContain("samples/4/anonymous");
  });
});

describe("reReadFileFromHandle permission probing", () => {
  it("assumes granted when the handle has no queryPermission", async () => {
    const requestPermission = jest.fn();
    const file = new File([new Uint8Array(3)], "no_query.fastq");

    const result = await reReadFileFromHandle(
      handle({
        name: "no_query.fastq",
        queryPermission: undefined,
        requestPermission,
        getFile: async () => file,
      }),
    );

    expect(result).toBe(file);
    // state stayed "granted", so no re-grant prompt was raised.
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it("queries first, then requests, when queryPermission reports a prompt", async () => {
    const file = new File([new Uint8Array(3)], "prompted.fastq");
    const queryPermission = jest.fn(async () => "prompt" as PermissionState);
    const requestPermission = jest.fn(async () => "granted" as PermissionState);

    const result = await reReadFileFromHandle(
      handle({
        name: "prompted.fastq",
        queryPermission,
        requestPermission,
        getFile: async () => file,
      }),
    );

    expect(queryPermission).toHaveBeenCalledWith({ mode: "read" });
    expect(requestPermission).toHaveBeenCalledWith({ mode: "read" });
    expect(result).toBe(file);
  });
});
