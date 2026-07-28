// Coverage for
// app/assets/src/components/views/DiscoveryView/components/SamplesView/components/StackedSampleIds/StackedSampleIds.tsx
//
// StackedSampleIds turns the benchmark "additional info" map into one or two
// linked sample ids. Its branches are: empty map (render nothing), a single
// entry (render just the first link), two-or-more entries (render both plus
// the separator), and the per-entry `isRef` suffix / missing-metadata
// fallbacks. All of them are walked below.
import { render, screen } from "@testing-library/react";
import { StackedSampleIds } from "~/components/views/DiscoveryView/components/SamplesView/components/StackedSampleIds/StackedSampleIds";

/* eslint-disable @typescript-eslint/no-explicit-any */

const renderIds = (cellData: any) =>
  render(<StackedSampleIds cellData={cellData} />);

describe("StackedSampleIds", () => {
  it("renders nothing when the additional-info map is empty", () => {
    const { container } = renderIds({});
    expect(container.textContent).toBe("");
    expect(container.querySelectorAll("a")).toHaveLength(0);
  });

  it("renders a single link (no separator) when there is one sample", () => {
    const { container } = renderIds({
      "123": { sampleName: "Sample One", isRef: false },
    });

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("/samples/123");
    expect(links[0].textContent).toBe("123");
  });

  it("appends the (ref) suffix for the reference sample", () => {
    renderIds({ "77": { sampleName: "Reference", isRef: true } });

    expect(screen.getByText("77 (ref)")).toBeTruthy();
  });

  it("renders both sample ids when there are two entries", () => {
    const { container } = renderIds({
      "10": { sampleName: "First", isRef: true },
      "20": { sampleName: "Second", isRef: false },
    });

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute("href")).toBe("/samples/10");
    expect(links[0].textContent).toBe("10 (ref)");
    expect(links[1].getAttribute("href")).toBe("/samples/20");
    expect(links[1].textContent).toBe("20");
  });

  it("only renders the first two entries when more are supplied", () => {
    const { container } = renderIds({
      "1": { sampleName: "A", isRef: false },
      "2": { sampleName: "B", isRef: false },
      "3": { sampleName: "C", isRef: false },
    });

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    expect(links.item(0).textContent).toBe("1");
    expect(links.item(1).textContent).toBe("2");
    expect(container.textContent).not.toContain("3");
  });

  it("tolerates entries with no metadata at all", () => {
    const { container } = renderIds({ "55": undefined, "66": undefined });

    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(2);
    // No isRef, so no suffix is appended.
    expect(links[0].textContent).toBe("55");
    expect(links[1].textContent).toBe("66");
  });
});
