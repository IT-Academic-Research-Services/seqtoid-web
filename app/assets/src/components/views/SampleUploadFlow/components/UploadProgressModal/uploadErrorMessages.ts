import { uniq } from "lodash/fp";

// bulk_upload_with_metadata reports why samples were not created in `errors`. Most entries are
// plain strings written for the user: the weekly upload limit (with how many are left and when it
// resets), an invalid project, missing metadata. Others are not -- a thrown request error, or a
// model's errors object -- and are only useful in the log. Keep the user-facing strings,
// de-duplicated and in order, so the upload modal can say WHY instead of a bare "Upload failed".
export const userFacingUploadErrors = (errors: unknown): string[] =>
  uniq(
    (Array.isArray(errors) ? errors : [])
      .filter((error): error is string => typeof error === "string")
      .map(error => error.trim())
      .filter(error => error.length > 0),
  );
