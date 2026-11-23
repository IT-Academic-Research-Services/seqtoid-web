import { Autocomplete, TextField } from "@mui/material"; // TODO: migrate to czifui DropdownMenu
import axios from "axios";
import React, { useEffect, useState } from "react";
import cs from "./country_form_field.scss";

interface CountryFormFieldProps {
  setCountry: (country: string) => void;
  setWorldBankIncome: (income: string) => void;
}

interface CountryInfo {
  region?: string;
  incomeLevel?: string;
}

export function CountryFormField({
  setCountry,
  setWorldBankIncome,
}: CountryFormFieldProps) {
  const [countries, setCountries] = useState<string[]>([]);
  const [countryNameToInfo, setCountryNameToInfo] = useState<
    Record<string, CountryInfo>
  >({});
  // The Autocomplete's two concerns are kept as separate state: `value` is the
  // chosen country (an option or null); `inputValue` is the text in the box.
  // Collapsing them caused the field to wipe the first character typed.
  const [value, setValue] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState<string>("");
  const [fetchError, setFetchError] = useState<string>("");

  // Load the full country list once on mount. The World Bank API ignores the
  // `prefix` query param and returns the same list on every call, so fetching
  // per keystroke buys nothing, couples typing to network latency, and leaves a
  // keystroke reading a stale `countries` list. MUI filters the list
  // client-side as the user types.
  // see: https://documents.worldbank.org/en/publication/documents-reports/api
  useEffect(() => {
    const fetchCountries = async () => {
      try {
        const response = await axios.get(
          "https://api.worldbank.org/v2/country?format=json&per_page=1000",
        );
        const countriesData = response.data[1];
        const nameToInfo = countriesData.reduce(
          (acc: Record<string, CountryInfo>, item) => {
            acc[item["name"]] = {
              region: item?.region?.value,
              incomeLevel: item?.incomeLevel?.value,
            };
            return acc;
          },
          {},
        );
        setCountryNameToInfo(nameToInfo);
        setCountries(Object.keys(nameToInfo));
        setFetchError("");
      } catch {
        setFetchError(
          "Could not load the country list. Please try again later.",
        );
      }
    };
    fetchCountries();
  }, []);

  // Country/income are reported to the parent only on an actual selection (or
  // cleared when the field is cleared), not while the user is still typing.
  const handleChange = (_: React.SyntheticEvent, newValue: string | null) => {
    setValue(newValue);
    setCountry(newValue?.trim() ?? "");
    setWorldBankIncome(
      newValue && newValue in countryNameToInfo
        ? countryNameToInfo[newValue]?.incomeLevel ?? ""
        : "",
    );
  };

  return (
    <div className={cs.main}>
      <div className={cs.titleSection}>
        <span className={cs.titleMainText}>Country</span>
      </div>

      <div>
        <Autocomplete
          className={cs.autocomplete}
          size={"small"}
          fullWidth={false}
          disablePortal
          options={countries}
          value={value}
          inputValue={inputValue}
          onChange={handleChange}
          onInputChange={(_, newInputValue) => setInputValue(newInputValue)}
          renderInput={params => (
            <TextField
              {...params}
              placeholder="Choose Country"
              error={Boolean(fetchError)}
              helperText={fetchError || undefined}
            />
          )}
        />
      </div>
    </div>
  );
}
