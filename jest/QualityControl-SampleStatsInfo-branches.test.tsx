// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/components/QualityControl/components/SampleStatsInfo/SampleStatsInfo.tsx
//
// Four pluralisation ternaries (valid / running x2 / failed), the
// `showProcessingSamplesMessage && runningSamples.length > 0` gate and the
// dismiss transition that flips the first half of that gate to false.
//
// ColumnHeaderTooltip wraps its content in a semantic-ui Popup that only mounts
// on hover; it is stubbed so the list copy -- where three of the four ternaries
// live -- is assertable.
import { fireEvent, render, screen } from "@testing-library/react";
import { SampleStatsInfo } from "~/components/views/DiscoveryView/components/SamplesView/components/QualityControl/components/SampleStatsInfo/SampleStatsInfo";
import Sample from "~/interface/sample";

jest.mock("~/components/ui/containers/ColumnHeaderTooltip", () => ({
  __esModule: true,
  default: ({
    trigger,
    content,
  }: {
    trigger: React.ReactNode;
    content: React.ReactNode;
  }) => (
    <span>
      {trigger}
      <span data-testid="tooltip-content">{content}</span>
    </span>
  ),
}));

const samples = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1 })) as unknown as Sample[];

const renderInfo = ({
  running = 0,
  failed = 0,
  valid = 0,
  totalSampleCount = 10 as number | null,
} = {}) => {
  const { container } = render(
    <SampleStatsInfo
      runningSamples={samples(running)}
      failedSamples={samples(failed)}
      validSamples={samples(valid)}
      totalSampleCount={totalSampleCount}
    />,
  );
  const flatten = (node: Element | null) =>
    (node?.textContent ?? "").replace(/\s+/g, " ").trim();
  // The component root holds at most two children: the optional processing
  // notification (a <div>) followed by the stats row (a <span>). Isolating the
  // notification matters because the tooltip list repeats the same copy.
  const notification = () => {
    const first = container.firstElementChild?.firstElementChild ?? null;
    return first && first.tagName === "DIV" ? first : null;
  };
  return {
    container,
    notification,
    all: flatten(container),
    statsRow: flatten(container.querySelector("span")),
    tooltip: flatten(screen.getByTestId("tooltip-content")),
  };
};

describe("SampleStatsInfo branches", () => {
  describe("the processing-samples notification", () => {
    it("is hidden when nothing is still processing", () => {
      const { notification } = renderInfo({ running: 0, valid: 5 });

      expect(notification()).toBeNull();
    });

    it("uses the singular verb for exactly one running sample", () => {
      const { notification } = renderInfo({ running: 1, valid: 5 });

      expect(
        (notification()?.textContent ?? "").replace(/\s+/g, " "),
      ).toContain("1 sample is still being processed.");
    });

    it("uses the plural verb for more than one running sample", () => {
      const { notification } = renderInfo({ running: 3, valid: 5 });

      expect(
        (notification()?.textContent ?? "").replace(/\s+/g, " "),
      ).toContain("3 samples are still being processed.");
    });

    it("disappears for good once the user dismisses it", () => {
      const { container, notification } = renderInfo({ running: 2, valid: 5 });

      expect(notification()).not.toBeNull();

      // closeWithIcon={true} / closeWithDismiss={false}: the only way out is
      // the X, so there is no "Dismiss" affordance to click.
      expect(screen.queryByText("Dismiss")).toBeNull();
      fireEvent.click(screen.getByTestId("x-close-icon"));

      expect(notification()).toBeNull();
      // The stats row survives the dismissal.
      expect((container.textContent ?? "").replace(/\s+/g, " ")).toContain(
        "Showing 5 of 10 samples.",
      );
    });
  });

  describe("the stats row", () => {
    it("reports the valid count against the total", () => {
      const { statsRow } = renderInfo({ valid: 4, totalSampleCount: 12 });

      expect(statsRow).toContain("Showing 4 of 12 samples.");
    });

    it("survives a null total sample count", () => {
      const { statsRow } = renderInfo({ valid: 0, totalSampleCount: null });

      // React renders null as nothing, so the count simply drops out.
      expect(statsRow).toContain("Showing 0 of samples.");
    });
  });

  describe("the tooltip breakdown", () => {
    it("uses singular wording when each bucket holds exactly one sample", () => {
      const { tooltip } = renderInfo({ valid: 1, running: 1, failed: 1 });

      expect(tooltip).toContain(
        "1 sample has been uploaded and selected by filters.",
      );
      expect(tooltip).toContain("1 sample is still being processed.");
      expect(tooltip).toContain("1 sample failed to process.");
    });

    it("uses plural wording when the buckets hold zero or many samples", () => {
      const { tooltip } = renderInfo({ valid: 0, running: 2, failed: 3 });

      expect(tooltip).toContain(
        "0 samples have been uploaded and selected by filters.",
      );
      expect(tooltip).toContain("2 samples are still being processed.");
      expect(tooltip).toContain("3 samples failed to process.");
    });

    it("always mentions the consensus-genome exclusion", () => {
      const { tooltip } = renderInfo({ valid: 2 });

      expect(tooltip).toContain(
        "Samples with only Consensus Genome runs will not be displayed in the charts below",
      );
    });
  });
});
