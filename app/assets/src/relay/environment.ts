import type { FetchFunction, IEnvironment } from "relay-runtime";
import { Environment, Network, RecordSource, Store } from "relay-runtime";
import { getCsrfToken } from "~/api/utils";
import { logError } from "~/components/utils/logUtil";
import { getValidIdentity } from "./identify";

/**
 * Captures the name of a query/mutation, if it exists.
 *
 * e.g. "DiscoveryViewFCWorkflowRunsQuery" from "query DiscoveryViewFCWorkflowRunsQuery("
 */
const QUERY_NAME_REGEX = /(?:query|mutation)\s+(\S+)\s*\(/;

const generateFetchFn = (): FetchFunction => {
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
      logError({
        message: `[GQL Error] ${params.text?.match(QUERY_NAME_REGEX)?.[1]}`,
        details: {
          query: params.text,
          // Stringify because Sentry turns arrays and objects into [Array] and [Object] after a
          // certain depth.
          variables: JSON.stringify(variables),
          errors: JSON.stringify(responseJson.errors),
        },
      });
    }

    return responseJson;
  };
};

export function createEnvironment(): IEnvironment {
  const network = Network.create(generateFetchFn());
  const store = new Store(new RecordSource());
  return new Environment({ store, network });
}
