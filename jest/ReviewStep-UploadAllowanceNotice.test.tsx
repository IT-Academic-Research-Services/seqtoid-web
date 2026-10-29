// Coverage: .../ReviewStep/components/UploadAllowanceNotice/UploadAllowanceNotice.tsx
//
// Before an upload starts, the review step shows how many samples the user can still upload this
// week by this method (GET /samples/upload_allowance), and holds back an upload that would go over
// it. Fail-open: no allowance (error, unlimited, unlimited method) => nothing shown, nothing blocked.
const mockGetUploadAllowance = jest.fn();
jest.mock("~/api/upload", () => ({
  getUploadAllowance: (...args: any[]) => mockGetUploadAllowance(...args),
}));

jest.mock("~/components/ui/controls/ExternalLink", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: ({
      children,
      href,
    }: {
      children: React.ReactNode;
      href: string;
    }) => ReactLib.createElement("a", { href }, children),
  };
});

import { render, screen, waitFor } from "@testing-library/react";
import React from "react";
import {
  formatAllowanceReset,
  UploadAllowanceNotice,
} from "~/components/views/SampleUploadFlow/components/ReviewStep/components/UploadAllowanceNotice/UploadAllowanceNotice";

// Week of Sun Oct 25 2026; resets Sun Nov 1 00:00 Pacific (still PDT, -07:00).
const allowance = (overrides: Record<string, unknown> = {}) => ({
  week_start: "2026-10-25",
  resets_at: "2026-11-01T00:00:00-07:00",
  unlimited: false,
  limits: { web: 200, cli: 1000, s3: null, basespace: null, total: 1200 },
  used: { web: 150, cli: 0, s3: 0, basespace: 0, total: 150 },
  remaining: { web: 50, cli: 1000, s3: 1000, basespace: 1000 },
  ...overrides,
});

const renderNotice = (uploadType: string, sampleCount: number) => {
  const onExceededChange = jest.fn();
  const utils = render(
    <UploadAllowanceNotice
      uploadType={uploadType}
      sampleCount={sampleCount}
      onExceededChange={onExceededChange}
    />,
  );
  return { ...utils, onExceededChange };
};

beforeEach(() => jest.clearAllMocks());

describe("UploadAllowanceNotice", () => {
  it("shows what is left this week and does not block an upload that fits", async () => {
    mockGetUploadAllowance.mockResolvedValue(allowance());
    const { onExceededChange } = renderNotice("local", 50);

    expect(
      await screen.findByText(
        "You can upload 50 more samples this week with the web uploader. The limit resets on Sunday, November 1 at 12:00 AM Pacific.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onExceededChange).toHaveBeenLastCalledWith(false);
  });

  it("explains and blocks an upload that would go over the allowance", async () => {
    mockGetUploadAllowance.mockResolvedValue(allowance());
    const { onExceededChange } = renderNotice("local", 51);

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toBe(
      "This upload has 51 samples, but you can upload only 50 more samples this week with the web uploader. " +
        "Remove some samples, or upload the rest after the limit resets on Sunday, November 1 at 12:00 AM Pacific. " +
        "Contact us if you need a higher limit.",
    );
    await waitFor(() =>
      expect(onExceededChange).toHaveBeenLastCalledWith(true),
    );
  });

  it("describes the shared CLI / S3 / BaseSpace allowance for an S3 import", async () => {
    mockGetUploadAllowance.mockResolvedValue(
      allowance({ remaining: { web: 50, cli: 1, s3: 1, basespace: 1 } }),
    );
    renderNotice("remote", 1);

    expect(
      await screen.findByText(
        /You can upload 1 more sample this week with the SeqtoID CLI, S3 import and BaseSpace import combined\./,
      ),
    ).toBeTruthy();
  });

  it("uses BaseSpace's own allowance when it has its own limit", async () => {
    mockGetUploadAllowance.mockResolvedValue(
      allowance({
        limits: { web: 200, cli: 1000, s3: null, basespace: 300, total: null },
        remaining: { web: 50, cli: 1000, s3: 1000, basespace: 300 },
      }),
    );
    renderNotice("basespace", 10);

    expect(
      await screen.findByText(
        /300 more samples this week by BaseSpace import\./,
      ),
    ).toBeTruthy();
  });

  it("shows nothing and blocks nothing when the user has no limits", async () => {
    mockGetUploadAllowance.mockResolvedValue(
      allowance({
        unlimited: true,
        remaining: { web: null, cli: null, s3: null, basespace: null },
      }),
    );
    const { container, onExceededChange } = renderNotice("local", 5000);

    await waitFor(() => expect(mockGetUploadAllowance).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    expect(onExceededChange).not.toHaveBeenCalledWith(true);
  });

  it("shows nothing and blocks nothing when this method has no limit", async () => {
    mockGetUploadAllowance.mockResolvedValue(
      allowance({
        remaining: { web: null, cli: 1000, s3: 1000, basespace: 1000 },
      }),
    );
    const { container, onExceededChange } = renderNotice("local", 5000);

    await waitFor(() => expect(mockGetUploadAllowance).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    expect(onExceededChange).not.toHaveBeenCalledWith(true);
  });

  it("fails open when the allowance cannot be loaded", async () => {
    mockGetUploadAllowance.mockRejectedValue(new Error("network"));
    const { container, onExceededChange } = renderNotice("local", 5000);

    await waitFor(() => expect(mockGetUploadAllowance).toHaveBeenCalled());
    expect(container.textContent).toBe("");
    expect(onExceededChange).not.toHaveBeenCalledWith(true);
  });
});

describe("formatAllowanceReset", () => {
  it("formats the reset in Pacific time across the DST change", () => {
    // Nov 8 2026 is after DST ends (PST, -08:00).
    expect(formatAllowanceReset("2026-11-08T00:00:00-08:00")).toBe(
      "on Sunday, November 8 at 12:00 AM Pacific",
    );
  });

  it("falls back to plain wording for an unparseable date", () => {
    expect(formatAllowanceReset("not a date")).toBe(
      "at the start of next week",
    );
  });
});
