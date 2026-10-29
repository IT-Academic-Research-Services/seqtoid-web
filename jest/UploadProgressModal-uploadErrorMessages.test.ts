// Coverage: .../UploadProgressModal/uploadErrorMessages.ts
//
// The upload modals show the server's `errors` strings (e.g. the weekly upload limit) instead of a
// bare "Upload failed". Only plain, non-empty strings are user-facing; thrown errors and model
// error objects stay in the log.
import { userFacingUploadErrors } from "~/components/views/SampleUploadFlow/components/UploadProgressModal/uploadErrorMessages";

describe("userFacingUploadErrors", () => {
  it("keeps the server's string messages, trimmed and in order", () => {
    expect(
      userFacingUploadErrors([
        "  Weekly upload limit reached: 200 samples per week through the web uploader.  ",
        "Invalid project id",
      ]),
    ).toEqual([
      "Weekly upload limit reached: 200 samples per week through the web uploader.",
      "Invalid project id",
    ]);
  });

  it("drops duplicates, blanks, thrown errors and error objects", () => {
    expect(
      userFacingUploadErrors([
        "Same reason",
        "Same reason",
        "",
        "   ",
        new Error("500 from server"),
        { name: ["can't be blank"] },
        null,
      ]),
    ).toEqual(["Same reason"]);
  });

  it("returns nothing for a non-array", () => {
    expect(userFacingUploadErrors(undefined)).toEqual([]);
    expect(userFacingUploadErrors("not a list")).toEqual([]);
  });
});
