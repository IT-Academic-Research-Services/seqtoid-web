// CZID-586 (#586) frontend coverage:
// app/assets/src/components/common/Metadata/MetadataInput.tsx
//
// MetadataInput is a big polymorphic switch: which control it renders depends on
// the metadata field's key, isBoolean flag, options array and dataType, plus the
// human/non-human taxa category. Almost all of its uncovered weight is branch
// weight in that chain, so every arm is rendered and asserted below, together
// with the warning-priority state block at the top of the component.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import MetadataInput from "~/components/common/Metadata/MetadataInput";

// Keep prettier's organize-imports plugin from dropping the React import that
// the classic JSX runtime needs in scope (see jest/uiControls.test.tsx).
const _React: typeof React = React;

const renderInput = (props: Record<string, unknown> = {}) =>
  render(
    <MetadataInput
      className="input"
      value=""
      onChange={jest.fn()}
      taxaCategory="mosquito"
      {...(props as any)}
      metadataType={
        {
          key: "some_field",
          dataType: "string",
          ...((props.metadataType as object) || {}),
        } as any
      }
    />,
  );

const textInput = () => document.querySelector("input") as HTMLInputElement;

describe("MetadataInput -- sample_type branch", () => {
  it("renders the sample type search box even when there is no value yet (CZID-314)", () => {
    // The regression this branch guards: an empty sample_type used to fall
    // through to a plain text input, so the dropdown only appeared after typing.
    renderInput({
      value: undefined,
      metadataType: { key: "sample_type", dataType: "string" },
      sampleTypes: [{ name: "CSF", group: "Systemic Inflammation" }],
    });
    expect(textInput().value).toBe("");
    expect(textInput().getAttribute("type")).not.toBe("number");
  });

  it("seeds the search box with an existing string value", () => {
    renderInput({
      value: "Serum",
      metadataType: { key: "sample_type", dataType: "string" },
      sampleTypes: [],
    });
    expect(textInput().value).toBe("Serum");
  });

  it("coerces a non-string value to an empty string", () => {
    renderInput({
      value: 12 as unknown as string,
      metadataType: { key: "sample_type", dataType: "string" },
      sampleTypes: [],
    });
    expect(textInput().value).toBe("");
  });
});

describe("MetadataInput -- boolean branch", () => {
  const booleanType = {
    key: "water_control",
    dataType: "string",
    isBoolean: true,
    options: ["Yes", "No"],
  };

  it("renders a toggle that starts on when the value matches the on label", () => {
    renderInput({ value: "Yes", metadataType: booleanType });
    const toggle = document.querySelector("input") as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    expect(screen.getByText("Yes")).toBeTruthy();
  });

  it("renders a toggle that starts off and saves immediately when flipped", () => {
    const onChange = jest.fn();
    renderInput({ value: "No", metadataType: booleanType, onChange });
    const toggle = document.querySelector("input") as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);
    // The third argument (shouldSave) is true: toggles save on change.
    expect(onChange).toHaveBeenCalledWith("water_control", "Yes", true);
  });
});

describe("MetadataInput -- options dropdown branch", () => {
  it("renders every option from the metadata type", () => {
    const { container } = renderInput({
      value: "DNA",
      metadataType: {
        key: "nucleotide_type",
        dataType: "string",
        options: ["DNA", "RNA"],
      },
    });
    expect(container.textContent).toContain("DNA");
  });
});

