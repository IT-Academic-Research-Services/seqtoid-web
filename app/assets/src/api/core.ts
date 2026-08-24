import axios from "axios";
import { getCsrfToken } from "./utils";

const MAX_SAMPLES_FOR_GET_REQUEST = 256;

// SMP-1497 / SMP-1501 / SMP-1476: central expired-session (HTTP 401) handling.
//
// Previously every method rejected a non-2xx with the raw Rails response body. For a
// 401 that body is a plain { error: "Unauthorized", code: 401 } object -- no Error
// prototype, no .message. Uncaught callers surfaced it as an "UnhandledRejection:
// Non-Error promise rejection captured with value: [error, Unauthorized][code, 401]"
// (SMP-1497 / DEV-REACTJS-PROJECT-1R). The SampleView Relay query reaches this path via
// getValidIdentity -> get("/identify"); the thrown bare object hit the ErrorBoundary,
// whose isSampleNotFoundError only matches values with a .message, so the 401 fell
// through to the generic error screen (SMP-1501 / SMP-1476).
//
// A 401 is an EXPECTED auth-expiry condition, not a product defect: send the user back
// through the login flow to re-authenticate (mirroring handleDiscoveryLoadError in
// DiscoveryView/utils.ts), and reject with a real Error so any unwrapped/uncaught
// rejection is a proper Error rather than a bare object. The Rails payload's `code` and
// `error` fields are preserved as own properties on that Error because existing catch
// handlers branch on them (DiscoveryView isUnauthorizedError, SampleView persisted-
// background handling, BulkDownloadModal).
const LOGIN_URL = "/auth0/login";

// A real Error for an expired-session 401 that still carries the Rails body fields, so
// callers reading error.code / error.error keep working.
const buildUnauthorizedError = (data: $TSFixMe) => {
  const message = typeof data?.error === "string" ? data.error : "Unauthorized";
  const err = new Error(message);
  err.name = "UnauthorizedError";
  return Object.assign(err, {
    code: data?.code ?? 401,
    error: data?.error ?? "Unauthorized",
  });
};

// Shared rejection shaping for every REST method. An expired-session 401 re-authenticates
// and rejects with a real Error; every other failure keeps the existing behavior --
// reject with the parsed response body, or the raw error when there is no HTTP response
// (e.g. a transient network error, SMP-1589).
const toApiError = (e: $TSFixMe): Error => {
  if (e.response?.status === 401) {
    window.location.href = LOGIN_URL;
    return buildUnauthorizedError(e.response.data);
  }
  if (!e.code && e.response?.data?.code) {
    e.code = e.response.data.code;
  }
  if (!e.error && e.response?.data?.error) {
    e.error = e.response.data.error;
  }
  if (e.response?.status) {
    e = Object.assign(e, {
      code: e.code ?? e.response.status,
      status: e.status ?? e.response.status,
      statusText: e.statusText ?? e.response.statusText ?? "Unknown",
    });
  }
  return e;
};

const postWithCSRF = async (url: $TSFixMe, params: $TSFixMe = {}) => {
  try {
    // resp also contains headers, status, etc. that we might use later.
    const resp = await axios.post(url, {
      ...params,
      // Fetch the CSRF token from the DOM.
      authenticity_token: getCsrfToken(),
    });
    // Just return the data.
    return resp.data;
  } catch (e) {
    throw toApiError(e);
  }
};

// TODO(mark): Remove redundancy in CSRF methods.
const putWithCSRF = async (url: $TSFixMe, params: $TSFixMe = {}) => {
  try {
    // resp also contains headers, status, etc. that we might use later.
    const resp = await axios.put(url, {
      ...params,
      // Fetch the CSRF token from the DOM.
      authenticity_token: getCsrfToken(),
    });
    // Just return the data.
    return resp.data;
  } catch (e) {
    throw toApiError(e);
  }
};

// A TRANSIENT network error has no HTTP response at all (connectivity blip, DNS hiccup,
// aborted-in-flight) and is not a user cancel -- distinct from a real 4xx/5xx, which carries
// e.response. Only these are safe to auto-retry. (SMP-1589)
const isTransientNetworkError = (e: $TSFixMe) =>
  !axios.isCancel(e) && !!e && e.response === undefined;

const GET_MAX_ATTEMPTS = 3;

// GET is idempotent, so a momentary network error (AxiosError "Network Error" /
// "NetworkError when attempting to fetch resource" -- DEV-REACTJS-1P, 25) can be retried
// safely instead of surfacing as a failed read. Bounded (3 attempts, 0.5s then 1s backoff),
// transient-only: a real HTTP error or a cancel is rejected immediately, and a persistent
// outage still rejects after the last attempt. Writes (post/put/delete) are intentionally NOT
// retried -- they are not idempotent and a retry could double-submit.
const get = async (url: $TSFixMe, config: $TSFixMe = {}) => {
  let lastErr: $TSFixMe;
  for (let attempt = 1; attempt <= GET_MAX_ATTEMPTS; attempt++) {
    try {
      const resp = await axios.get(url, config);
      // Just return the data.
      return resp.data;
    } catch (e) {
      lastErr = e;
      if (attempt === GET_MAX_ATTEMPTS || !isTransientNetworkError(e)) break;
      // exponential backoff before re-issuing the idempotent GET: 0.5s, then 1s.
      await new Promise(resolve =>
        setTimeout(resolve, 500 * 2 ** (attempt - 1)),
      );
    }
  }
  throw toApiError(lastErr);
};

const deleteWithCSRF = async (url: $TSFixMe) => {
  try {
    const resp = await axios.delete(url, {
      data: {
        // Fetch the CSRF token from the DOM.
        authenticity_token: getCsrfToken(),
      },
    });
    return resp.data;
  } catch (e) {
    throw toApiError(e);
  }
};

export {
  deleteWithCSRF,
  get,
  MAX_SAMPLES_FOR_GET_REQUEST,
  postWithCSRF,
  putWithCSRF,
};
