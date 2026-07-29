// Coverage: app/assets/src/relay/environment.ts
//
// Complements jest/relayEnvironment.test.ts (which pins the Sentry-noise
// behavior of generateFetchFn) by covering the request the fetch function
// actually issues -- endpoint, method, headers, body -- plus createEnvironment,
// which wires the fetch function into a real Relay Environment/Store.
const mockGetValidIdentity = jest.fn().mockResolvedValue(undefined);
jest.mock("~/relay/identify", () => ({
  getValidIdentity: (...args: unknown[]) => mockGetValidIdentity(...args),
}));
jest.mock("~/api/utils", () => ({
  getCsrfToken: jest.fn().mockReturnValue("csrf-abc123"),
}));

import type { RequestParameters, Variables } from "relay-runtime";
import { createEnvironment, generateFetchFn } from "~/relay/environment";

const makeParams = (text: string) =>
  ({
    text,
    name: "SomeThingQuery",
    operationKind: "query",
    metadata: {},
    id: null,
    cacheID: "abc",
  } as unknown as RequestParameters);

const VARIABLES: Variables = { id: "1" };

const runFetch = async (
  responseBody: unknown,
  params: RequestParameters = makeParams(
    "query SomeThingQuery($id: ID!) { node(id: $id) { id } }",
  ),
) => {
  const fetchFn = generateFetchFn();
  // Relay's FetchFunction takes (params, variables, cacheConfig, uploadables).
  // @ts-expect-error the observable/promise return union is irrelevant here.
  return fetchFn(params, VARIABLES, {}, null);
};

describe("generateFetchFn request shape", () => {
  const originalFetch = global.fetch;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockGetValidIdentity.mockClear();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    global.fetch = jest.fn().mockResolvedValue({
      json: jest.fn().mockResolvedValue({ data: { node: { id: "1" } } }),
    }) as unknown as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
  });

  it("refreshes the identity before every request", async () => {
    await runFetch(null);
    expect(mockGetValidIdentity).toHaveBeenCalledTimes(1);
  });

  it("POSTs the query and variables to the Rails /graphql endpoint with the CSRF token", async () => {
    await runFetch(null);

    const [url, init] = (global.fetch as jest.Mock).mock.calls[0];
    expect(url).toBe("/graphql");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual([
      ["Content-Type", "application/json"],
      ["X-CSRF-Token", "csrf-abc123"],
    ]);
    expect(JSON.parse(init.body)).toEqual({
      query: "query SomeThingQuery($id: ID!) { node(id: $id) { id } }",
      variables: { id: "1" },
    });
  });

  it("returns the parsed response body verbatim", async () => {
    const result = await runFetch(null);
    expect(result).toEqual({ data: { node: { id: "1" } } });
  });

  it("stays quiet when the response carries no errors key", async () => {
    await runFetch(null);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("logs the extracted operation name when the response carries errors", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest
        .fn()
        .mockResolvedValue({ data: null, errors: [{ message: "boom" }] }),
    }) as unknown as typeof global.fetch;

    await runFetch(null);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[GQL Error] SomeThingQuery",
      expect.objectContaining({ errors: [{ message: "boom" }] }),
    );
  });

  it("logs an undefined operation name when the query text does not match the name regex", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest
        .fn()
        .mockResolvedValue({ data: null, errors: [{ message: "boom" }] }),
    }) as unknown as typeof global.fetch;

    // No "query <Name>(" prefix, so QUERY_NAME_REGEX finds nothing.
    await runFetch(null, makeParams("{ node { id } }"));

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[GQL Error] undefined",
      expect.any(Object),
    );
  });

  it("extracts a mutation name too", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      json: jest
        .fn()
        .mockResolvedValue({ data: null, errors: [{ message: "boom" }] }),
    }) as unknown as typeof global.fetch;

    await runFetch(
      null,
      makeParams("mutation KickoffRunMutation($id: ID!) { kickoff(id: $id) }"),
    );

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "[GQL Error] KickoffRunMutation",
      expect.any(Object),
    );
  });
});

describe("createEnvironment", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("returns a Relay environment backed by a store and a network", () => {
    const environment = createEnvironment();

    expect(typeof environment.execute).toBe("function");
    const store = environment.getStore();
    expect(store).toBeDefined();
    // A fresh RecordSource has no user records in it yet.
    expect(typeof store.getSource().toJSON()).toBe("object");
  });

  it("hands back a distinct environment on every call", () => {
    const a = createEnvironment();
    const b = createEnvironment();
    expect(a).not.toBe(b);
    expect(a.getStore()).not.toBe(b.getStore());
  });
});
