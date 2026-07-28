// Coverage for
// app/assets/src/components/views/DiscoveryView/components/SamplesView/components/NextcladeModal/components/NextcladeReferenceTreeOptions/NextcladeReferenceTreeOptions.tsx
//
// A radio-style picker between the default Nextclade tree and an uploaded tree.
// It owns: which radio is "checked", whether the FilePicker is shown, the file
// picker's title (derived from referenceTree), the onDrop -> onChange(head(...))
// adapter and the onRejected alert. FilePicker / InputRadio / ExternalLink are
// stubbed so those callbacks and the conditional rendering can be driven
// directly.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const _React: typeof React = React;

let mockFilePickerProps: $TSFixMe = null;
let mockRadioStages: string[] = [];

jest.mock("@czi-sds/components", () => ({
  InputRadio: (props: $TSFixMe) => {
    mockRadioStages.push(props.stage);
    return <span data-testid="radio" data-stage={props.stage} />;
  },
}));

jest.mock("~/components/ui/controls/FilePicker", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => {
    mockFilePickerProps = props;
    return <div data-testid="file-picker" data-title={props.title ?? ""} />;
  },
}));

jest.mock("~/components/ui/controls/ExternalLink", () => ({
  __esModule: true,
  default: (props: $TSFixMe) => <a href={props.href}>{props.children}</a>,
}));

jest.mock("~/components/utils/documentationLinks", () => ({
  NEXTCLADE_DEFAULT_TREE_LINK: "default-link",
  NEXTCLADE_TREE_FORMAT_LINK: "format-link",
  NEXTCLADE_TREE_ROOT_LINK: "root-link",
}));

import { NextcladeReferenceTreeOptions } from "~/components/views/DiscoveryView/components/SamplesView/components/NextcladeModal/components/NextcladeReferenceTreeOptions/NextcladeReferenceTreeOptions";

const renderOptions = (props: $TSFixMe = {}) => {
  const onChange = props.onChange || jest.fn();
  const onSelect = props.onSelect || jest.fn();
  const utils = render(
    <NextcladeReferenceTreeOptions
      onChange={onChange}
      onSelect={onSelect}
      {...props}
    />,
  );
  return { ...utils, onChange, onSelect };
};

beforeEach(() => {
  mockFilePickerProps = null;
  mockRadioStages = [];
});

describe("NextcladeReferenceTreeOptions rendering", () => {
  it("renders both tree options with their documentation links", () => {
    renderOptions();
    expect(screen.getByText("Nextclade Default Tree")).toBeTruthy();
    expect(screen.getByText("Upload a Tree")).toBeTruthy();
    expect(screen.getByText("view the tree.").getAttribute("href")).toBe(
      "default-link",
    );
    expect(screen.getByText("Auspice JSON").getAttribute("href")).toBe(
      "format-link",
    );
  });

  it("checks the default radio and hides the file picker when not uploading", () => {
    renderOptions({ selectedType: "global" });
    // default checked, upload unchecked
    expect(mockRadioStages).toEqual(["checked", "unchecked"]);
    expect(screen.queryByTestId("file-picker")).toBeNull();
  });

  it("checks the upload radio and shows the file picker when uploading", () => {
    renderOptions({ selectedType: "upload" });
    expect(mockRadioStages).toEqual(["unchecked", "checked"]);
    expect(screen.getByTestId("file-picker")).toBeTruthy();
  });
});

describe("NextcladeReferenceTreeOptions file picker title", () => {
  it("labels the file picker with the selected reference tree name", () => {
    renderOptions({ selectedType: "upload", referenceTree: "tree.json" });
    expect(mockFilePickerProps.title).toBe("tree.json Selected For Upload");
  });

  it("leaves the title undefined when no reference tree is selected", () => {
    renderOptions({ selectedType: "upload" });
    expect(mockFilePickerProps.title).toBeUndefined();
  });
});

describe("NextcladeReferenceTreeOptions callbacks", () => {
  it("selects 'global' when the default tree option is clicked", () => {
    const { onSelect } = renderOptions({ selectedType: "upload" });
    fireEvent.click(screen.getByText("Nextclade Default Tree"));
    expect(onSelect).toHaveBeenCalledWith("global");
  });

  it("selects 'upload' when the upload option is clicked", () => {
    const { onSelect } = renderOptions({ selectedType: "global" });
    fireEvent.click(screen.getByText("Upload a Tree"));
    expect(onSelect).toHaveBeenCalledWith("upload");
  });

  it("forwards the first dropped file to onChange", () => {
    const { onChange } = renderOptions({ selectedType: "upload" });
    mockFilePickerProps.onChange(["first.json", "second.json"]);
    expect(onChange).toHaveBeenCalledWith("first.json");
  });

  it("alerts on a rejected file", () => {
    const alertSpy = jest.spyOn(window, "alert").mockImplementation(() => {});
    renderOptions({ selectedType: "upload" });
    mockFilePickerProps.onRejected();
    expect(alertSpy).toHaveBeenCalledWith(
      "Invalid file. Files must be in JSON format and file size must be under 5GB.",
    );
    alertSpy.mockRestore();
  });
});
