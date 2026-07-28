/**
 * Failure-path / branch coverage for uploadByteCache (recovery Option B). The happy round-trip is
 * covered elsewhere; this exercises the defensive paths that must degrade to "nothing cached"
 * instead of breaking the upload: IndexedDB unavailable or throwing, open() erroring/blocked, a
 * transaction that aborts or errors, the DB-creation upgrade path, and unrecoverable records.
 */
import {
  cacheUploadFile,
  canCacheFile,
  clearCachedUploadFile,
  clearProjectByteCache,
  getCachedUploadFile,
  isByteCacheSupported,
} from "../app/assets/src/components/views/SampleUploadFlow/components/UploadProgressModal/uploadByteCache";

type Rec = { key: string; projectId: string; blob?: Blob; name?: string };

class FakeRequest {
  result: unknown;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onupgradeneeded: (() => void) | null = null;
  onblocked: (() => void) | null = null;
}

const later = (fn: () => void) => setTimeout(fn, 0);

interface FakeOptions {
  // How indexedDB.open resolves.
  open?: "success" | "error" | "blocked" | "throw" | "upgrade";
  // How a transaction settles.
  tx?: "complete" | "error" | "abort" | "throw";
  // Whether the store already exists during an upgrade.
  storeExists?: boolean;
}

const createdStores: string[] = [];
const createdIndexes: string[] = [];

const installFakeIndexedDb = (opts: FakeOptions = {}) => {
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
      return {
        createIndex: (indexName: string) => createdIndexes.push(indexName),
      };
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
  return store;
};

const removeIndexedDb = () => {
  delete (global as unknown as { indexedDB?: unknown }).indexedDB;
};

afterEach(() => {
  removeIndexedDb();
  createdStores.length = 0;
  createdIndexes.length = 0;
});

const smallFile = (name = "a_R1.fastq.gz") =>
  new File([new Uint8Array(8)], name);

describe("isByteCacheSupported / canCacheFile edges", () => {
  it("reports unsupported when reading indexedDB itself throws (sandboxed iframe)", () => {
    Object.defineProperty(global, "indexedDB", {
      configurable: true,
      get() {
        throw new Error("SecurityError");
      },
    });
    expect(isByteCacheSupported()).toBe(false);
    delete (global as unknown as { indexedDB?: unknown }).indexedDB;
  });

  it("reports unsupported when indexedDB is explicitly null", () => {
    (global as unknown as { indexedDB: unknown }).indexedDB = null;
    expect(isByteCacheSupported()).toBe(false);
  });

  it("rejects a negative size even when caching is supported", () => {
    installFakeIndexedDb();
    expect(canCacheFile(-1)).toBe(false);
    expect(canCacheFile(0)).toBe(true);
  });
});

describe("uploadByteCache open() failures", () => {
  it("returns false / null when open() errors", async () => {
    installFakeIndexedDb({ open: "error" });
    expect(await cacheUploadFile(1, "k", smallFile())).toBe(false);
    expect(await getCachedUploadFile(1, "k")).toBeNull();
  });

  it("returns false / null when open() is blocked by another tab", async () => {
    installFakeIndexedDb({ open: "blocked" });
    expect(await cacheUploadFile(1, "k", smallFile())).toBe(false);
    expect(await getCachedUploadFile(1, "k")).toBeNull();
  });

  it("returns false when open() throws synchronously", async () => {
    installFakeIndexedDb({ open: "throw" });
    expect(await cacheUploadFile(1, "k", smallFile())).toBe(false);
  });

  it("creates the object store and its project index on first upgrade", async () => {
    installFakeIndexedDb({ open: "upgrade", storeExists: false });
    expect(await cacheUploadFile(1, "k", smallFile())).toBe(true);
    expect(createdStores).toEqual(["files"]);
    expect(createdIndexes).toEqual(["projectId"]);
  });

  it("does not recreate the object store when it already exists", async () => {
    installFakeIndexedDb({ open: "upgrade", storeExists: true });
    expect(await cacheUploadFile(1, "k", smallFile())).toBe(true);
    expect(createdStores).toEqual([]);
  });

  it("clear helpers no-op when the database cannot be opened", async () => {
    installFakeIndexedDb({ open: "error" });
    await expect(clearCachedUploadFile(1, "k")).resolves.toBeUndefined();
    await expect(clearProjectByteCache(1)).resolves.toBeUndefined();
  });
});

describe("uploadByteCache transaction failures", () => {
  it("returns false when the write transaction errors", async () => {
    installFakeIndexedDb({ tx: "error" });
    expect(await cacheUploadFile(2, "k", smallFile())).toBe(false);
  });

  it("returns false when the write transaction aborts (quota)", async () => {
    installFakeIndexedDb({ tx: "abort" });
    expect(await cacheUploadFile(2, "k", smallFile())).toBe(false);
  });

  it("returns false / null when opening a transaction throws", async () => {
    installFakeIndexedDb({ tx: "throw" });
    expect(await cacheUploadFile(2, "k", smallFile())).toBe(false);
    expect(await getCachedUploadFile(2, "k")).toBeNull();
    // The project-wide clear has its own guard and must still resolve.
    await expect(clearProjectByteCache(2)).resolves.toBeUndefined();
  });
});

describe("getCachedUploadFile unrecoverable records", () => {
  it("returns null when the stored record has no blob", async () => {
    const store = installFakeIndexedDb();
    store.set("3:k", { key: "3:k", projectId: "3", name: "x" });
    expect(await getCachedUploadFile(3, "k")).toBeNull();
  });

  it("returns null when the File constructor is unavailable", async () => {
    installFakeIndexedDb();
    expect(await cacheUploadFile(4, "k", smallFile("z.fastq"))).toBe(true);

    const RealFile = global.File;
    (global as unknown as { File: unknown }).File = function BrokenFile() {
      throw new Error("File is not a constructor");
    };
    try {
      expect(await getCachedUploadFile(4, "k")).toBeNull();
    } finally {
      (global as unknown as { File: unknown }).File = RealFile;
    }
  });

  it("falls back to an empty name/type when the blob carries neither", async () => {
    installFakeIndexedDb();
    const bareBlob = new Blob([new Uint8Array(4)]) as Blob & { name?: string };
    expect(await cacheUploadFile(5, "k", bareBlob)).toBe(true);

    const recovered = await getCachedUploadFile(5, "k");
    expect(recovered).not.toBeNull();
    expect(recovered?.name).toBe("");
    expect(recovered?.size).toBe(4);
  });
});
