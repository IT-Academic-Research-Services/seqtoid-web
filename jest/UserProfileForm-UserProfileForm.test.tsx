// Coverage: app/assets/src/components/views/UserProfileForm/UserProfileForm.tsx
//
// UserProfileForm is the account-setup container. It holds all field state,
// recomputes submit-disabled via an effect (required fields present + valid
// name characters + name length), and on submit calls updateUserData and
// postToAirtable in parallel then redirects (or alerts on failure). The
// submitButton() helper wraps the button in a tooltip when disabled, choosing
// the tooltip text by which validation failed. Every child field, the two
// APIs, analytics, router history and layout are stubbed so the assertions
// target this file's validation branches and submit flow. The stubbed fields
// expose buttons that push representative values into the form state.
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

const mockUpdateUserData = jest.fn();
const mockPostToAirtable = jest.fn();
jest.mock("~/api/user", () => ({
  updateUserData: (...a: $TSFixMe[]) => mockUpdateUserData(...a),
  postToAirtable: (...a: $TSFixMe[]) => mockPostToAirtable(...a),
}));

const mockHistoryPush = jest.fn();
jest.mock("react-router-dom", () => ({
  useHistory: () => ({ push: mockHistoryPush }),
}));

jest.mock("~/api/analytics", () => ({
  ANALYTICS_EVENT_NAMES: { USER_PROFILE_FORM_COMPLETE_SETUP_CLICKED: "evt" },
  // withAnalytics returns a wrapper that just invokes the underlying handler
  useWithAnalytics: () => (fn: $TSFixMe) => fn,
}));

jest.mock("~/components/layout", () => {
  const ReactLib = require("react");
  return {
    NarrowContainer: (props: $TSFixMe) =>
      ReactLib.createElement("div", null, props.children),
  };
});

jest.mock("@czi-sds/components", () => {
  const ReactLib = require("react");
  return {
    Button: (props: $TSFixMe) =>
      ReactLib.createElement(
        "button",
        {
          "data-testid": "submit-btn",
          type: "button",
          disabled: props.disabled,
          onClick: props.onClick,
        },
        props.children,
      ),
    Icon: () => null,
    Link: (props: $TSFixMe) =>
      ReactLib.createElement("a", { href: props.href }, props.children),
    Tooltip: (props: $TSFixMe) =>
      ReactLib.createElement(
        "span",
        { "data-testid": "submit-tooltip", "data-title": props.title },
        props.children,
      ),
  };
});

// Each field stub exposes a button that fills its slice of form state.
jest.mock("~/components/views/UserProfileForm/components/NameField", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) =>
      ReactLib.createElement(
        "div",
        null,
        ReactLib.createElement("button", {
          "data-testid": "fill-name",
          onClick: () => {
            props.setFirstName("Ada");
            props.setLastName("Lovelace");
          },
        }),
        ReactLib.createElement("button", {
          "data-testid": "fill-bad-name",
          onClick: () => {
            props.setFirstName("Ada1");
            props.setLastName("Lovelace");
          },
        }),
        ReactLib.createElement("button", {
          "data-testid": "fill-long-name",
          onClick: () => {
            props.setFirstName("A".repeat(200));
            props.setLastName("B");
          },
        }),
      ),
  };
});

jest.mock(
  "~/components/views/UserProfileForm/components/CountryFormField",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: $TSFixMe) =>
        ReactLib.createElement("button", {
          "data-testid": "fill-country",
          onClick: () => {
            props.setCountry("USA");
            props.setWorldBankIncome("High");
          },
        }),
    };
  },
);

jest.mock(
  "~/components/views/UserProfileForm/components/InstitutionFormField",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: $TSFixMe) =>
        ReactLib.createElement("button", {
          "data-testid": "fill-institution",
          onClick: () => {
            props.setInstitution("MIT");
            props.setRORId("ror-1");
          },
        }),
    };
  },
);

jest.mock(
  "~/components/views/UserProfileForm/components/CZIDUsecaseFormField",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: $TSFixMe) =>
        ReactLib.createElement("button", {
          "data-testid": "fill-usecase",
          onClick: () => props.setSelectedUsecaseCheckboxes(["Research"]),
        }),
    };
  },
);

jest.mock(
  "~/components/views/UserProfileForm/components/SequencingExpertiseFormField",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: $TSFixMe) =>
        ReactLib.createElement("button", {
          "data-testid": "fill-expertise",
          onClick: () => props.setSelectedSequencingExpertise("Expert"),
        }),
    };
  },
);

jest.mock(
  "~/components/views/UserProfileForm/components/CZIDReferralFormField",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: $TSFixMe) =>
        ReactLib.createElement("button", {
          "data-testid": "fill-referral",
          onClick: () => props.setSelectedReferralCheckboxes(["Colleague"]),
        }),
    };
  },
);

jest.mock(
  "~/components/views/UserProfileForm/components/NewsletterConsentCheckbox",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: $TSFixMe) =>
        ReactLib.createElement("button", {
          "data-testid": "fill-newsletter",
          onClick: () => props.setNewsletterConsent(true),
        }),
    };
  },
);

