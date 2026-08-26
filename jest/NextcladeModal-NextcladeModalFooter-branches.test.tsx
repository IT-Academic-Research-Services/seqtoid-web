// Coverage: app/assets/src/components/views/DiscoveryView/components/SamplesView/components/NextcladeModal/components/NextcladeModalFooter/NextcladeModalFooter.tsx
//
// The footer is entirely made of guards: a loading gate that suppresses every
// notification, a "no valid ids" error, an invalid-samples warning, a
// non-SARS-CoV-2 warning, two pluralisation ternaries and the button's
// `loading || !hasValidIds` disable rule. Each is driven from both sides.
//
// The accordion notifications keep their bodies collapsed (`open={false}`), so
// Accordion is stubbed to render header + content inline; that is the only way
// to assert which sample list each warning was handed.
import { fireEvent, render, screen } from "@testing-library/react";
import { NextcladeModalFooter } from "~/components/views/DiscoveryView/components/SamplesView/components/NextcladeModal/components/NextcladeModalFooter/NextcladeModalFooter";

jest.mock("~/components/layout/Accordion", () => ({
  __esModule: true,
  default: ({
    header,
    children,
  }: {
    header: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div data-testid="accordion">
      <div data-testid="accordion-header">{header}</div>
      <div data-testid="accordion-content">{children}</div>
    </div>
  ),
}));

const defaultProps = {
  hasValidIds: true,
  invalidSampleNames: [] as string[],
  isMissingUploadedTree: false,
  isParsingReferenceTree: false,
  loading: false,
  onClick: jest.fn(),
  referenceTreeError: null as string | null,
  samplesNotSentToNextclade: [] as string[],
  validationError: null as string | null,
};

const renderFooter = (overrides: Partial<typeof defaultProps> = {}) => {
  const props = { ...defaultProps, ...overrides };
  const { container } = render(<NextcladeModalFooter {...props} />);
  return {
    props,
    text: (container.textContent ?? "").replace(/\s+/g, " ").trim(),
    button: container.querySelector("button") as HTMLButtonElement,
    headers: screen
      .queryAllByTestId("accordion-header")
      .map(node => (node.textContent ?? "").replace(/\s+/g, " ").trim()),
    contents: screen
      .queryAllByTestId("accordion-content")
      .map(node => (node.textContent ?? "").replace(/\s+/g, " ").trim()),
  };
};

beforeEach(() => {
  defaultProps.onClick.mockClear();
});

describe("NextcladeModalFooter branches", () => {
  describe("while validating", () => {
    it("shows the loading message and suppresses every notification", () => {
      const { text, button } = renderFooter({
        loading: true,
        hasValidIds: false,
        invalidSampleNames: ["bad-1"],
        samplesNotSentToNextclade: ["flu-1"],
        validationError: "boom",
      });

      expect(text).toContain("Validating consensus genomes...");
      // Every notification branch is gated on !loading.
      expect(text).not.toContain("No valid consensus genomes");
      expect(text).not.toContain("won't be sent to Nextclade");
      expect(button.disabled).toBe(true);
    });
  });

  it("hides the loading message once validation finishes", () => {
    const { text } = renderFooter({ loading: false });

    expect(text).not.toContain("Validating consensus genomes...");
  });

  describe("no valid consensus genomes", () => {
    it("shows the hard error and skips the invalid-samples accordion", () => {
      const { text, headers, button } = renderFooter({
        hasValidIds: false,
        invalidSampleNames: ["bad-1", "bad-2"],
      });

      expect(text).toContain(
        "No valid consensus genomes to upload to Nextclade because they either failed or are still processing.",
      );
      // The else-if arm must not also fire.
      expect(headers).toHaveLength(0);
      expect(button.disabled).toBe(true);
    });
  });

  describe("some invalid consensus genomes", () => {
    it("uses the singular noun for exactly one invalid sample", () => {
      const { headers, contents, text } = renderFooter({
        hasValidIds: true,
        invalidSampleNames: ["bad-1"],
      });

      expect(headers[0]).toContain(
        "1 consensus genome won't be sent to Nextclade",
      );
      expect(headers[0]).toContain(
        "because they either failed or are still processing:",
      );
      expect(contents[0]).toBe("bad-1");
      expect(text).not.toContain("No valid consensus genomes");
    });

    it("uses the plural noun for more than one invalid sample", () => {
      const { headers, contents } = renderFooter({
        hasValidIds: true,
        invalidSampleNames: ["bad-1", "bad-2"],
      });

      expect(headers[0]).toContain(
        "2 consensus genomes won't be sent to Nextclade",
      );
      expect(contents[0]).toBe("bad-1bad-2");
    });

    it("renders nothing when the invalid list is empty", () => {
      const { headers } = renderFooter({
        hasValidIds: true,
        invalidSampleNames: [],
      });

      expect(headers).toHaveLength(0);
    });
  });

  describe("non-SARS-CoV-2 samples", () => {
    it("uses the singular noun for exactly one skipped sample", () => {
      const { headers, contents } = renderFooter({
        samplesNotSentToNextclade: ["flu-1"],
      });

      expect(headers[0]).toContain(
        "1 consensus genome won't be sent to Nextclade",
      );
      expect(headers[0]).toContain(
        "because Nextclade only accepts SARS-CoV-2 genomes currently:",
      );
      expect(contents[0]).toBe("flu-1");
    });

    it("uses the plural noun for more than one skipped sample", () => {
      const { headers } = renderFooter({
        samplesNotSentToNextclade: ["flu-1", "flu-2"],
      });

      expect(headers[0]).toContain(
        "2 consensus genomes won't be sent to Nextclade",
      );
    });

    it("renders nothing when nothing was skipped", () => {
      const { headers } = renderFooter({ samplesNotSentToNextclade: [] });

      expect(headers).toHaveLength(0);
    });

    it("stacks the invalid-samples and non-SARS-CoV-2 warnings together", () => {
      const { headers } = renderFooter({
        invalidSampleNames: ["bad-1"],
        samplesNotSentToNextclade: ["flu-1", "flu-2"],
      });

      expect(headers).toHaveLength(2);
      expect(headers[0]).toContain(
        "they either failed or are still processing",
      );
      expect(headers[1]).toContain("only accepts SARS-CoV-2 genomes");
    });
  });

  describe("validation error", () => {
    // renderValidationError builds the notification but never returns it, so
    // the copy stays off-screen. Pinning that keeps the branch honest: if the
    // missing `return` is ever fixed this test is the one that notices.
    it("takes the error path without surfacing any error copy", () => {
      const { text } = renderFooter({
        loading: false,
        validationError: "request failed",
      });

      expect(text).not.toContain(
        "An error occurred when verifying your selected consensus genomes.",
      );
      expect(text).not.toContain("request failed");
    });

    it("takes the no-error path when validationError is null", () => {
      const { text } = renderFooter({ loading: false, validationError: null });

      expect(text).not.toContain("An error occurred when verifying");
    });
  });

  describe("the Nextclade button", () => {
    it("is enabled and fires onClick when there is something valid to send", () => {
      const { button, props } = renderFooter({
        loading: false,
        hasValidIds: true,
      });

      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(props.onClick).toHaveBeenCalledTimes(1);
    });

    it("is disabled when there are no valid ids even though loading finished", () => {
      const { button, props } = renderFooter({
        loading: false,
        hasValidIds: false,
      });

      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(props.onClick).not.toHaveBeenCalled();
    });
  });

  // SMP-1660: "Upload a Tree" with no parsed tree used to leave the button live,
  // so the export went out with no tree and silently succeeded.
  describe("the uploaded reference tree", () => {
    it("blocks the export and warns while an uploaded tree is still missing", () => {
      const { button, props, text } = renderFooter({
        isMissingUploadedTree: true,
      });

      expect(text).toContain(
        "Upload a reference tree in Auspice JSON format, or choose the Nextclade Default Tree, before continuing.",
      );
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(props.onClick).not.toHaveBeenCalled();
    });

    it("blocks the export while the chosen tree is being read", () => {
      const { button, text } = renderFooter({
        isMissingUploadedTree: true,
        isParsingReferenceTree: true,
      });

      expect(text).toContain("Reading reference tree...");
      // The "pick a tree" nudge is suppressed while parsing is still running.
      expect(text).not.toContain("before continuing.");
      expect(button.disabled).toBe(true);
    });

    it("surfaces a parse failure as an error and keeps the export blocked", () => {
      const { button, props, text } = renderFooter({
        isMissingUploadedTree: true,
        referenceTreeError: "We couldn't read that reference tree.",
      });

      expect(text).toContain("We couldn't read that reference tree.");
      // The error replaces the generic nudge rather than stacking with it.
      expect(text).not.toContain("before continuing.");
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
      expect(props.onClick).not.toHaveBeenCalled();
    });

    it("enables the export once a tree has parsed, with no tree notification", () => {
      const { button, props, text } = renderFooter({
        isMissingUploadedTree: false,
        isParsingReferenceTree: false,
        referenceTreeError: null,
      });

      expect(text).not.toContain("Reading reference tree...");
      expect(text).not.toContain("before continuing.");
      expect(button.disabled).toBe(false);
      fireEvent.click(button);
      expect(props.onClick).toHaveBeenCalledTimes(1);
    });
  });
});
