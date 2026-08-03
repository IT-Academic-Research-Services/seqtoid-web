// SMP-1633: recognize the "sample does not exist / no access" failure so the
// SampleView can show a friendly message instead of the generic error screen,
// and skip reporting it to Sentry (a missing/forbidden sample is expected).
//
// Two signatures are matched so detection survives changes on either side:
//   1. The Rails GraphQL resolver message, e.g.
//      Couldn't find Sample with 'id'=278 [WHERE (1=0)]
//   2. The relay fetch layer's fatal wrapper (SMP-1494, see
//      app/assets/src/relay/environment.ts), e.g.
//      [GQL fatal] SampleViewSampleQuery returned no data: [{"message":"..."}]
// For a not-found sample the thrown message contains both, but matching either
// keeps this robust if one string is reworded later.
const RAILS_NOT_FOUND = "Couldn't find Sample";
const GQL_FATAL_NO_DATA = "SampleViewSampleQuery returned no data";

export function isSampleNotFoundError(error: unknown): boolean {
  let message = "";
  if (typeof error === "string") {
    message = error;
  } else if (error instanceof Error) {
    message = error.message;
  } else if (
    error != null &&
    typeof error === "object" &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    message = (error as { message: string }).message;
  }

  if (!message) return false;

  return (
    message.includes(RAILS_NOT_FOUND) || message.includes(GQL_FATAL_NO_DATA)
  );
}