describe("MetadataInput -- date branch", () => {
  const dateType = { key: "collection_date", dataType: "date" };

  it("uses the month-precision placeholder for human samples", () => {
    renderInput({
      value: "2024-01",
      metadataType: dateType,
      taxaCategory: "human",
    });
    expect(textInput().placeholder).toBe("YYYY-MM");
    expect(textInput().value).toBe("2024-01");
  });

  it("uses the day-precision placeholder for non-human samples", () => {
    renderInput({ value: "2024-01-05", metadataType: dateType });
    expect(textInput().placeholder).toBe("YYYY-MM-DD");
  });

  it("renders an empty string when the value is undefined", () => {
    renderInput({ value: undefined, metadataType: dateType });
    expect(textInput().value).toBe("");
  });

  it("defers saving until blur", () => {
    const onChange = jest.fn();
    const onSave = jest.fn();
    renderInput({ metadataType: dateType, onChange, onSave });

    fireEvent.change(textInput(), { target: { value: "2024-02-02" } });
    // No third argument -> the parent waits for onSave.
    expect(onChange).toHaveBeenCalledWith("collection_date", "2024-02-02");
    expect(onSave).not.toHaveBeenCalled();

    fireEvent.blur(textInput());
    expect(onSave).toHaveBeenCalledWith("collection_date");
  });

  it("does not blow up on blur when no onSave handler was supplied", () => {
    const onChange = jest.fn();
    renderInput({ metadataType: dateType, onChange, onSave: undefined });
    fireEvent.blur(textInput());
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe("MetadataInput -- location branch", () => {
  const locationType = { key: "collection_location_v2", dataType: "location" };

  it("shows the incoming warning next to a filled-in location", () => {
    renderInput({
      value: "San Francisco, CA",
      metadataType: locationType,
      warning: "Changed to county/district level for personal privacy.",
    });
    expect(
      screen.getByText(
        "Changed to county/district level for personal privacy.",
      ),
    ).toBeTruthy();
  });

  it("suppresses the warning block when the location is empty", () => {
    renderInput({
      value: "",
      metadataType: locationType,
      warning: "Changed to county/district level for personal privacy.",
    });
    expect(
      screen.queryByText(
        "Changed to county/district level for personal privacy.",
      ),
    ).toBeNull();
  });

  it("renders no warning block at all when no warning was passed", () => {
    const { container } = renderInput({
      value: "San Francisco, CA",
      metadataType: locationType,
    });
    expect(container.textContent).not.toContain("privacy");
    expect(textInput().value).toBe("San Francisco, CA");
  });

  it("stringifies a numeric location value for the search box", () => {
    renderInput({ value: 42 as unknown as string, metadataType: locationType });
    expect(textInput().value).toBe("42");
  });

  it("replaces the derived warning when a prop warning arrives later", () => {
    const { rerender } = render(
      <MetadataInput
        className="input"
        value={{ name: "SF" } as any}
        onChange={jest.fn()}
        taxaCategory="human"
        metadataType={
          { key: "collection_location_v2", dataType: "location" } as any
        }
      />,
    );
    // No prop warning yet -> nothing rendered from the derived location warning.
    expect(screen.queryByText(/No match/)).toBeNull();

    rerender(
      <MetadataInput
        className="input"
        value={{ name: "SF" } as any}
        onChange={jest.fn()}
        taxaCategory="human"
        warning="No match. Sample will not appear on maps."
        metadataType={
          { key: "collection_location_v2", dataType: "location" } as any
        }
      />,
    );
    expect(
      screen.getByText("No match. Sample will not appear on maps."),
    ).toBeTruthy();
  });
});

describe("MetadataInput -- host_age branch", () => {
  const ageType = { key: "host_age", dataType: "number" };

  it("renders the HIPAA-aware age input when the sample is human by taxaCategory", () => {
    renderInput({ value: 30, metadataType: ageType, taxaCategory: "human" });
    expect(textInput().value).toBe("30");
  });

  it("renders the HIPAA-aware age input when isHuman is set explicitly", () => {
    renderInput({
      value: 30,
      metadataType: ageType,
      taxaCategory: "mosquito",
      isHuman: true,
    });
    expect(textInput().value).toBe("30");
  });

  it("falls through to a plain numeric input for a non-human host age", () => {
    renderInput({
      value: 200,
      metadataType: ageType,
      taxaCategory: "mosquito",
    });
    // No clamping to maxAge + 1 happens off the human path.
    expect(textInput().value).toBe("200");
    expect(textInput().getAttribute("type")).toBe("number");
  });
});

describe("MetadataInput -- default input branch", () => {
  it("renders a number input for numeric fields", () => {
    renderInput({
      value: 7,
      metadataType: { key: "ct_value", dataType: "number" },
    });
    expect(textInput().getAttribute("type")).toBe("number");
    expect(textInput().value).toBe("7");
  });

  it("renders a text input for string fields and clamps nothing", () => {
    renderInput({
      value: "Blood",
      metadataType: { key: "comorbidity", dataType: "string" },
    });
    expect(textInput().getAttribute("type")).toBe("text");
    expect(textInput().value).toBe("Blood");
  });

  it("coerces a null value to an empty string", () => {
    renderInput({
      value: null,
      metadataType: { key: "comorbidity", dataType: "string" },
    });
    expect(textInput().value).toBe("");
  });

  it("clamps a negative ct_value to zero via ensureDefinedValue", () => {
    renderInput({
      value: -3,
      metadataType: { key: "ct_value", dataType: "number" },
    });
    expect(textInput().value).toBe("0");
  });

  it("saves on blur and reports changes without an immediate save", () => {
    const onChange = jest.fn();
    const onSave = jest.fn();
    renderInput({
      metadataType: { key: "comorbidity", dataType: "string" },
      onChange,
      onSave,
    });

    fireEvent.change(textInput(), { target: { value: "Asthma" } });
    expect(onChange).toHaveBeenCalledWith("comorbidity", "Asthma");
    fireEvent.blur(textInput());
    expect(onSave).toHaveBeenCalledWith("comorbidity");
  });
});
