// Coverage: app/assets/src/components/views/SampleUploadFlow/components/ReviewStep/
//   components/SampleInfo/components/AdminUploadOptions/AdminUploadOptions.tsx
//
// AdminUploadOptions is a collapsible admin-only form over a fixed table of
// pipeline override options. Its branches are the collapsed/expanded toggle
// ("Show options" vs "Hide options"), the `adminOptions[key] || ""` fallback for
// options with no value yet, and handleChange, which must produce a NEW options
// object (lodash/fp `set`) rather than mutating the prop.
//
// Input and HelpIcon are stubbed with minimal DOM so assertions land on this
// file's own logic instead of the shared control internals.
import { fireEvent, render } from "@testing-library/react";

jest.mock("~ui/containers/HelpIcon", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <span data-testid="help-icon" data-text={props.text} />
  ),
}));

jest.mock("~ui/controls/Input", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => (
    <input
      data-testid={`input-${props.placeholder}`}
      value={props.value}
      placeholder={String(props.placeholder)}
      onChange={e => props.onChange(e.target.value)}
    />
  ),
}));

import AdminUploadOptions from "~/components/views/SampleUploadFlow/components/ReviewStep/components/SampleInfo/components/AdminUploadOptions/AdminUploadOptions";

const OPTION_KEYS = [
  "max_input_fragments",
  "subsample",
  "pipeline_branch",
  "alignment_config_name",
  "s3_preload_result_path",
  "alignment_scalability",
];

const renderOptions = (adminOptions: Record<string, string> = {}) => {
  const onAdminOptionsChanged = jest.fn();
  const utils = render(
    <AdminUploadOptions
      adminOptions={adminOptions}
      onAdminOptionsChanged={onAdminOptionsChanged}
    />,
  );
  return { ...utils, onAdminOptionsChanged };
};

describe("AdminUploadOptions collapse toggle", () => {
  it("starts collapsed showing only the subheader and the Show link", () => {
    const { container, getByText } = renderOptions();

    expect(container.textContent).toContain("Admin options");
    expect(getByText("Show options")).toBeTruthy();
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(
      container.querySelectorAll("[data-testid='help-icon']"),
    ).toHaveLength(0);
  });

  it("expands to every admin option and flips the link to Hide", () => {
    const { container, getByText } = renderOptions();

    fireEvent.click(getByText("Show options"));

    expect(container.querySelectorAll("input")).toHaveLength(
      OPTION_KEYS.length,
    );
    OPTION_KEYS.forEach(key => {
      expect(container.textContent).toContain(key);
    });
    expect(getByText("Hide options")).toBeTruthy();
  });

  it("collapses again on a second click", () => {
    const { container, getByText } = renderOptions();
    fireEvent.click(getByText("Show options"));
    expect(container.querySelectorAll("input").length).toBeGreaterThan(0);

    fireEvent.click(getByText("Hide options"));
    expect(container.querySelectorAll("input")).toHaveLength(0);
    expect(getByText("Show options")).toBeTruthy();
  });
});

describe("AdminUploadOptions field values", () => {
  it("falls back to an empty value for options that are unset", () => {
    const { container, getByText } = renderOptions({});
    fireEvent.click(getByText("Show options"));

    const inputs = Array.from(container.querySelectorAll("input"));
    expect(inputs.every(input => input.value === "")).toBe(true);
  });

  it("renders the stored value for options that are set", () => {
    const { getByTestId, getByText } = renderOptions({
      subsample: "500000",
      pipeline_branch: "my-branch",
    });
    fireEvent.click(getByText("Show options"));

    expect((getByTestId("input-1000000") as HTMLInputElement).value).toBe(
      "500000",
    );
    expect((getByTestId("input-6.9.1") as HTMLInputElement).value).toBe(
      "my-branch",
    );
    // An option with no stored value still falls back to "".
    expect((getByTestId("input-false") as HTMLInputElement).value).toBe("");
  });

  it("passes the option help text through to the help icon", () => {
    const { container, getByText } = renderOptions();
    fireEvent.click(getByText("Show options"));

    const icons = Array.from(
      container.querySelectorAll("[data-testid='help-icon']"),
    );
    expect(icons).toHaveLength(OPTION_KEYS.length);
    expect(icons[1].getAttribute("data-text")).toContain("randomly subsample");
  });
});

describe("AdminUploadOptions change handling", () => {
  it("reports a new options object merged with the edited key", () => {
    const adminOptions = { subsample: "100" };
    const { getByTestId, getByText, onAdminOptionsChanged } =
      renderOptions(adminOptions);
    fireEvent.click(getByText("Show options"));

    fireEvent.change(getByTestId("input-6.9.1"), {
      target: { value: "release-8" },
    });

    expect(onAdminOptionsChanged).toHaveBeenCalledTimes(1);
    const next = onAdminOptionsChanged.mock.calls[0][0];
    expect(next).toEqual({ subsample: "100", pipeline_branch: "release-8" });
    // lodash/fp set is non-mutating: the original prop is untouched.
    expect(adminOptions).toEqual({ subsample: "100" });
    expect(next).not.toBe(adminOptions);
  });

  it("overwrites an existing value for the same key", () => {
    const { getByTestId, getByText, onAdminOptionsChanged } = renderOptions({
      subsample: "100",
    });
    fireEvent.click(getByText("Show options"));

    fireEvent.change(getByTestId("input-1000000"), {
      target: { value: "250" },
    });

    expect(onAdminOptionsChanged.mock.calls[0][0]).toEqual({
      subsample: "250",
    });
  });
});
