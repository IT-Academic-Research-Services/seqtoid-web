// Branch coverage for
// app/assets/src/components/views/DiscoveryView/components/SamplesView/components/MetadataUploadModal/Instructions.tsx
//
// Every conditional keys off `standalone`: the `standalone && cs.standalone`
// class modifier, the `!standalone &&` Back button, and the terminal
// `standalone ? <NarrowContainer> : body` wrapper choice.
import { fireEvent, render, screen } from "@testing-library/react";
import UploadInstructions from "~/components/views/DiscoveryView/components/SamplesView/components/MetadataUploadModal/Instructions";

describe("MetadataUploadModal Instructions", () => {
  it("renders the Back button and no NarrowContainer in modal (non-standalone) mode", () => {
    const onClose = jest.fn();
    render(<UploadInstructions onClose={onClose} />);

    expect(screen.getByText("How to Upload a Metadata CSV")).toBeTruthy();

    const back = screen.getByText("Back");
    fireEvent.click(back);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides the Back button when standalone", () => {
    const onClose = jest.fn();
    render(<UploadInstructions onClose={onClose} standalone={true} />);

    expect(screen.queryByText("Back")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText("How to Upload a Metadata CSV")).toBeTruthy();
  });

  it("wraps the body in an extra container element when standalone", () => {
    const depthOfTitle = (container: HTMLElement) => {
      let node: HTMLElement | null = screen.getByText(
        "How to Upload a Metadata CSV",
      );
      let depth = 0;
      while (node && node !== container) {
        depth += 1;
        node = node.parentElement;
      }
      return depth;
    };

    const modal = render(<UploadInstructions onClose={jest.fn()} />);
    const modalDepth = depthOfTitle(modal.container);
    modal.unmount();

    const standalone = render(
      <UploadInstructions onClose={jest.fn()} standalone={true} size="small" />,
    );
    const standaloneDepth = depthOfTitle(standalone.container);

    // The standalone arm adds exactly one NarrowContainer wrapper around the
    // same body, so the title sits one level deeper.
    expect(modalDepth).toBe(3);
    expect(standaloneDepth).toBe(modalDepth + 1);
  });

  it("renders the ordered instruction list with the metadata dictionary and template links", () => {
    const { container } = render(<UploadInstructions onClose={jest.fn()} />);

    expect(container.querySelector("ol")).toBeTruthy();
    expect(container.querySelectorAll("li").length).toBe(6);

    const dictionaryLink = screen.getByText("metadata dictionary");
    expect(dictionaryLink.closest("a")?.getAttribute("href")).toBe(
      "/metadata/dictionary",
    );

    const templateLink = screen.getByText("CSV template.");
    expect(templateLink.getAttribute("href")).toBe(
      "/metadata/metadata_template_csv",
    );
    expect(templateLink.getAttribute("rel")).toBe("noopener noreferrer");

    expect(
      screen.getByText("Upload your CSV file.", { exact: false }),
    ).toBeTruthy();
  });
});
