// Coverage: app/assets/src/components/ui/controls/FilePicker.tsx
//
// FilePicker wraps react-dropzone and renders one of two content states: drop
// instructions (single- vs multi-file wording) or a "loaded" confirmation once a
// file is present, plus an optional title with a validating spinner. react-
// dropzone is stubbed so we can drive onDrop/onDropRejected directly and assert
// both the caller-supplied and default handlers, and the selectedFile state path.
import { act, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const _React: typeof React = React;

// Capture the props react-dropzone receives so tests can invoke onDrop /
// onDropRejected, and expose a click surface to reach the internal state path.
let lastDropzoneProps: $TSFixMe = null;
jest.mock("react-dropzone", () => {
  const ReactLib = require("react");
  const Dropzone = (props: $TSFixMe) => {
    lastDropzoneProps = props;
    return ReactLib.createElement(
      "div",
      {
        "data-testid": "dropzone",
        onClick: () => props.onDrop && props.onDrop([]),
      },
      props.children,
    );
  };
  return { __esModule: true, default: Dropzone };
});

import FilePicker from "~/components/ui/controls/FilePicker";

describe("FilePicker", () => {
  beforeEach(() => {
    lastDropzoneProps = null;
  });

  it("renders single-file drop instructions by default", () => {
    render(<FilePicker onChange={jest.fn()} />);
    expect(screen.getByText(/Drag and drop a file here/)).toBeTruthy();
    expect(screen.getByText("click to use a file browser.")).toBeTruthy();
  });

  it("renders multi-file wording when multiFile is set", () => {
    render(<FilePicker onChange={jest.fn()} multiFile />);
    expect(screen.getByText(/Drag and drop your files here/)).toBeTruthy();
  });

  it("renders the loaded state with the file name and message when a file is passed", () => {
    render(
      <FilePicker
        onChange={jest.fn()}
        file={{ name: "reads.fastq" } as File}
        message="Upload in progress"
        title="Sample file"
      />,
    );
    expect(screen.getByText(/reads\.fastq/)).toBeTruthy();
    expect(screen.getByText("loaded")).toBeTruthy();
    expect(screen.getByText("Upload in progress")).toBeTruthy();
    // Title present -> the title text renders.
    expect(screen.getByText("Sample file")).toBeTruthy();
  });

  it("omits the message node when no message is provided", () => {
    render(<FilePicker onChange={jest.fn()} file={{ name: "a.fa" } as File} />);
    expect(screen.getByText(/a\.fa/)).toBeTruthy();
    expect(screen.queryByText("Upload in progress")).toBeNull();
  });

  it("shows the validating spinner only while finishedValidating is false", () => {
    const { container, rerender } = render(
      <FilePicker
        onChange={jest.fn()}
        title="Sample file"
        finishedValidating={false}
      />,
    );
    expect(container.querySelector(".fa-spinner")).toBeTruthy();

    rerender(
      <FilePicker
        onChange={jest.fn()}
        title="Sample file"
        finishedValidating={true}
      />,
    );
    expect(container.querySelector(".fa-spinner")).toBeNull();
  });

  it("wires the provided onChange as the dropzone onDrop handler", () => {
    const onChange = jest.fn();
    render(<FilePicker onChange={onChange} />);
    const accepted = [{ name: "dropped.fastq" }];
    lastDropzoneProps.onDrop(accepted);
    expect(onChange).toHaveBeenCalledWith(accepted);
  });

  it("wires the provided onRejected as the dropzone onDropRejected handler", () => {
    const onRejected = jest.fn();
    render(<FilePicker onChange={jest.fn()} onRejected={onRejected} />);
    const rejected = [{ name: "too-big.fastq" }];
    lastDropzoneProps.onDropRejected(rejected);
    expect(onRejected).toHaveBeenCalledWith(rejected);
  });

  it("falls back to the default onChange, showing the accepted file as loaded", () => {
    // No onChange override branch: defaultOnChange stores accepted[0] in state.
    render(<FilePicker onChange={undefined as $TSFixMe} />);
    fireEvent.click(screen.getByTestId("dropzone")); // onDrop([]) -> no-op branch
    expect(screen.getByText(/Drag and drop a file here/)).toBeTruthy();
    // Now drop a real accepted file through the default handler.
    act(() => {
      lastDropzoneProps.onDrop([{ name: "picked.fastq" }]);
    });
    expect(screen.getByText(/picked\.fastq/)).toBeTruthy();
    expect(screen.getByText("loaded")).toBeTruthy();
  });

  it("falls back to the default onRejected (window.alert) when none is given", () => {
    const alertSpy = jest
      .spyOn(window, "alert")
      .mockImplementation(() => undefined);
    render(<FilePicker onChange={jest.fn()} />);
    lastDropzoneProps.onDropRejected([{ name: "bad" }]);
    expect(alertSpy).toHaveBeenCalledWith(
      "File could not be selected for upload",
    );
    alertSpy.mockRestore();
  });
});
