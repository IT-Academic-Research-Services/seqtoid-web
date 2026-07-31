import { generateFetchFn } from "~/relay/environment";

// generateFetchFn awaits getValidIdentity() and reads getCsrfToken(); stub both so the
// fetch function can be exercised directly (CZID-391 exported it for this purpose).
jest.mock("~/relay/identify", () => ({
  getValidIdentity: jest.fn().mockResolvedValue(undefined),
}));
jest.mock("~/api/utils", () => ({
  getCsrfToken: jest.fn().mockReturnValue("csrf-token"),
}));

const params = { text: "query DiscoveryViewFCWorkflowsQuery( $input: X ) { fedWorkflowRuns { id } }" };
const variables = {};

const mockFetchResolving = (payload: unknown) => {
  global.fetch = jest.fn().mockResolvedValue({
    json: async () => payload,
  }) as unknown as typeof fetch;
};

describe("generateFetchFn (SMP-1494: fatal vs partial GraphQL errors)", () => {
  let consoleErrorSpy: jest.SpyInstance;
  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);
  });
  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  it("returns the response unchanged when there are no errors", async () => {
    const payload = { data: { fedWorkflowRuns: [{ id: "1" }] } };
    mockFetchResolving(payload);
    const fetchFn = generateFetchFn();
    await expect(fetchFn(params as $TSFixMe, variables)).resolves.toEqual(payload);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("returns the response (console-only) for a PARTIAL error: errors present but data usable", async () => {
    // Field-level / permission-filtered errors alongside valid data -- not fatal, must not throw.
    const payload = {
      data: { fedWorkflowRuns: [{ id: "1" }] },
      errors: [{ message: "permission-filtered field" }],
    };
    mockFetchResolving(payload);
    const fetchFn = generateFetchFn();
    await expect(fetchFn(params as $TSFixMe, variables)).resolves.toEqual(payload);
    expect(consoleErrorSpy).toHaveBeenCalled();
  });

  it("THROWS with the query name + errors for a FATAL error: errors present and data is {}", async () => {
    // This is the DEV-REACTJS-5 shape: data collapses to {} and the real cause was discarded.
    const payload = {
      data: {},
      errors: [{ message: "fedWorkflowRuns resolver blew up" }],
    };
    mockFetchResolving(payload);
    const fetchFn = generateFetchFn();
    await expect(fetchFn(params as $TSFixMe, variables)).rejects.toThrow(
      /DiscoveryViewFCWorkflowsQuery/,
    );
    await expect(
      generateFetchFn()(params as $TSFixMe, variables),
    ).rejects.toThrow(/fedWorkflowRuns resolver blew up/);
  });

  it("THROWS for a FATAL error when data is null", async () => {
    const payload = { data: null, errors: [{ message: "boom" }] };
    mockFetchResolving(payload);
    const fetchFn = generateFetchFn();
    await expect(fetchFn(params as $TSFixMe, variables)).rejects.toThrow(/no data/);
  });
});
