// Coverage: app/assets/src/components/common/Header/UserMenuDropDown.tsx
//
// The component's real work is renderItems(): it assembles a dropdown item
// list whose contents depend on the adminUser flag, and wires the Logout item
// to a signOut() that clears sessionStorage and POSTs (with CSRF) to the
// sign-out endpoint. BareDropdown is stubbed so the assembled item list is
// rendered eagerly and can be asserted on without opening a Semantic UI menu.
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("~ui/controls/dropdowns/BareDropdown", () => {
  const ReactLib = require("react");
  const Item = ({ text, onClick }: $TSFixMe) =>
    ReactLib.createElement(
      "div",
      { "data-testid": "dropdown-item", onClick },
      text,
    );
  const Divider = () =>
    ReactLib.createElement("hr", { "data-testid": "dropdown-divider" });
  const Stub = ({ trigger, items, className, direction }: $TSFixMe) =>
    ReactLib.createElement(
      "div",
      {
        "data-testid": "bare-dropdown",
        "data-classname": String(className),
        "data-direction": String(direction),
      },
      trigger,
      items,
    );
  Stub.Item = Item;
  Stub.Divider = Divider;
  return { __esModule: true, default: Stub };
});

const mockPostToUrlWithCSRF = jest.fn();
jest.mock("~utils/links", () => ({
  __esModule: true,
  ...jest.requireActual("~utils/links"),
  postToUrlWithCSRF: (...args: unknown[]) => mockPostToUrlWithCSRF(...args),
}));

import UserMenuDropDown, {
  PrivacyDropdownItem,
  TermsDropdownItem,
  TermsMenuDropDown,
} from "~/components/common/Header/UserMenuDropDown";

const hrefs = () =>
  Array.from(document.querySelectorAll("a")).map(a => a.getAttribute("href"));

describe("UserMenuDropDown", () => {
  beforeEach(() => {
    mockPostToUrlWithCSRF.mockClear();
    sessionStorage.clear();
  });

  it("renders the non-admin item set without the admin entries", () => {
    render(
      <UserMenuDropDown
        adminUser={false}
        signOutEndpoint="/auth0/logout"
        userName="Ada"
      />,
    );

    expect(screen.getByText("Ada")).toBeTruthy();
    const links = hrefs();
    expect(links).toContain("/bulk_downloads");
    expect(links).not.toContain("/admin/settings");
    expect(screen.queryByTestId("list-users")).toBeNull();
    // Terms + privacy are always appended.
    expect(links).toContain("/terms");
    expect(links).toContain("/privacy");
    expect(screen.getByText("Logout")).toBeTruthy();
    // Two dividers: one before terms, one before logout.
    expect(screen.getAllByTestId("dropdown-divider")).toHaveLength(2);
  });

  it("adds admin settings and list-users entries for an admin", () => {
    render(
      <UserMenuDropDown
        adminUser={true}
        signOutEndpoint="/auth0/logout"
        userName="Grace Hopper"
      />,
    );

    const links = hrefs();
    expect(links).toContain("/admin/settings");
    const listUsers = screen.getByTestId("list-users");
    expect(listUsers.getAttribute("href")).toBe(
      "/users?search_by=Grace Hopper",
    );
    // Admin arm adds two items on top of the non-admin set.
    expect(screen.getAllByTestId("dropdown-item").length).toBeGreaterThan(5);
  });

  it("clears sessionStorage and posts to the sign out endpoint on Logout", () => {
    sessionStorage.setItem("stale", "value");
    render(
      <UserMenuDropDown
        adminUser={false}
        signOutEndpoint="/auth0/logout"
        userName="Ada"
      />,
    );

    fireEvent.click(screen.getByText("Logout"));

    expect(sessionStorage.getItem("stale")).toBeNull();
    expect(mockPostToUrlWithCSRF).toHaveBeenCalledWith("/auth0/logout");
  });

  it("treats an omitted adminUser prop as non-admin", () => {
    render(<UserMenuDropDown signOutEndpoint="/out" userName="Ada" />);

    expect(hrefs()).not.toContain("/admin/settings");
  });

  it("TermsMenuDropDown renders only the terms and privacy items", () => {
    render(<TermsMenuDropDown />);

    expect(screen.getByText("Terms")).toBeTruthy();
    expect(hrefs()).toEqual(["/terms", "/privacy"]);
    expect(screen.getAllByTestId("dropdown-item")).toHaveLength(2);
  });

  it("exports reusable terms and privacy dropdown items", () => {
    expect(TermsDropdownItem.key).toBe("terms_of_service");
    expect(PrivacyDropdownItem.key).toBe("privacy_notice");
  });
});
