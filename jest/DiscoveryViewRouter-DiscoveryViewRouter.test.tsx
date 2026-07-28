// Coverage for
// app/assets/src/components/views/DiscoveryViewRouter/DiscoveryViewRouter.tsx
//
// The router is a single <Switch>: every branch here is "which path wins, and
// what props does the winner get". Each destination view is stubbed with a
// marker so the tests assert on route selection and on the params the router
// derives (parseInt'd ids, snapshot share ids from the URL vs. from props),
// including the userSignedIn conditional that decides between DiscoveryViewFC
// and the public LandingPage.
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { UserContext } from "~/components/common/UserContext";
import DiscoveryViewRouter from "~/components/views/DiscoveryViewRouter/DiscoveryViewRouter";

/* eslint-disable @typescript-eslint/no-explicit-any */

const mockRenderedProps: Record<string, any> = {};

jest.mock("~/components/common/LoadingPage", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    LoadingPage: (props: any) => {
      mockRenderedProps["loading-page"] = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "loading-page" },
        "loading-page",
      );
    },
  };
});

jest.mock("~/components/views/UserProfileForm", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: any) => {
      mockRenderedProps["user-profile-form"] = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "user-profile-form" },
        "user-profile-form",
      );
    },
  };
});

jest.mock("~/components/views/AdminPage", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    AdminPage: (props: any) => {
      mockRenderedProps["admin-page"] = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "admin-page" },
        "admin-page",
      );
    },
  };
});

jest.mock("~/components/views/AdminProject", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    AdminProject: (props: any) => {
      mockRenderedProps["admin-project"] = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "admin-project" },
        "admin-project",
      );
    },
  };
});

jest.mock("~/components/views/AdminSample", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    AdminSample: (props: any) => {
      mockRenderedProps["admin-sample"] = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "admin-sample" },
        "admin-sample",
      );
    },
  };
});

jest.mock("~/components/views/AdminSettings", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    AdminSettings: (props: any) => {
      mockRenderedProps["admin-settings"] = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "admin-settings" },
        "admin-settings",
      );
    },
  };
});

jest.mock("~/components/views/DiscoveryView/DiscoveryViewFC", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    DiscoveryViewFC: (props: any) => {
      mockRenderedProps["discovery-view"] = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "discovery-view" },
        "discovery-view",
      );
    },
  };
});

jest.mock("~/components/views/LandingPage", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    LandingPage: (props: any) => {
      mockRenderedProps["landing-page"] = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "landing-page" },
        "landing-page",
      );
    },
  };
});

jest.mock("~/components/views/PathogenListView", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    PathogenListView: (props: any) => {
      mockRenderedProps["pathogen-list"] = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "pathogen-list" },
        "pathogen-list",
      );
    },
  };
});

jest.mock("~/components/views/PhyloTree/PhyloTreeListView", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: any) => {
      mockRenderedProps["phylo-tree-list"] = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "phylo-tree-list" },
        "phylo-tree-list",
      );
    },
  };
});

jest.mock("~/components/views/SampleView", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: any) => {
      mockRenderedProps["sample-view"] = props;
      return ReactLib.createElement(
        "div",
        { "data-testid": "sample-view" },
        "sample-view",
      );
    },
  };
});

const BASE_PROPS = {
  admin: true,
  domain: "my_data",
  mapTilerKey: "map-tiler-key",
  projectId: "17",
  snapshotProjectDescription: "prop-description",
  snapshotProjectName: "prop-name",
  snapshotShareId: "prop-share-id",
  announcementBannerEnabled: true,
  emergencyBannerMessage: "the sky is falling",
};

const renderAt = (
  path: string,
  { userSignedIn = true, props = {} }: any = {},
) =>
  render(
    <UserContext.Provider value={{ userSignedIn } as any}>
      <MemoryRouter initialEntries={[path]}>
        <DiscoveryViewRouter {...(BASE_PROPS as any)} {...props} />
      </MemoryRouter>
    </UserContext.Provider>,
  );

