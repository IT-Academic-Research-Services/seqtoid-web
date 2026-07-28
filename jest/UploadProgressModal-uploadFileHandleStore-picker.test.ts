/**
 * Coverage for the parts of uploadFileHandleStore (recovery Option C) that the round-trip suite does
 * not reach: pickFilesWithHandles (the File System Access adoption point) and the defensive storage
 * paths -- open() erroring/blocked/throwing, a transaction that errors/aborts/throws, and the
 * first-run object-store upgrade. Every failure must degrade to false/null/[] so the upload path is
 * never broken by a storage problem.
 */
import {
  clearFileHandle,
  clearProjectFileHandles,
  getPersistedFileHandle,
  isFileHandlePersistenceSupported,
  PersistableFileHandle,
  persistFileHandle,
  pickFilesWithHandles,
} from "../app/assets/src/components/views/SampleUploadFlow/components/UploadProgressModal/uploadFileHandleStore";

type Rec = { key: string; projectId: string; handle?: PersistableFileHandle };

class FakeRequest {
  result: unknown;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

const later = (fn: () => void) => setTimeout(fn, 0);

interface FakeOptions {
  open?: "success" | "error" | "blocked" | "throw" | "upgrade";
  tx?: "complete" | "error" | "abort" | "throw";
  storeExists?: boolean;
}

const createdStores: string[] = [];

const installFakeEnv = (opts: FakeOptions = {}) => {
  const { open = "success", tx = "complete", storeExists = true } = opts;
  const store = new Map<string, Rec>();

  class FakeObjectStore {
    put(rec: Rec): FakeRequest {
      const req = new FakeRequest();
      store.set(rec.key, rec);
      req.result = rec.key;
      return req;
    }
    get(key: string): FakeRequest {
      const req = new FakeRequest();
      req.result = store.get(key);
      return req;
    }
    delete(key: string): FakeRequest {
      const req = new FakeRequest();
      store.delete(key);
      return req;
    }
    index(): { openCursor: () => FakeRequest } {
      return {
        openCursor: () => {
          const req = new FakeRequest();
          later(() => {
            req.result = null;
            req.onsuccess?.();
          });
          return req;
        },
      };
    }
  }

  class FakeTransaction {
    oncomplete: (() => void) | null = null;
    onerror: (() => void) | null = null;
    onabort: (() => void) | null = null;
    constructor() {
      later(() => {
        if (tx === "error") this.onerror?.();
        else if (tx === "abort") this.onabort?.();
        else this.oncomplete?.();
      });
    }
    objectStore(): FakeObjectStore {
      return new FakeObjectStore();
    }
  }

  class FakeDb {
    objectStoreNames = { contains: () => storeExists };
    transaction(): FakeTransaction {
      if (tx === "throw") throw new Error("InvalidStateError");
      return new FakeTransaction();
    }
    createObjectStore(name: string) {
      createdStores.push(name);
      return { createIndex: () => undefined };
    }
    close() {
      /* no-op */
    }
  }

  (global as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      if (open === "throw") throw new Error("indexedDB disabled");
      const req = new FakeRequest();
      req.result = new FakeDb();
      later(() => {
        if (open === "error") req.onerror?.();
        else if (open === "blocked") req.onblocked?.();
        else if (open === "upgrade") {
          req.onupgradeneeded?.();
          req.onsuccess?.();
        } else req.onsuccess?.();
      });
      return req;
    },
  };
  (global as unknown as { IDBKeyRange: unknown }).IDBKeyRange = {
    only: (v: string) => ({ only: v }),
  };
  (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker =
    () => Promise.resolve([]);
  return store;
};

const removeEnv = () => {
  delete (global as unknown as { indexedDB?: unknown }).indexedDB;
  delete (window as unknown as { showOpenFilePicker?: unknown })
    .showOpenFilePicker;
};

const fakeHandle = (
  name: string,
  overrides: Partial<PersistableFileHandle> = {},
): PersistableFileHandle => ({
  kind: "file",
  name,
  getFile: async () => new File([new Uint8Array(4)], name),
  ...overrides,
});

afterEach(() => {
  removeEnv();
  createdStores.length = 0;
});

describe("isFileHandlePersistenceSupported edges", () => {
  it("is false when reading indexedDB throws", () => {
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker =
      () => Promise.resolve([]);
    Object.defineProperty(global, "indexedDB", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    expect(isFileHandlePersistenceSupported()).toBe(false);
    delete (global as unknown as { indexedDB?: unknown }).indexedDB;
  });

  it("is false when indexedDB is explicitly null", () => {
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker =
      () => Promise.resolve([]);
    (global as unknown as { indexedDB: unknown }).indexedDB = null;
    expect(isFileHandlePersistenceSupported()).toBe(false);
  });
});

describe("uploadFileHandleStore storage failures", () => {
  it("returns false / null when open() errors", async () => {
    installFakeEnv({ open: "error" });
    expect(await persistFileHandle(1, "k", fakeHandle("f"))).toBe(false);
    expect(await getPersistedFileHandle(1, "k")).toBeNull();
  });

  it("returns false when open() is blocked", async () => {
    installFakeEnv({ open: "blocked" });
    expect(await persistFileHandle(1, "k", fakeHandle("f"))).toBe(false);
  });

  it("returns false when open() throws synchronously", async () => {
    installFakeEnv({ open: "throw" });
    expect(await persistFileHandle(1, "k", fakeHandle("f"))).toBe(false);
  });

  it("creates the handles object store on first upgrade", async () => {
    installFakeEnv({ open: "upgrade", storeExists: false });
    expect(await persistFileHandle(1, "k", fakeHandle("f"))).toBe(true);
    expect(createdStores).toEqual(["handles"]);
  });

  it("returns false when the write transaction errors or aborts", async () => {
    installFakeEnv({ tx: "error" });
    expect(await persistFileHandle(1, "k", fakeHandle("f"))).toBe(false);
    installFakeEnv({ tx: "abort" });
    expect(await persistFileHandle(1, "k", fakeHandle("f"))).toBe(false);
  });

  it("returns false / null and still resolves the clears when transactions throw", async () => {
    installFakeEnv({ tx: "throw" });
    expect(await persistFileHandle(1, "k", fakeHandle("f"))).toBe(false);
    expect(await getPersistedFileHandle(1, "k")).toBeNull();
    await expect(clearFileHandle(1, "k")).resolves.toBeUndefined();
    await expect(clearProjectFileHandles(1)).resolves.toBeUndefined();
  });

  it("clear helpers no-op when persistence is unsupported", async () => {
    removeEnv();
    await expect(clearFileHandle(1, "k")).resolves.toBeUndefined();
    await expect(clearProjectFileHandles(1)).resolves.toBeUndefined();
  });
});

describe("pickFilesWithHandles", () => {
  it("returns [] when the File System Access API is unsupported", async () => {
    removeEnv();
    expect(await pickFilesWithHandles()).toEqual([]);
  });

  it("returns each picked handle paired with its File", async () => {
    installFakeEnv();
    const handles = [fakeHandle("a_R1.fastq.gz"), fakeHandle("a_R2.fastq.gz")];
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker =
      jest.fn(async () => handles);

    const picked = await pickFilesWithHandles();

    expect(picked).toHaveLength(2);
    expect(picked.map(p => p.handle.name)).toEqual([
      "a_R1.fastq.gz",
      "a_R2.fastq.gz",
    ]);
    expect(picked.map(p => p.file.name)).toEqual([
      "a_R1.fastq.gz",
      "a_R2.fastq.gz",
    ]);
    expect(
      (window as unknown as { showOpenFilePicker: jest.Mock })
        .showOpenFilePicker,
    ).toHaveBeenCalledWith({ multiple: true });
  });

  it("skips a handle whose file cannot be read right now", async () => {
    installFakeEnv();
    const good = fakeHandle("good.fastq");
    const bad = fakeHandle("bad.fastq", {
      getFile: async () => {
        throw new Error("NotFoundError");
      },
    });
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker =
      async () => [bad, good];

    const picked = await pickFilesWithHandles();

    expect(picked).toHaveLength(1);
    expect(picked[0].handle.name).toBe("good.fastq");
  });

  it("returns [] when the user cancels the picker", async () => {
    installFakeEnv();
    (window as unknown as { showOpenFilePicker: unknown }).showOpenFilePicker =
      async () => {
        throw new Error("AbortError");
      };
    expect(await pickFilesWithHandles()).toEqual([]);
  });
});
