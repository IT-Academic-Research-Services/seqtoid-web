// Coverage: app/assets/src/components/common/Header/MainMenu.tsx
//
// MainMenu is the signed-in top nav. It has two whole-component arms
// (signed-out help-center-only vs the signed-in tab strip), an admin-only
// "All Data" tab, and a per-tab isSelected() check driven by
// window.location.pathname. Each arm and each isSelected() branch is driven
// below by moving the jsdom URL before rendering.
import { render, screen } from "@testing-library/react";
import MainMenu from "~/components/common/Header/MainMenu";

const setPath = (path: string) => window.history.pushState({}, "", path);

describe("MainMenu", () => {
  afterEach(() => setPath("/"));

  it("renders only the help center link when the user is signed out", () => {
    render(<MainMenu adminUser={false} userSignedIn={false} />);

    const help = screen.getByTestId("menu-item-help-center");
    expect(help.textContent).toBe("Help Center");
    // None of the signed-in tabs should be present on the logged-out arm.
    expect(screen.queryByTestId("top-menu")).toBeNull();
    expect(screen.queryByTestId("menu-item-mydata")).toBeNull();
    expect(screen.queryByTestId("menu-item-public")).toBeNull();
    expect(screen.queryByTestId("menu-item-upload")).toBeNull();
  });

  it("renders the signed-in tabs without All Data for a non-admin", () => {
    render(<MainMenu adminUser={false} userSignedIn={true} />);

    expect(screen.getByTestId("top-menu")).toBeTruthy();
    expect(screen.getByTestId("menu-item-mydata").getAttribute("href")).toBe(
      "/my_data",
    );
    expect(screen.getByTestId("menu-item-public").getAttribute("href")).toBe(
      "/public",
    );
    expect(screen.getByTestId("menu-item-upload").getAttribute("href")).toBe(
      "/samples/upload",
    );
    // Admin-only tab is gated off.
    expect(screen.queryByTestId("menu-item-all-data")).toBeNull();
    // The signed-out link is not rendered on this arm.
    expect(screen.queryByTestId("menu-item-help-center")).toBeNull();
  });

  it("adds the All Data tab for an admin user", () => {
    render(<MainMenu adminUser={true} userSignedIn={true} />);

    const allData = screen.getByTestId("menu-item-all-data");
    expect(allData.getAttribute("href")).toBe("/all_data");
    expect(allData.textContent).toBe("All Data");
  });

  it("keeps the full tab set when the current path matches My Data", () => {
    setPath("/my_data?foo=1");
    render(<MainMenu adminUser={true} userSignedIn={true} />);

    // isSelected() takes its true arm for My Data and its false arm for the rest.
    expect(screen.getByTestId("menu-item-mydata").textContent).toBe("My Data");
    expect(screen.getByTestId("menu-item-public").textContent).toBe("Public");
    expect(screen.getByTestId("menu-item-all-data")).toBeTruthy();
  });

  it("keeps the full tab set when the current path matches Public", () => {
    setPath("/public");
    render(<MainMenu adminUser={true} userSignedIn={true} />);

    expect(screen.getByTestId("menu-item-public").getAttribute("href")).toBe(
      "/public",
    );
    expect(screen.getByTestId("menu-item-upload").textContent).toBe("Upload");
  });

  it("keeps the full tab set when the current path matches All Data", () => {
    setPath("/all_data");
    render(<MainMenu adminUser={true} userSignedIn={true} />);

    expect(screen.getByTestId("menu-item-all-data").textContent).toBe(
      "All Data",
    );
  });

  it("keeps the full tab set when the current path is the upload flow", () => {
    setPath("/samples/upload");
    render(<MainMenu adminUser={false} userSignedIn={true} />);

    expect(screen.getByTestId("menu-item-upload").getAttribute("href")).toBe(
      "/samples/upload",
    );
    expect(screen.queryByTestId("menu-item-all-data")).toBeNull();
  });
});
