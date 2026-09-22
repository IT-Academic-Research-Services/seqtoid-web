import * as Sentry from "@sentry/browser";
import axios from "axios";

// For more information on Sentry usage see: https://docs.sentry.io/platforms/javascript/usage/

interface LogErrorParams {
  message: string;
  exception?: Error | null;
  details?: {
    [key: string]: any;
  };
}

export const logError = ({
  message,
  exception = null,
  details = {},
}: LogErrorParams) => {
  // TODO: Should we log the error to the browser? Makes debugging much easier.
  console.error("logError:", message, exception, details);
  if (exception) {
    if (Error.isError(exception)) {
      Sentry.captureException(exception, {
        extra: {
          ...details,
          message,
        },
      });
    } else {
      Sentry.captureMessage(message, {
        extra: {
          ...details,
          exception: JSON.stringify(exception),
        },
      });
    }
  } else {
    Sentry.captureMessage(message, {
      extra: details,
    });
  }
};

// A transient client-side network failure -- the browser could not complete the
// request (connection dropped, offline, request aborted/canceled) -- is not an
// application bug. axios rejects these with code ERR_NETWORK / ERR_CANCELED and
// no HTTP response. Callers use this to avoid reporting connectivity blips to
// Sentry as application errors (SMP-1494 / DEV-REACTJS-PROJECT-5).
export const isTransientNetworkError = (error: unknown): boolean =>
  axios.isCancel(error) ||
  (axios.isAxiosError(error) &&
    (error.code === "ERR_NETWORK" || error.code === "ERR_CANCELED"));
