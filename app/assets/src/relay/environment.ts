import type { FetchFunction, IEnvironment } from "relay-runtime";
import { Environment, Network, RecordSource, Store } from "relay-runtime";
import { getCsrfToken } from "~/api/utils";
import { getValidIdentity } from "./identify";

/**
 * Captures the name of a query/mutation, if it exists.
 *
 * e.g. "DiscoveryViewFCWorkflowRunsQuery" from "query DiscoveryViewFCWorkflowRunsQuery("
 */
const QUERY_NAME_REGEX = /(?:query|mutation)\s+(\S+)\s*\(/;

// Exported for unit testing (CZID-391): lets the fetch function be exercised directly
// without standing up a full Relay Network/Store.
export const generateFetchFn = (): FetchFunction => {
  return async (params, variables) => {
    await getValidIdentity();
    // CZID-305: cut over from the federation server (/graphqlfed) to the Rails-native
    // GraphQL endpoint (/graphql). GraphqlController uses protect_from_forgery with
    // :null_session, so the Rails CSRF token must be sent for the session (current_user)
    // to be honored — the federation-specific yoga CSRF header is no longer used.
    const response = await fetch("/graphql", {
      method: "POST",
      headers: [
        ["Content-Type", "application/json"],
        ["X-CSRF-Token", getCsrfToken()],
      ],
      body: JSON.stringify({
        query: params.text,
        variables,
      }),
    });

    const responseJson = await response.json();
    if (responseJson.errors != null) {
      const queryName = params.text?.match(QUERY_NAME_REGEX)?.[1];
      // CZID-391: GraphQL responses routinely carry non-fatal, field-level `errors`
      // (partial data, permission-filtered fields, deprecations) alongside valid `data`.
      // These are NOT application errors, and previously each one was sent to Sentry as an
      // Info-level `captureMessage`, flooding the dashboard (~74 entries on my_data /
      // bulk_downloads / samples/*). Keep the diagnostic value for local debugging via the
      // browser console, but do not emit a Sentry event for the partial-data case.
      // eslint-disable-next-line no-console
      console.error(`[GQL Error] ${queryName}`, {
        query: params.text,
        variables,
        errors: responseJson.errors,
      });

      // SMP-1494: distinguish a FATAL response (errors present AND no usable `data`) from the
      // partial-data case above. When the query returned nothing usable, swallowing it here
      // and returning `{}` to Relay left callers to throw an opaque, undiagnosable error --
      // e.g. DiscoveryViewFC's "Missing data: {}" (DEV-REACTJS-5): the real GraphQL errors
      // only ever reached the browser console, never Sentry, so the server-side cause was
      // invisible and the issue kept recurring after a partial fix. Throw here instead so
      // Relay rejects the operation and the caller's catch reports the ACTUAL cause (query
      // name + GraphQL errors). A legitimately-empty result returns `data: {…: []}` with no
      // `errors`, so this branch only trips on genuine failures.
      const data = responseJson.data;
      const hasUsableData =
        data != null &&
        (typeof data !== "object" || Object.keys(data).length > 0);
      if (!hasUsableData) {
        throw new Error(
          `[GQL fatal] ${queryName ?? "query"} returned no data: ${JSON.stringify(
            responseJson.errors,
          )}`,
        );
      }
    }

    return responseJson;
  };
};

export function createEnvironment(): IEnvironment {
  const network = Network.create(generateFetchFn());
  const store = new Store(new RecordSource());
  return new Environment({ store, network });
}
