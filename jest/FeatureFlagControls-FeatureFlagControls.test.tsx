// Coverage for
// app/assets/src/components/views/AdminSettings/components/FeatureFlagControls/FeatureFlagControls.tsx
//
// The admin feature-flag panel loads the launched/allowed flag lists on mount,
// seeds the user list from the logged-in admin's email, and on Add/Remove calls
// the modify API and translates its response into a callout whose intent
// (error / warning / success) depends on which buckets came back. The two API
// calls are mocked; the child FeatureFlagList is stubbed so the assertions land
// on this file's response-to-callout state machine and the every-bucket
// branches. The SDS widgets otherwise render for real.
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { getLaunchedFeatureList, modifyFeatureFlagForUsers } from "~/api/index";
import { UserContext } from "~/components/common/UserContext";
import { FeatureFlagControls } from "~/components/views/AdminSettings/components/FeatureFlagControls/FeatureFlagControls";

jest.mock("~/api/index", () => ({
  getLaunchedFeatureList: jest.fn(),
  modifyFeatureFlagForUsers: jest.fn(),
}));

// Stub the child list so we can read the props FeatureFlagControls computes
// (unlaunched = every feature minus the launched ones) without rendering SDS
// icons, and drive the selected-flag setter directly.
jest.mock(
  "~/components/views/AdminSettings/components/FeatureFlagControls/FeatureFlagList",
  () => {
    const ReactLib = require("react");
    return {
      FeatureFlagList: (props: $TSFixMe) =>
        ReactLib.createElement(
          "div",
          { "data-testid": "flag-list" },
          ReactLib.createElement(
            "span",
            { "data-testid": "flag-names" },
            JSON.stringify(props.flagNames),
          ),
          ReactLib.createElement(
            "span",
            { "data-testid": "enabled-flags" },
            JSON.stringify(props.enabledFlags),
          ),
          ReactLib.createElement("button", {
            "data-testid": "pick-flag",
            onClick: () => props.setSelectedFeatureFlag("pickedFlag"),
          }),
        ),
    };
  },
);

const _React: typeof React = React;

const mockedGetList = getLaunchedFeatureList as jest.Mock;
const mockedModify = modifyFeatureFlagForUsers as jest.Mock;

const emptyResponse = {
  usersThatAlredyHadFeatureFlag: [],
  usersWithNoAccounts: [],
  usersWithUpdatedFeatureFlags: [],
};

function renderPanel(userEmail = "admin@example.com") {
  return render(
    <UserContext.Provider value={{ userEmail } as $TSFixMe}>
      <FeatureFlagControls />
    </UserContext.Provider>,
  );
}

beforeEach(() => {
  mockedGetList.mockReset();
  mockedModify.mockReset();
  mockedGetList.mockResolvedValue({
    launched_feature_list: [],
    allowed_feature_list: [],
  });
});

function addButton() {
  return screen.getByRole("button", { name: /Add feature flag/i });
}
function removeButton() {
  return screen.getByRole("button", { name: /Remove feature flag/i });
}
function featureFlagField() {
  return document.getElementById("feature") as HTMLInputElement;
}

describe("FeatureFlagControls", () => {
  it("fetches the launched/allowed lists on mount and derives unlaunched flags", async () => {
    mockedGetList.mockResolvedValue({
      launched_feature_list: ["AMR"],
      allowed_feature_list: ["benchmarking"],
    });
    renderPanel();

    await waitFor(() => expect(mockedGetList).toHaveBeenCalled());
    // "AMR" is launched, so it must be excluded from the flag list; the allowed
    // list is forwarded verbatim.
    await waitFor(() =>
      expect(screen.getByTestId("flag-names").textContent).not.toContain(
        '"AMR"',
      ),
    );
    expect(screen.getByTestId("enabled-flags").textContent).toContain(
      "benchmarking",
    );
  });

  it("does not call the API when no feature flag is set", () => {
    renderPanel();
    fireEvent.click(addButton());
    expect(mockedModify).not.toHaveBeenCalled();
  });

  it("shows a success callout and trims/splits the user emails when only updates return", async () => {
    mockedModify.mockResolvedValue({
      ...emptyResponse,
      usersWithUpdatedFeatureFlags: ["a@x.com"],
    });
    renderPanel();

    fireEvent.change(featureFlagField(), { target: { value: "myFlag" } });
    // Provide two emails with surrounding whitespace to hit the trim/split map.
    const usersField = document.getElementById("users") as HTMLTextAreaElement;
    fireEvent.change(usersField, { target: { value: " a@x.com , b@y.com " } });

    fireEvent.click(addButton());

    expect(
      await screen.findByText(/Successfully added feature flag for a@x.com/),
    ).toBeTruthy();
    expect(mockedModify).toHaveBeenCalledWith({
      featureFlag: "myFlag",
      action: "add",
      userEmails: ["a@x.com", "b@y.com"],
    });
  });

  it("shows a warning callout when some users already had the flag or lacked accounts", async () => {
    mockedModify.mockResolvedValue({
      usersThatAlredyHadFeatureFlag: ["dup@x.com"],
      usersWithNoAccounts: ["ghost@x.com"],
      usersWithUpdatedFeatureFlags: ["new@x.com"],
    });
    renderPanel();

    fireEvent.change(featureFlagField(), { target: { value: "myFlag" } });
    fireEvent.click(addButton());

    expect(
      await screen.findByText(/do not have accounts: ghost@x.com/),
    ).toBeTruthy();
    expect(
      screen.getByText(/already had the feature flag: dup@x.com/),
    ).toBeTruthy();
  });

  it("uses the 'remove' past tense and no success message when nothing updated (error intent)", async () => {
    mockedModify.mockResolvedValue({
      ...emptyResponse,
      usersWithNoAccounts: ["ghost@x.com"],
    });
    renderPanel();

    fireEvent.change(featureFlagField(), { target: { value: "myFlag" } });
    fireEvent.click(removeButton());

    // Nothing was updated -> no "Successfully removed" line, only the accounts warning.
    expect(
      await screen.findByText(/do not have accounts: ghost@x.com/),
    ).toBeTruthy();
    expect(mockedModify).toHaveBeenCalledWith(
      expect.objectContaining({ action: "remove" }),
    );
    expect(screen.queryByText(/Successfully remove/)).toBeNull();
  });

  it("lets the child list pick a flag which is then submitted", async () => {
    mockedModify.mockResolvedValue({
      ...emptyResponse,
      usersWithUpdatedFeatureFlags: ["a@x.com"],
    });
    renderPanel();

    fireEvent.click(screen.getByTestId("pick-flag"));
    fireEvent.click(addButton());

    await waitFor(() =>
      expect(mockedModify).toHaveBeenCalledWith(
        expect.objectContaining({ featureFlag: "pickedFlag" }),
      ),
    );
  });
});
