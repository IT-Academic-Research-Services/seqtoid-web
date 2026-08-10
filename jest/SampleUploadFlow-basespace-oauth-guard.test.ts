// SMP-1458: openBasespaceOAuthPopup is the single chokepoint every Basespace
// authorization flow passes through. When an environment has no Basespace OAuth
// credentials the client id and redirect uri arrive as empty strings, and the
// popup used to be opened anyway -- producing an Illumina error page and no
// telemetry at all, which is indistinguishable from "Basespace upload is
// broken". Guarding here means no code path, present or future, can open the
// popup with an empty client id.
import { openUrlInPopupWindow } from "~/components/utils/links";
import {
  isBasespaceOAuthConfigured,
  openBasespaceOAuthPopup,
} from "~/components/views/SampleUploadFlow/utils";

jest.mock("~/components/utils/links", () => ({
  openUrlInPopupWindow: jest.fn(() => ({ name: "popup" })),
}));

const mockedOpenPopupWindow = openUrlInPopupWindow as unknown as jest.Mock;

describe("isBasespaceOAuthConfigured", () => {
  it("is true only when both OAuth values are non-empty", () => {
    expect(isBasespaceOAuthConfigured("id", "https://redirect")).toBe(true);
  });

  it.each([
    ["empty client id", "", "https://redirect"],
    ["empty redirect uri", "id", ""],
    ["both empty", "", ""],
    ["undefined client id", undefined, "https://redirect"],
    ["undefined redirect uri", "id", undefined],
    ["null client id", null, "https://redirect"],
  ])("is false with %s", (_label, clientId, redirectUri) => {
    expect(isBasespaceOAuthConfigured(clientId, redirectUri)).toBe(false);
  });
});

describe("openBasespaceOAuthPopup", () => {
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    consoleError = jest
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("opens the Illumina authorize URL when configured", () => {
    const result = openBasespaceOAuthPopup({
      client_id: "id",
      redirect_uri: "https://redirect",
      scope: "browse+global",
    });

    expect(mockedOpenPopupWindow).toHaveBeenCalledTimes(1);
    const url = mockedOpenPopupWindow.mock.calls[0][0];
    expect(url).toContain("https://basespace.illumina.com/oauth/authorize");
    expect(url).toContain("client_id=id");
    expect(url).toContain("response_type=code");
    expect(result).toEqual({ name: "popup" });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it.each([
    ["empty client id", { client_id: "", redirect_uri: "https://redirect" }],
    ["empty redirect uri", { client_id: "id", redirect_uri: "" }],
    ["both empty", { client_id: "", redirect_uri: "" }],
    ["missing client id", { redirect_uri: "https://redirect" }],
  ])("refuses to open the popup and logs loudly with %s", (_label, params) => {
    const result = openBasespaceOAuthPopup({
      ...params,
      scope: "browse+global",
    });

    expect(mockedOpenPopupWindow).not.toHaveBeenCalled();
    expect(result).toBeNull();
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("Basespace OAuth is not configured"),
    );
  });
});
