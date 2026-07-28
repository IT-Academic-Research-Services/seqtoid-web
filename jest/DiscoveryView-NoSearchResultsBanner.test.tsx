// Coverage: app/assets/src/components/views/DiscoveryView/components/NoResultsBanner/NoSearchResultsBanner.tsx
//
// NoSearchResultsBanner builds the "0 <type> Search Results" copy and passes
// each of its optional props through a `!!value && value` guard before handing
// them to InfoBanner -- so every optional prop has a truthy and a falsy branch.
// InfoBanner is stubbed to make the exact forwarded values observable.
import { render, screen } from "@testing-library/react";

const capturedProps: $TSFixMe[] = [];

jest.mock("~/components/common/InfoBanner", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    InfoBanner: (props: $TSFixMe) => {
      capturedProps.push(props);
      return ReactLib.createElement(
        "div",
        { "data-testid": "info-banner" },
        props.title,
      );
    },
  };
});

import { NoSearchResultsBanner } from "~/components/views/DiscoveryView/components/NoResultsBanner/NoSearchResultsBanner";

const Icon = () => null;

const lastProps = () => capturedProps[capturedProps.length - 1];

beforeEach(() => {
  capturedProps.length = 0;
});

describe("NoSearchResultsBanner copy", () => {
  it("builds the title, message and type from the search type", () => {
    render(<NoSearchResultsBanner icon={Icon} searchType="Sample" />);
    expect(screen.getByTestId("info-banner")).toBeTruthy();
    expect(lastProps().title).toBe("0 Sample Search Results");
    expect(lastProps().message).toBe(
      "Sorry, no Sample results were found, please try another search.",
    );
    expect(lastProps().type).toBe("Sample");
    expect(lastProps().icon).toBe(Icon);
  });

  it("uses whichever search type it is given", () => {
    render(<NoSearchResultsBanner icon={Icon} searchType="Project" />);
    expect(lastProps().title).toBe("0 Project Search Results");
    expect(lastProps().message).toContain("no Project results");
  });
});

describe("NoSearchResultsBanner optional props", () => {
  it("forwards nothing but false for the omitted optional props", () => {
    render(<NoSearchResultsBanner icon={Icon} searchType="Sample" />);
    const props = lastProps();
    expect(props.className).toBe(false);
    expect(props.link).toBe(false);
    expect(props.listenerLink).toBe(false);
  });

  it("forwards a className when one is supplied", () => {
    render(
      <NoSearchResultsBanner
        icon={Icon}
        searchType="Sample"
        className="my-banner"
      />,
    );
    expect(lastProps().className).toBe("my-banner");
  });

  it("forwards a link when one is supplied", () => {
    const link = { href: "/help", text: "Help", external: true };
    render(
      <NoSearchResultsBanner icon={Icon} searchType="Sample" link={link} />,
    );
    expect(lastProps().link).toBe(link);
    // listenerLink was still omitted, so it stays falsy.
    expect(lastProps().listenerLink).toBe(false);
  });

  it("forwards a listenerLink when one is supplied", () => {
    const onClick = jest.fn();
    const listenerLink = { text: "Clear filters", onClick };
    render(
      <NoSearchResultsBanner
        icon={Icon}
        searchType="Sample"
        listenerLink={listenerLink}
      />,
    );
    expect(lastProps().listenerLink).toBe(listenerLink);
    expect(lastProps().link).toBe(false);
  });

  it("forwards every optional prop at once", () => {
    const link = { href: "/a", text: "A" };
    const listenerLink = { text: "B", onClick: jest.fn() };
    render(
      <NoSearchResultsBanner
        icon={Icon}
        searchType="Visualization"
        className="c"
        link={link}
        listenerLink={listenerLink}
      />,
    );
    const props = lastProps();
    expect(props.className).toBe("c");
    expect(props.link).toBe(link);
    expect(props.listenerLink).toBe(listenerLink);
    expect(props.title).toBe("0 Visualization Search Results");
  });
});
