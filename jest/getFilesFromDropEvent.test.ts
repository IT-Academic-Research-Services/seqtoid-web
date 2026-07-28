// SMP-1454: drag-and-drop must recurse dropped subfolders (react-dropzone's default reads only the
// flat FileList). These tests drive the webkitGetAsEntry walker against fake FileSystem entries.
import { getFilesFromDropEvent } from "../app/assets/src/components/ui/controls/getFilesFromDropEvent";

/* eslint-disable @typescript-eslint/no-explicit-any */

const fileEntry = (name: string): any => ({
  isFile: true,
  isDirectory: false,
  file: (cb: (f: File) => void) => cb(new File(["x"], name)),
});

// A directory whose readEntries serves `batches` in order, then an empty array (the real API
// returns children in chunks and must be read until empty).
const dirEntry = (batches: any[][]): any => {
  let i = 0;
  return {
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (cb: (batch: any[]) => void) =>
        cb(i < batches.length ? batches[i++] : []),
    }),
  };
};

// A drop event exposing the entry API (each item returns its snapshot entry).
const dropWithEntries = (entries: any[]): any => ({
  dataTransfer: {
    items: entries.map(entry => ({ webkitGetAsEntry: () => entry })),
    files: [],
  },
});

const names = (files: File[]): string[] => files.map(f => f.name).sort();

describe("getFilesFromDropEvent", () => {
  it("returns top-level files (the pre-existing behavior)", async () => {
    const files = await getFilesFromDropEvent(
      dropWithEntries([fileEntry("a.fastq"), fileEntry("b.fastq")]),
    );
    expect(names(files)).toEqual(["a.fastq", "b.fastq"]);
  });

  it("descends into a dropped subfolder (the SMP-1454 fix)", async () => {
    const files = await getFilesFromDropEvent(
      dropWithEntries([
        fileEntry("top.fastq"),
        dirEntry([[fileEntry("nested.fastq")]]),
      ]),
    );
    expect(names(files)).toEqual(["nested.fastq", "top.fastq"]);
  });

  it("recurses multiple directory levels", async () => {
    const deep = dirEntry([[dirEntry([[fileEntry("deep.fastq")]])]]);
    const files = await getFilesFromDropEvent(dropWithEntries([deep]));
    expect(names(files)).toEqual(["deep.fastq"]);
  });

  it("reads a directory served in multiple readEntries batches (no truncation)", async () => {
    const batched = dirEntry([
      [fileEntry("one.fastq"), fileEntry("two.fastq")],
      [fileEntry("three.fastq")],
    ]);
    const files = await getFilesFromDropEvent(dropWithEntries([batched]));
    expect(names(files)).toEqual(["one.fastq", "three.fastq", "two.fastq"]);
  });

  it("falls back to the flat FileList when the entry API is unavailable", async () => {
    const event: any = {
      dataTransfer: {
        // items present but no webkitGetAsEntry -> fall back
        items: [{}],
        files: [new File(["x"], "flat.fastq")],
      },
    };
    const files = await getFilesFromDropEvent(event);
    expect(names(files)).toEqual(["flat.fastq"]);
  });

  it("falls back to a file-input target.files (click-to-browse)", async () => {
    const event: any = {
      target: { files: [new File(["x"], "browsed.fastq")] },
    };
    const files = await getFilesFromDropEvent(event);
    expect(names(files)).toEqual(["browsed.fastq"]);
  });
});
