// Regression (Sentry DEV-REACTJS-PROJECT-A): TypeError "undefined is not an object
// (evaluating 'l.count')" on /my_data. DiscoverySidebar.getDerivedStateFromProps read
// projectStats.count unguarded, but projectStats is an OPTIONAL prop (passed conditionally
// from DiscoveryView) -- so when it arrived undefined, `.count` threw. The sibling stats all
// guard with `(sampleStats || {}).x`; the fix guards projectStats the same way.
import { DiscoverySidebar } from "../app/assets/src/components/views/DiscoveryView/components/DiscoverySidebar/DiscoverySidebar";

describe("DiscoverySidebar.getDerivedStateFromProps projectStats guard", () => {
  const baseProps = {
    currentTab: "projects",
    loading: false,
    projectDimensions: [],
    sampleDimensions: [],
    sampleStats: { count: 5, projectCount: 3, avgTotalReads: 100, avgAdjustedRemainingReads: 50 },
  };

  it("does not throw and falls back to sampleStats.projectCount when projectStats is undefined", () => {
    const props = { ...baseProps, projectStats: undefined };
    // Reverting the guard (projectStats.count) makes this throw TypeError -> mutation-checked.
    expect(() => DiscoverySidebar.getDerivedStateFromProps(props, {})).not.toThrow();
    const result = DiscoverySidebar.getDerivedStateFromProps(props, {});
    expect(result.stats.numProjects).toBe(DiscoverySidebar.formatNumber(3));
  });

  it("uses projectStats.count when it is present", () => {
    const props = { ...baseProps, projectStats: { count: 7 } };
    const result = DiscoverySidebar.getDerivedStateFromProps(props, {});
    expect(result.stats.numProjects).toBe(DiscoverySidebar.formatNumber(7));
  });
});
