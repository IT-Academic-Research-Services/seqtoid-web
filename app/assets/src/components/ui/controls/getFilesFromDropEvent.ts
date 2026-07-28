// Collect files from a drag-and-drop (or file-input) event, descending into dropped DIRECTORIES via
// the FileSystem entry API (webkitGetAsEntry). react-dropzone's default file-getter only reads the
// flat FileList, so a dropped folder is skipped entirely -- only top-level files are picked up
// (SMP-1454). This walker recurses subfolders.
//
// Feature-detected and non-breaking: for a click-to-browse file input, or a browser without the
// entry API, it falls back to react-dropzone's original flat behavior (dataTransfer.files /
// target.files). Files are flattened by basename (their .name has no path) -- matching the existing
// downstream behavior, which keys samples/files by basename. NOTE: two same-named files in
// different subfolders therefore still collide downstream (one overwrites the other); surfacing
// that as a warning is a follow-up, out of scope for reading subfolders at all.

// The reader/entry types are lib.dom's FileSystem* API (prefixed, loosely typed across browsers);
// keep them `any` so the feature-detected walk stays browser-portable.
/* eslint-disable @typescript-eslint/no-explicit-any */

const readFile = (entry: any, out: File[]): Promise<void> =>
  new Promise(resolve => {
    entry.file(
      (file: File) => {
        out.push(file);
        resolve();
      },
      // Ignore a single unreadable file rather than failing the whole drop.
      () => resolve(),
    );
  });

const readDirectory = (entry: any, out: File[]): Promise<void> =>
  new Promise(resolve => {
    const reader = entry.createReader();
    // readEntries returns results in BATCHES; it must be called repeatedly until it yields an
    // empty array, or large directories are silently truncated.
    const readBatch = (): void => {
      reader.readEntries(
        async (batch: any[]) => {
          if (batch.length === 0) {
            resolve();
            return;
          }
          await Promise.all(batch.map(child => walkEntry(child, out)));
          readBatch();
        },
        () => resolve(),
      );
    };
    readBatch();
  });

const walkEntry = (entry: any, out: File[]): Promise<void> => {
  if (!entry) return Promise.resolve();
  if (entry.isFile) return readFile(entry, out);
  if (entry.isDirectory) return readDirectory(entry, out);
  return Promise.resolve();
};

export const getFilesFromDropEvent = async (event: any): Promise<File[]> => {
  const dataTransfer = event && event.dataTransfer;
  const items = dataTransfer && dataTransfer.items;
  const hasEntryApi =
    items &&
    items.length > 0 &&
    typeof items[0].webkitGetAsEntry === "function";

  if (!hasEntryApi) {
    // Original react-dropzone behavior: flat FileList (drop without the entry API, or file input).
    if (dataTransfer && dataTransfer.files && dataTransfer.files.length) {
      return Array.prototype.slice.call(dataTransfer.files);
    }
    if (event && event.target && event.target.files) {
      return Array.prototype.slice.call(event.target.files);
    }
    return [];
  }

  // webkitGetAsEntry() MUST be called synchronously while the event is live -- the
  // DataTransferItemList is emptied once the handler returns -- so snapshot every entry first, then
  // walk them asynchronously.
  const entries: any[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = items[i].webkitGetAsEntry();
    if (entry) entries.push(entry);
  }

  const files: File[] = [];
  await Promise.all(entries.map(entry => walkEntry(entry, files)));
  return files;
};
