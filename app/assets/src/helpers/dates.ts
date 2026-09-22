import moment, { Moment } from "moment";

// Rails serializes timestamp columns (for example pipeline_run.created_at, which
// backs the "Date Processed" field, and workflow_run.executed_at) to JSON via
// Time#to_s / ActiveSupport::TimeWithZone#to_s. Depending on the server time
// zone that produces strings such as "2026-08-31 14:38:05 -0400" or
// "2026-08-31 14:38:05 UTC". Neither is ISO 8601 nor RFC 2822, so handing them
// straight to moment(value) forces moment into its guessing path and prints the
// "value provided is not in a recognized RFC2822 or ISO format, moment
// construction falls back to js Date" deprecation warning (SMP-1816).
//
// Parsing against an explicit list of accepted formats in strict mode keeps
// moment off the guessing path -- the warning is gone -- while still accepting
// the ISO strings that some endpoints already return. Any value that matches
// none of the formats is treated as "no date" rather than silently rendering
// the current time, which is what bare moment(undefined) used to do.
const SERVER_DATETIME_FORMATS: moment.MomentFormatSpecification = [
  moment.ISO_8601,
  "YYYY-MM-DD HH:mm:ss ZZ",
  "YYYY-MM-DD HH:mm:ss",
];

// Parse a server-provided datetime string. Returns null when the value is
// missing or does not match a known server format.
export const parseServerDate = (
  value: string | null | undefined,
): Moment | null => {
  if (!value) {
    return null;
  }
  // ActiveSupport::TimeWithZone#to_s in a UTC app renders "... UTC" (and "GMT"
  // for some zones). moment cannot parse a zone abbreviation via a format
  // token, and treating it as a literal would silently reinterpret the time as
  // local -- rolling the date around midnight. Normalize the trailing
  // abbreviation to a numeric offset so it parses as the correct instant; the
  // "ZZ" format then handles it just like the "-0400" numeric-offset form.
  const normalized = value.replace(/\s+(UTC|GMT)$/, " +0000");
  const parsed = moment(normalized, SERVER_DATETIME_FORMATS, true);
  return parsed.isValid() ? parsed : null;
};

// Format a server datetime string using the given output format (default
// "YYYY-MM-DD"), falling back to fallbackText when the value is missing or
// unparseable.
export const formatServerDate = (
  value: string | null | undefined,
  outputFormat = "YYYY-MM-DD",
  fallbackText = "unknown",
): string => {
  const parsed = parseServerDate(value);
  return parsed ? parsed.format(outputFormat) : fallbackText;
};
