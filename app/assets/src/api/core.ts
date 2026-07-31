import axios from "axios";
import { getCsrfToken } from "./utils";

const MAX_SAMPLES_FOR_GET_REQUEST = 256;

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
    return Promise.reject(e.response?.data ?? e);
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
    return Promise.reject(e.response?.data ?? e);
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
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }
  }
  return Promise.reject(lastErr.response?.data ?? lastErr);
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
    return Promise.reject(e.response?.data ?? e);
  }
};

export {
  get,
  postWithCSRF,
  putWithCSRF,
  deleteWithCSRF,
  MAX_SAMPLES_FOR_GET_REQUEST,
};
