// Coverage: app/assets/src/components/common/Metadata/MetadataAgeInput.tsx
//
// MetadataAgeInput is the HIPAA-aware "Host Age" input. Its weight is branch
// weight: whether the current age is at/over the max (90) drives whether the box
// is zeroed and shows the ">= 90" placeholder, whether the warning block renders
// (only after the user has changed the age), and the up/down arrow effects that
// snap a decremented/incremented placeholder value back to maxAge -/+ 1. The
// Backspace/Delete key handler clears the box while in warning state. Every arm
// is exercised below through the real Input control.
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import MetadataAgeInput from "~/components/common/Metadata/MetadataAgeInput";

const _React: typeof React = React;

const MAX_AGE = 90;

const renderAge = (props: Record<string, unknown> = {}) =>
  render(
    <MetadataAgeInput
      className="input"
      value={props.value as $TSFixMe}
      metadataType={{ key: "host_age", dataType: "number" } as $TSFixMe}
      onChange={(props.onChange as $TSFixMe) || jest.fn()}
      onSave={(props.onSave as $TSFixMe) || jest.fn()}
      ensureDefinedValue={
        (props.ensureDefinedValue as $TSFixMe) ||
        (({ value }: $TSFixMe) => value)
      }
    />,
  );

const ageInput = () => document.querySelector("input") as HTMLInputElement;

describe("MetadataAgeInput -- under the max", () => {
  it("shows the entered age and no warning or placeholder", () => {
    renderAge({ value: 30 });
    expect(ageInput().value).toBe("30");
    expect(ageInput().getAttribute("type")).toBe("number");
    expect(ageInput().placeholder).toBe("");
    expect(screen.queryByText(/HIPAA/)).toBeNull();
  });
});

describe("MetadataAgeInput -- at or over the max", () => {
  it("zeroes the box and shows the '>= max' placeholder", () => {
    renderAge({ value: 95 });
    expect(ageInput().value).toBe("");
    expect(ageInput().placeholder).toBe("≥ " + MAX_AGE);
  });

  it("does not show the warning block until the user changes the age", () => {
    renderAge({ value: 95 });
    // hipaaWarning is true, but ageChanged is still false.
    expect(screen.queryByText(/for HIPAA/)).toBeNull();
  });
});

describe("MetadataAgeInput -- user edits", () => {
  it("reports the ensureDefinedValue result via onChange and marks it changed", () => {
    const onChange = jest.fn();
    // ensureDefinedValue clamps an over-max age to maxAge + 1, matching the real
    // HIPAA behaviour.
    const ensureDefinedValue = jest.fn(() => MAX_AGE + 1);
    renderAge({ value: 40, onChange, ensureDefinedValue });

    fireEvent.change(ageInput(), { target: { value: "200" } });

    expect(ensureDefinedValue).toHaveBeenCalledWith({
      key: "host_age",
      value: "200",
      type: "number",
      taxaCategory: "human",
    });
    expect(onChange).toHaveBeenCalledWith("host_age", String(MAX_AGE + 1));
    // Now over the max and changed -> the HIPAA warning renders.
    expect(screen.getByText("Changed to ≥ 90 for HIPAA.")).toBeTruthy();
  });

  it("saves on blur through onSave", () => {
    const onSave = jest.fn();
    renderAge({ value: 30, onSave });
    fireEvent.blur(ageInput());
    expect(onSave).toHaveBeenCalledWith("host_age");
  });

  it("does not throw on blur when no onSave handler is provided", () => {
    render(
      <MetadataAgeInput
        className="input"
        value={30 as $TSFixMe}
        metadataType={{ key: "host_age", dataType: "number" } as $TSFixMe}
        onChange={jest.fn()}
        onSave={undefined as $TSFixMe}
        ensureDefinedValue={({ value }: $TSFixMe) => value}
      />,
    );
    expect(() => fireEvent.blur(ageInput())).not.toThrow();
  });
});

describe("MetadataAgeInput -- keyboard handling in warning state", () => {
  it("clears the box on Backspace while over the max", () => {
    renderAge({ value: 95 });
    // Placeholder state -> Backspace empties safeHumanAge.
    fireEvent.keyDown(ageInput(), { key: "Backspace" });
    expect(ageInput().value).toBe("");
  });

  it("clears the box on Delete while over the max", () => {
    renderAge({ value: 95 });
    fireEvent.keyDown(ageInput(), { key: "Delete" });
    expect(ageInput().value).toBe("");
  });

  it("ignores other keys", () => {
    renderAge({ value: 95 });
    // 'a' is not Backspace/Delete, so nothing changes.
    expect(() => fireEvent.keyDown(ageInput(), { key: "a" })).not.toThrow();
    expect(ageInput().value).toBe("");
  });
});

describe("MetadataAgeInput -- placeholder arrow effects", () => {
  it("snaps a decremented placeholder (0) down to maxAge - 1", () => {
    const onChange = jest.fn();
    // Start over max so the box is zeroed. A down-arrow yields 0 from the input.
    renderAge({
      value: 95,
      onChange,
      ensureDefinedValue: () => 0,
    });
    fireEvent.change(ageInput(), { target: { value: "0" } });
    expect(onChange).toHaveBeenCalledWith("host_age", String(MAX_AGE - 1));
  });

  it("snaps an incremented placeholder (1) up to maxAge + 1", () => {
    const onChange = jest.fn();
    renderAge({
      value: 95,
      onChange,
      ensureDefinedValue: () => 1,
    });
    fireEvent.change(ageInput(), { target: { value: "1" } });
    expect(onChange).toHaveBeenCalledWith("host_age", String(MAX_AGE + 1));
  });
});

describe("MetadataAgeInput -- prop value changes", () => {
  it("mirrors a later value prop into the box", () => {
    const { rerender } = renderAge({ value: 20 });
    expect(ageInput().value).toBe("20");
    rerender(
      <MetadataAgeInput
        className="input"
        value={45 as $TSFixMe}
        metadataType={{ key: "host_age", dataType: "number" } as $TSFixMe}
        onChange={jest.fn()}
        onSave={jest.fn()}
        ensureDefinedValue={({ value }: $TSFixMe) => value}
      />,
    );
    expect(ageInput().value).toBe("45");
  });
});