import { UserContext } from "~/components/common/UserContext";
import { UserProfileForm } from "~/components/views/UserProfileForm/UserProfileForm";

function renderForm() {
  return render(
    <UserContext.Provider value={{ userId: 99 } as $TSFixMe}>
      <UserProfileForm />
    </UserContext.Provider>,
  );
}

// Fills every required field so the submit button becomes enabled.
function fillAllRequired() {
  fireEvent.click(screen.getByTestId("fill-name"));
  fireEvent.click(screen.getByTestId("fill-country"));
  fireEvent.click(screen.getByTestId("fill-institution"));
  fireEvent.click(screen.getByTestId("fill-usecase"));
  fireEvent.click(screen.getByTestId("fill-expertise"));
}

describe("UserProfileForm", () => {
  const originalLocation = window.location;
  beforeAll(() => {
    // jsdom location.reload is not implemented and reload is not configurable
    // on the native location, so swap in a plain replacement for the suite.
    delete (window as $TSFixMe).location;
    (window as $TSFixMe).location = {
      ...originalLocation,
      reload: jest.fn(),
    };
  });
  afterAll(() => {
    (window as $TSFixMe).location = originalLocation;
  });
  beforeEach(() => {
    mockUpdateUserData.mockReset().mockResolvedValue(undefined);
    mockPostToAirtable.mockReset().mockResolvedValue(undefined);
    mockHistoryPush.mockReset();
  });

  it("starts with the submit button disabled and a missing-fields tooltip", () => {
    renderForm();
    expect(
      (screen.getByTestId("submit-btn") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByTestId("submit-tooltip").getAttribute("data-title"),
    ).toBe("Please fill out the first 5 questions to continue.");
  });

  it("enables submit once all required fields are filled with a valid name", () => {
    renderForm();
    act(() => fillAllRequired());
    expect(
      (screen.getByTestId("submit-btn") as HTMLButtonElement).disabled,
    ).toBe(false);
    // no tooltip wrapper when enabled
    expect(screen.queryByTestId("submit-tooltip")).toBeNull();
  });

  it("shows the invalid-character tooltip when the name has digits", () => {
    renderForm();
    act(() => {
      fireEvent.click(screen.getByTestId("fill-bad-name"));
      fireEvent.click(screen.getByTestId("fill-country"));
      fireEvent.click(screen.getByTestId("fill-institution"));
      fireEvent.click(screen.getByTestId("fill-usecase"));
      fireEvent.click(screen.getByTestId("fill-expertise"));
    });
    expect(
      (screen.getByTestId("submit-btn") as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      screen.getByTestId("submit-tooltip").getAttribute("data-title"),
    ).toBe(
      "Only letters, apostrophes, dashes, and spaces are allowed characters for First and Last Name fields.",
    );
  });

  it("shows the name-length tooltip when the full name is too long", () => {
    renderForm();
    act(() => {
      fireEvent.click(screen.getByTestId("fill-long-name"));
      fireEvent.click(screen.getByTestId("fill-country"));
      fireEvent.click(screen.getByTestId("fill-institution"));
      fireEvent.click(screen.getByTestId("fill-usecase"));
      fireEvent.click(screen.getByTestId("fill-expertise"));
    });
    expect(
      screen.getByTestId("submit-tooltip").getAttribute("data-title"),
    ).toBe("First and Last Name fields cannot exceed 127 characters");
  });

  it("submits to both APIs and redirects on success", async () => {
    renderForm();
    act(() => fillAllRequired());
    await act(async () => {
      fireEvent.click(screen.getByTestId("submit-btn"));
    });
    await waitFor(() => expect(mockHistoryPush).toHaveBeenCalled());
    expect(mockUpdateUserData).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 99, name: "Ada Lovelace" }),
    );
    expect(mockPostToAirtable).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 99,
        firstName: "Ada",
        lastName: "Lovelace",
        country: "USA",
        rorInstitution: "MIT",
      }),
    );
    expect(mockHistoryPush).toHaveBeenCalledWith(
      expect.stringContaining("profile_form_submitted=true"),
    );
  });

  it("alerts and re-enables submit when an API call rejects", async () => {
    mockPostToAirtable.mockRejectedValueOnce(new Error("nope"));
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    renderForm();
    act(() => fillAllRequired());
    await act(async () => {
      fireEvent.click(screen.getByTestId("submit-btn"));
    });
    await waitFor(() =>
      expect(alertSpy).toHaveBeenCalledWith(expect.stringContaining("nope")),
    );
    expect(mockHistoryPush).not.toHaveBeenCalled();
    // button gets re-enabled after failure
    await waitFor(() =>
      expect(
        (screen.getByTestId("submit-btn") as HTMLButtonElement).disabled,
      ).toBe(false),
    );
    alertSpy.mockRestore();
  });

  it("renders the privacy policy link", () => {
    renderForm();
    const link = screen.getByText("here.").closest("a");
    expect(link?.getAttribute("href")).toBe("/privacy");
  });
});
