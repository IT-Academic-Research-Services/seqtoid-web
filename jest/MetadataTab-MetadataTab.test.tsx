// Coverage: app/assets/src/components/common/DetailsSidebar/SampleDetailsMode/components/MetadataTab/MetadataTab.tsx
//
// MetadataTab groups the metadata field types into "<group> Info" sections
// (always seeding "Sample Info"), tracks per-section open/editing state and
// wires the toggle + edit-toggle callbacks so only one section edits at a time
// and editing a section also opens it. react-relay is stubbed, and the
// MetadataSection wrapper + MetadataSectionContent body are stubbed so the
// assertions land on the section-grouping and toggle-state logic in this file.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const mockSectionRenders: Record<string, unknown>[] = [];

jest.mock("react-relay", () => ({
  graphql: () => ({}),
  useFragment: (_fragment: unknown, key: unknown) => key,
}));

jest.mock(
  "~/components/common/DetailsSidebar/SampleDetailsMode/MetadataSection",
  () => {
    const ReactLib = require("react");
    return {
      __esModule: true,
      default: (props: Record<string, $TSFixMe>) => {
        mockSectionRenders.push(props);
        return ReactLib.createElement(
          "div",
          { "data-testid": `section-${props.title}` },
          ReactLib.createElement(
            "span",
            { "data-testid": `open-${props.title}` },
            String(props.open),
          ),
          ReactLib.createElement(
            "span",
            { "data-testid": `editing-${props.title}` },
            String(props.editing),
          ),
          ReactLib.createElement(
            "span",
            { "data-testid": `editable-${props.title}` },
            String(props.editable),
          ),
          ReactLib.createElement(
            "button",
            {
              "data-testid": `toggle-${props.title}`,
              onClick: props.onToggle as () => void,
            },
            "toggle",
          ),
          ReactLib.createElement(
            "button",
            {
              "data-testid": `edit-${props.title}`,
              onClick: props.onEditToggle as () => void,
            },
            "edit",
          ),
          props.children as React.ReactNode,
        );
      },
    };
  },
);

jest.mock(
  "~/components/common/DetailsSidebar/SampleDetailsMode/components/MetadataTab/components/MetadataSectionContent",
  () => {
    const ReactLib = require("react");
    return {
      MetadataSectionContent: (props: Record<string, $TSFixMe>) =>
        ReactLib.createElement(
          "div",
          { "data-testid": `content-${props.section.name}` },
          props.section.keys.join(","),
        ),
    };
  },
);

import { MetadataTab } from "~/components/common/DetailsSidebar/SampleDetailsMode/components/MetadataTab/MetadataTab";

const metadataTypes = {
  sample_type: { key: "sample_type", name: "Sample Type", group: "Sample" },
  age: { key: "age", name: "Age", group: "Host" },
  sex: { key: "sex", name: "Sex", group: "Host" },
  // group === null -> skipped entirely.
  orphan: { key: "orphan", name: "Orphan", group: null },
} as $TSFixMe;

const renderTab = (props: Record<string, unknown> = {}) =>
  render(
    <MetadataTab
      currentWorkflowTab={"Metagenomic" as $TSFixMe}
      metadataTabFragmentKey={
        { additional_info: { editable: true } } as $TSFixMe
      }
      metadataTypes={metadataTypes}
      nameLocal="My Sample"
      onMetadataChange={jest.fn()}
      onMetadataSave={jest.fn()}
      sampleTypes={[]}
      setNameLocal={jest.fn()}
      {...(props as $TSFixMe)}
    />,
  );

describe("MetadataTab", () => {
  beforeEach(() => {
    mockSectionRenders.length = 0;
  });

  it("groups the metadata types into '<group> Info' sections and seeds Sample Info", () => {
    renderTab();
    // Seeded default + one section per non-null group.
    expect(screen.getByTestId("section-Sample Info")).toBeTruthy();
    expect(screen.getByTestId("section-Host Info")).toBeTruthy();
    // group === null is skipped -> no "null Info" section.
    expect(screen.queryByTestId("section-null Info")).toBeNull();

    // Keys are grouped and sorted; Host Info holds the sorted host keys.
    expect(screen.getByTestId("content-Host Info").textContent).toBe("age,sex");
    // "Sample Info" seed starts empty then collects sample_type.
    expect(screen.getByTestId("content-Sample Info").textContent).toBe(
      "sample_type",
    );
  });

  it("opens only the first section by default and reflects editable from additional_info", () => {
    renderTab();
    expect(screen.getByTestId("open-Sample Info").textContent).toBe("true");
    expect(screen.getByTestId("open-Host Info").textContent).toBe("undefined");
    expect(screen.getByTestId("editable-Sample Info").textContent).toBe("true");
  });

  it("toggles a section open then closed via onToggle", () => {
    renderTab();
    // Host Info starts closed.
    fireEvent.click(screen.getByTestId("toggle-Host Info"));
    expect(screen.getByTestId("open-Host Info").textContent).toBe("true");
    fireEvent.click(screen.getByTestId("toggle-Host Info"));
    expect(screen.getByTestId("open-Host Info").textContent).toBe("false");
  });

  it("edit-toggling a section opens it and marks it editing", () => {
    renderTab();
    fireEvent.click(screen.getByTestId("edit-Host Info"));
    expect(screen.getByTestId("editing-Host Info").textContent).toBe("true");
    expect(screen.getByTestId("open-Host Info").textContent).toBe("true");
  });

  it("treats a missing fragment (no additional_info) as non-editable", () => {
    renderTab({ metadataTabFragmentKey: null });
    expect(screen.getByTestId("editable-Sample Info").textContent).toBe(
      "undefined",
    );
  });
});
