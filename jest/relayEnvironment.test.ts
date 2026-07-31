// CZID-391: the Relay GraphQL fetch client must no longer emit Sentry events for
// request/response logging or for non-fatal, field-level GraphQL `errors`. These were
// captured as Info-level events and flooded the Sentry dashboard (~74 entries). This
// test pins the behavior: neither a successful response nor an error response results in
// a Sentry capture, while error responses still surface via console.error for debugging.

// mock*-prefixed so jest's mock-hoisting allows referencing them inside jest.mock().
const mockCaptureMessage = jest.fn();
const mockCaptureException = jest.fn();
jest.mock("@sentry/browser", () => ({
  captureMessage: (...args: unknown[]) => mockCaptureMessage(...args),
  captureException: (...args: unknown[]) => mockCaptureException(...args),
}));

// Stub the identity + CSRF dependencies — irrelevant to the logging behavior under test.
jest.mock("../app/assets/src/relay/identify", () => ({
  getValidIdentity: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("../app/assets/src/api/utils", () => ({
  getCsrfToken: jest.fn().mockReturnValue("test-csrf-token"),
}));

import type { RequestParameters, Variables } from "relay-runtime";
import { generateFetchFn } from "../app/assets/src/relay/environment";

const PARAMS = {
  text: "query SomeThingQuery($id: ID!) { node(id: $id) { id } }",
  name: "SomeThingQuery",
  operationKind: "query",
  metadata: {},
  id: null,
  cacheID: "abc",
} as unknown as RequestParameters;

const VARIABLES: Variables = { id: "1" };

const invokeFetch = async (responseBody: unknown) => {
  global.fetch = jest.fn().mockResolvedValue({
    json: jest.fn().mockResolvedValue(responseBody),
  }) as unknown as typeof global.fetch;

  const fetchFn = generateFetchFn();
  // Relay's FetchFunction takes (params, variables, cacheConfig, uploadables).
  // @ts-expect-error the observable/promise return union is irrelevant here.
  return fetchFn(PARAMS, VARIABLES, {}, null);
};

describe("generateFetchFn Sentry noise (CZID-391)", () => {
  const originalFetch = global.fetch;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockCaptureMessage.mockClear();
    mockCaptureException.mockClear();
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    global.fetch = originalFetch;
    consoleErrorSpy.mockRestore();
  });

  it("does NOT send a Sentry event on a successful response", async () => {
    await invokeFetch({ data: { node: { id: "1" } } });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("does NOT send a Sentry event on a PARTIAL error (field-level errors alongside usable data)", async () => {
    // Partial/field-level errors ride with valid `data` (permission-filtered fields,
    // deprecations). CZID-391: these are not application failures -- console only, no Sentry,
    // and (SMP-1494) no throw, since the caller still has usable data to render.
    const result = await invokeFetch({
      data: { node: { id: "1" } },
      errors: [{ message: "Field 'foo' doesn't exist" }],
    });
    expect(result).toEqual({
      data: { node: { id: "1" } },
      errors: [{ message: "Field 'foo' doesn't exist" }],
    });
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
    // Debug value is retained locally via console.error.
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[GQL Error]"),
      expect.objectContaining({
        errors: [{ message: "Field 'foo' doesn't exist" }],
      }),
    );
  });

  // SMP-1494: a FATAL response (errors present AND no usable `data`) must THROW so Relay
  // rejects the operation and the caller's catch reports the ACTUAL GraphQL errors to Sentry
  // -- instead of the caller throwing an opaque "Missing data: {}" with the real cause lost
  // to the console. generateFetchFn itself still never calls Sentry (CZID-391 preserved).
  it("THROWS with the query name + errors on a FATAL response (data: null)", async () => {
    await expect(
      invokeFetch({ data: null, errors: [{ message: "Field 'foo' doesn't exist" }] }),
    ).rejects.toThrow(/SomeThingQuery/);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("[GQL Error]"),
      expect.objectContaining({
        errors: [{ message: "Field 'foo' doesn't exist" }],
      }),
    );
  });

  it("THROWS on a FATAL response where data collapsed to {} (the DEV-REACTJS-5 shape)", async () => {
    await expect(
      invokeFetch({ data: {}, errors: [{ message: "fedWorkflowRuns resolver failed" }] }),
    ).rejects.toThrow(/fedWorkflowRuns resolver failed/);
    expect(mockCaptureMessage).not.toHaveBeenCalled();
    expect(mockCaptureException).not.toHaveBeenCalled();
  });
});
