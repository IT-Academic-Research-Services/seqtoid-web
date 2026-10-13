import { Autocomplete, TextField } from "@mui/material"; // TODO: migrate to czifui DropdownMenu
import axios from "axios";
import React, { useEffect, useRef, useState } from "react";
import cs from "./institution_form_field.scss";

interface InstitutionFormFieldProps {
  setInstitution: (institution: string) => void;
  setRORId: (rorId: string) => void;
}

// ROR v2 search. The unversioned /organizations endpoint now serves the v2 schema (no top-level
// `name`/`country`), and /v1 returns 410 since ROR retired it on 2025-12-09, so pin v2 explicitly.
// See https://ror.readme.io/docs/rest-api
export const ROR_SEARCH_URL = "https://api.ror.org/v2/organizations";
export const ROR_SEARCH_DEBOUNCE_MS = 300;

// ROR hands `query` to Elasticsearch query-string syntax. A reserved character (e.g. the "-" in
// "ILVO -" while someone types "ILVO - Flanders...", an unclosed "(", ":" or "/") or a bare upper-case
// AND/OR/NOT makes ROR answer HTTP 200 with {"errors": [...]} and no `items`. Strip the reserved
// characters and lower-case the operators so every keystroke is a plain-text search.
const ROR_RESERVED_CHARS = /[+\-=&|><!(){}[\]^"~*?:\\/]/g;
const ROR_BOOLEAN_OPERATORS = /\b(AND|OR|NOT)\b/g;

export const sanitizeRORQuery = (value: string): string =>
  value
    .replace(ROR_RESERVED_CHARS, " ")
    .replace(ROR_BOOLEAN_OPERATORS, op => op.toLowerCase())
    .replace(/\s+/g, " ")
    .trim();

interface RORName {
  value?: string;
  types?: string[];
}

interface RORItem {
  id?: string;
  names?: RORName[];
}

// The display name of a v2 organization: the `ror_display` name, else the first label, else the
// first name of any type.
export const rorDisplayName = (item: RORItem): string | undefined => {
  const names = Array.isArray(item?.names) ? item.names : [];
  const pick =
    names.find(n => n?.types?.includes("ror_display")) ||
    names.find(n => n?.types?.includes("label")) ||
    names[0];
  return pick?.value || undefined;
};

// Name -> ROR id for the results that have both. Anything that is not a list of items (an error body,
// an unexpected shape) is treated as "no results" rather than crashing the form.
export const rorNameToId = (data: unknown): Record<string, string> => {
  const items = (data as { items?: unknown })?.items;
  if (!Array.isArray(items)) return {};
  return items.reduce((acc: Record<string, string>, item: RORItem) => {
    const name = rorDisplayName(item);
    if (name && item?.id && !(name in acc)) acc[name] = item.id;
    return acc;
  }, {});
};

export function InstitutionFormField({
  setInstitution,
  setRORId,
}: InstitutionFormFieldProps) {
  const [nameToRORId, setNameToRORId] = useState<Record<string, string>>({});
  const [inputValue, setInputValue] = useState<string>("");
  const touched = useRef(false);
  const latestRequest = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Report what the user typed on every change -- not only when ROR returned matches -- so an
  // institution that is not in ROR (or a last keystroke with no matches) still reaches the parent.
  // The ROR id is set only for an exact match with a returned name. Nothing is reported before the
  // user has typed, so a parent's initial value is never cleared on mount.
  useEffect(() => {
    if (!touched.current) return;
    setInstitution(inputValue.trim());
    setRORId(nameToRORId[inputValue] || "");
  }, [inputValue, nameToRORId]);

  useEffect(
    () => () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    },
    [],
  );

  const fetchRORData = async (value: string) => {
    const query = sanitizeRORQuery(value);
    const requestId = ++latestRequest.current;
    if (!query) {
      setNameToRORId({});
      return;
    }
    try {
      const response = await axios.get(
        `${ROR_SEARCH_URL}?query=${encodeURIComponent(query)}`,
      );
      // Drop replies that arrive after a newer keystroke's request was sent.
      if (requestId !== latestRequest.current) return;
      setNameToRORId(rorNameToId(response?.data));
    } catch {
      // The directory is a convenience: on failure keep the field usable as free text.
      if (requestId === latestRequest.current) setNameToRORId({});
    }
  };

  const scheduleFetch = (value: string) => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(
      () => fetchRORData(value),
      ROR_SEARCH_DEBOUNCE_MS,
    );
  };

  const handleInputChange = (
    _: React.SyntheticEvent,
    value: string | null,
    reason: string,
  ) => {
    if (reason === "clear" || value === null) {
      touched.current = true;
      setInputValue("");
      return;
    }
    touched.current = true;
    setInputValue(value);
    scheduleFetch(value);
  };

  const handleSelectChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    touched.current = true;
    setInputValue(event.target.value);
  };

  return (
    <div className={cs.main}>
      <div className={cs.titleSection}>
        <span className={cs.titleMainText}>Institution</span>
      </div>

      <div>
        <Autocomplete
          className={cs.autocomplete}
          size={"small"}
          autoComplete={true}
          fullWidth={false}
          freeSolo={true}
          disablePortal
          options={Object.keys(nameToRORId)}
          // ROR has already matched these (names, acronyms, aliases). MUI's default client-side filter
          // would then hide any result whose display name does not contain the typed text, e.g. "ILVO"
          // finds "Instituut voor Landbouw en Visserijonderzoek" by acronym but the list showed nothing.
          filterOptions={options => options}
          onInputChange={handleInputChange}
          onSelect={handleSelectChange}
          renderInput={params => (
            <TextField
              value={inputValue}
              placeholder="Institution Name"
              {...params}
            />
          )}
        />
      </div>
    </div>
  );
}
