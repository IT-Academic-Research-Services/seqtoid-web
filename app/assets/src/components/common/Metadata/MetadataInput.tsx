import cx from "classnames";
import { isArray } from "lodash/fp";
import React, { useState } from "react";
import SampleTypeSearchBox from "~/components/common/SampleTypeSearchBox";
import { LocationObject, MetadataValue } from "~/interface/shared";
import Dropdown from "~ui/controls/dropdowns/Dropdown";
import GeoSearchInputBox, {
  getLocationWarning,
  processLocationSelection,
} from "~ui/controls/GeoSearchInputBox";
import Input from "~ui/controls/Input";
import Toggle from "~ui/controls/Toggle";
import { IconAlertSmall } from "~ui/icons";
import cs from "./metadata_input.scss";
import MetadataAgeInput from "./MetadataAgeInput";
import { MetadataInputProps } from "./types";
import { ensureDefinedValue } from "./utils";

const MetadataInput = ({
  value,
  onChange,
  onSave,
  metadataType,
  className,
  taxaCategory,
  sampleTypes,
  isHuman,
  withinModal,
  warning = "",
}: MetadataInputProps) => {
  const [checkedWarning, setCheckedWarning] = useState("");
  const [prevWarning, setPrevWarning] = useState<string | null>(null);

  // Give priority to warnings coming in through props
  if (warning !== prevWarning) {
    if (warning) {
      setCheckedWarning(warning);
    } else if (metadataType.dataType === "location") {
      setCheckedWarning(getLocationWarning(value));
    }
    setPrevWarning(warning);
  }

  // CZID-314: render the SampleTypeSearchBox for sample_type even when there is no value yet.
  // Previously this branch was gated on `typeof value === "string"`, so an EMPTY sample_type
  // (value === undefined) failed the guard and fell through to a plain text <Input> — the dropdown
  // only appeared once you typed a character (which made value a string). Drop the type gate and
  // coerce the value to a string for the component (it expects `value: string`). Other option-based
  // fields (Host Organism, Nucleotide Type) already render unconditionally, which is why they work.
  if (metadataType.key === "sample_type") {
    return (
      <SampleTypeSearchBox
        className={className}
        value={typeof value === "string" ? value : ""}
        onResultSelect={({ result }) => {
          onChange(metadataType.key, result.name, true);
        }}
        taxaCategory={taxaCategory}
        // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2322
        sampleTypes={sampleTypes}
      />
    );
  } else if (metadataType.isBoolean) {
    // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2533
    const onLabel = metadataType.options[0];
    // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2533
    const offLabel = metadataType.options[1];
    return (
      <Toggle
        initialChecked={value === onLabel}
        onLabel={onLabel}
        offLabel={offLabel}
        onChange={(label: MetadataValue) =>
          onChange(metadataType.key, label, true)
        }
        className={className}
      />
    );
  } else if (isArray(metadataType.options)) {
    const options = metadataType.options.map(option => ({
      text: option,
      value: option,
    }));
    return (
      <Dropdown
        fluid
        floating
        options={options}
        onChange={(val: MetadataValue) => onChange(metadataType.key, val, true)}
        value={value}
        className={className}
        usePortal
        withinModal={withinModal}
      />
    );
  } else if (metadataType.dataType === "date") {
    return (
      <Input
        className={className}
        onChange={(val: MetadataValue) => onChange(metadataType.key, val)}
        onBlur={() => onSave && onSave(metadataType.key)}
        value={ensureDefinedValue({
          key: metadataType.key,
          value,
          type: metadataType.dataType,
          taxaCategory,
        })}
        placeholder={taxaCategory === "human" ? "YYYY-MM" : "YYYY-MM-DD"}
        type="text"
      />
    );
  } else if (metadataType.dataType === "location") {
    return (
      <>
        <GeoSearchInputBox
          className={className}
          // .warning reference in old .idseq-ui.input file
          inputClassName={cx(warning && value && "warning")}
          // Calls save on selection
          onResultSelect={({ result: selection }) => {
            if ("geo_level" in selection) {
              const result = processLocationSelection(
                selection as LocationObject,
                taxaCategory === "human",
              );
              onChange(metadataType.key, result, true);
            } else {
              onChange(metadataType.key, selection.name, true);
            }
          }}
          value={typeof value === "number" ? value.toString() : value}
        />
        {warning && value && (
          <div className={cs.warning}>
            <div className={cs.icon}>
              <IconAlertSmall type="warning" />
            </div>
            <div>{checkedWarning}</div>
          </div>
        )}
      </>
    );
  } else if (
    metadataType.key === "host_age" &&
    (isHuman || taxaCategory === "human")
  ) {
    return (
      <MetadataAgeInput
        className={className}
        value={ensureDefinedValue({
          key: metadataType.key,
          value,
          type: metadataType.dataType,
          taxaCategory,
        })}
        metadataType={metadataType}
        onChange={onChange}
        onSave={onSave}
        ensureDefinedValue={ensureDefinedValue}
      />
    );
  } else {
    return (
      <Input
        className={className}
        onChange={(val: MetadataValue) => onChange(metadataType.key, val)}
        onBlur={() => onSave && onSave(metadataType.key)}
        value={ensureDefinedValue({
          key: metadataType.key,
          value,
          type: metadataType.dataType,
          taxaCategory,
        })}
        type={metadataType.dataType === "number" ? "number" : "text"}
      />
    );
  }
};

export default MetadataInput;