describe("DiscoveryViewRouter route matching", () => {
  beforeEach(() => {
    Object.keys(mockRenderedProps).forEach(k => delete mockRenderedProps[k]);
  });

  it("renders the user profile form on /user_profile_form", () => {
    renderAt("/user_profile_form");
    expect(screen.getByTestId("user-profile-form")).toBeTruthy();
    expect(screen.queryByTestId("discovery-view")).toBeNull();
  });

  it("renders the pathogen list on /pathogen_list", () => {
    renderAt("/pathogen_list");
    expect(screen.getByTestId("pathogen-list")).toBeTruthy();
  });

  it("parses the phylo tree id out of the path", () => {
    renderAt("/phylo_tree_ngs/482");
    expect(screen.getByTestId("phylo-tree-list")).toBeTruthy();
    expect(mockRenderedProps["phylo-tree-list"].selectedPhyloTreeNgId).toBe(
      482,
    );
  });

  it("parses the sample id out of /samples/:id and passes no snapshot id", () => {
    renderAt("/samples/91");
    expect(screen.getByTestId("sample-view")).toBeTruthy();
    expect(mockRenderedProps["sample-view"].sampleId).toBe(91);
    expect(mockRenderedProps["sample-view"].snapshotShareId).toBeUndefined();
  });

  it("uses the snapshot sample route for /pub/:shareId/samples/:sampleId", () => {
    renderAt("/pub/share-abc/samples/33");
    expect(screen.getByTestId("sample-view")).toBeTruthy();
    expect(mockRenderedProps["sample-view"].sampleId).toBe(33);
    expect(mockRenderedProps["sample-view"].snapshotShareId).toBe("share-abc");
    expect(screen.queryByTestId("discovery-view")).toBeNull();
  });

  it("takes the share id from the URL (not the prop) on the /pub/:shareId route", () => {
    renderAt("/pub/url-share-id");
    expect(screen.getByTestId("discovery-view")).toBeTruthy();
    const props = mockRenderedProps["discovery-view"];
    expect(props.snapshotShareId).toBe("url-share-id");
    expect(props.snapshotProjectName).toBe("prop-name");
    expect(props.snapshotProjectDescription).toBe("prop-description");
    expect(props.domain).toBe("my_data");
    // The snapshot route deliberately omits the admin / mapTiler props.
    expect(props.admin).toBeUndefined();
    expect(props.mapTilerKey).toBeUndefined();
  });

  it("renders the admin landing page only for an exact /admin", () => {
    renderAt("/admin");
    expect(screen.getByTestId("admin-page")).toBeTruthy();
    expect(screen.queryByTestId("admin-settings")).toBeNull();
  });

  it("renders admin settings on /admin/settings", () => {
    renderAt("/admin/settings");
    expect(screen.getByTestId("admin-settings")).toBeTruthy();
    expect(screen.queryByTestId("admin-page")).toBeNull();
  });

  it("passes the raw (unparsed) sample id to AdminSample", () => {
    renderAt("/admin/samples/1234");
    expect(screen.getByTestId("admin-sample")).toBeTruthy();
    expect(mockRenderedProps["admin-sample"].sampleId).toBe("1234");
  });

  it("passes the raw project id to AdminProject", () => {
    renderAt("/admin/projects/pr-9");
    expect(screen.getByTestId("admin-project")).toBeTruthy();
    expect(mockRenderedProps["admin-project"].projectId).toBe("pr-9");
  });
});

describe("DiscoveryViewRouter signed-in fallback", () => {
  beforeEach(() => {
    Object.keys(mockRenderedProps).forEach(k => delete mockRenderedProps[k]);
  });

  it("falls back to DiscoveryViewFC with the full prop set when signed in", () => {
    renderAt("/anything/else", { userSignedIn: true });

    expect(screen.getByTestId("discovery-view")).toBeTruthy();
    expect(screen.queryByTestId("landing-page")).toBeNull();
    const props = mockRenderedProps["discovery-view"];
    expect(props.admin).toBe(true);
    expect(props.mapTilerKey).toBe("map-tiler-key");
    expect(props.projectId).toBe("17");
    expect(props.snapshotShareId).toBe("prop-share-id");
    expect(props.history).toBeTruthy();
    expect(props.location.pathname).toBe("/anything/else");
    expect(props.match).toBeTruthy();
  });

  it("falls back to the LandingPage with banner props when signed out", () => {
    renderAt("/anything/else", { userSignedIn: false });

    expect(screen.getByTestId("landing-page")).toBeTruthy();
    expect(screen.queryByTestId("discovery-view")).toBeNull();
    const props = mockRenderedProps["landing-page"];
    expect(props.announcementBannerEnabled).toBe(true);
    expect(props.emergencyBannerMessage).toBe("the sky is falling");
  });

  it("still routes signed-out users to the named routes ahead of the fallback", () => {
    renderAt("/pathogen_list", { userSignedIn: false });

    expect(screen.getByTestId("pathogen-list")).toBeTruthy();
    expect(screen.queryByTestId("landing-page")).toBeNull();
  });

  it("passes the banner props through even when they are disabled/empty", () => {
    renderAt("/", {
      userSignedIn: false,
      props: {
        announcementBannerEnabled: false,
        emergencyBannerMessage: "",
      },
    });

    const props = mockRenderedProps["landing-page"];
    expect(props.announcementBannerEnabled).toBe(false);
    expect(props.emergencyBannerMessage).toBe("");
  });
});
