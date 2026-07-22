import cx from "classnames";
import { forEach, sumBy, values } from "lodash/fp";
import React, { useEffect, useRef, useState } from "react";
import { BareDropdown } from "~ui/controls/dropdowns";
import Input from "~ui/controls/Input";
import cs from "./live_search_pop_box.scss";

export type SearchResult = {
  title: string;
  name: number | string;
  description?: string;
  [key: string]: any;
};

interface SearchCategory {
  name: string;
  results: SearchResult[];
}

export interface SearchResults {
  [key: string]: SearchCategory;
}

interface LiveSearchPopBoxProps {
  className?: string;
  delayTriggerSearch?: number;
  inputClassName?: string;
  inputMode?: boolean;
  minChars?: number;
  onResultSelect?(params: { currentEvent?: any; result: SearchResult }): void;
  onSearchTriggered?(query: string): SearchResults | Promise<SearchResults>;
  placeholder?: string;
  rectangular?: boolean;
  value?: string;
  icon?: string;
  shouldSearchOnFocus?: boolean;
}

const LiveSearchPopBox = ({
  className,
  delayTriggerSearch = 200,
  inputClassName,
  minChars = 2,
  placeholder = "Search",
  rectangular = false,
  inputMode = false,
  icon = "search",
  shouldSearchOnFocus = false,
  onResultSelect,
  onSearchTriggered,
  value,
}: LiveSearchPopBoxProps) => {
  const [latestTimerId, setLatestTimerId] = useState<any>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [results, setResults] = useState<SearchResults>({});

  // Use selectedResult state to keep track of the entire SearchResult object instead of just a string.
  // When a user types, we update it with a plain text SearchResult { title, name }.
  // When they select a suggestion, we set it to the full, rich SearchResult object.
  const [selectedResult, setSelectedResult] = useState<SearchResult>(() => ({
    title: value || "",
    name: value || "",
  }));
  const wasSelectedRef = useRef<boolean>(false);
  const blurTimeoutRef = useRef<any>(null);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  // If the value has changed from the parent, reset the selected result.
  useEffect(() => {
    setSelectedResult({ title: value || "", name: value || "" });
  }, [value]);

  const handleKeyDown = keyEvent => {
    // Pressing enter selects what they currently typed.
    if (keyEvent.key === "Enter" && inputMode) {
      handleResultSelect({
        result: selectedResult,
        currentEvent: {},
      });
    }
  };

  const closeDropdown = () => {
    setIsLoading(false);
    setIsFocused(false);
  };

  const handleResultSelect = ({ currentEvent, result }) => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }
    wasSelectedRef.current = true;
    setSelectedResult(result);
    onResultSelect && onResultSelect({ currentEvent, result });
    closeDropdown();
  };

  const triggerSearch = async (query: string) => {
    const timerId = latestTimerId;
    // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2722
    const results = await onSearchTriggered(query);

    if (timerId === latestTimerId) {
      setIsLoading(false);
      setResults(results);
    }
  };

  const handleSearchChange = (newValue: string) => {
    setSelectedResult({ title: newValue, name: newValue });

    // check minimum requirements for value
    const parsedValue = newValue.trim();
    if (parsedValue.length >= minChars) {
      setIsFocused(true);
      setIsLoading(true);

      if (latestTimerId) {
        clearTimeout(latestTimerId);
      }

      const newTimerId = setTimeout(
        () => triggerSearch(newValue),
        delayTriggerSearch,
      );
      setLatestTimerId(newTimerId);
    }
  };

  const renderSearchBox = () => (
    <div onFocus={handleFocus} onBlur={handleBlur}>
      <Input
        className={cx(
          cs.searchInput,
          rectangular && cs.rectangular,
          inputClassName,
        )}
        icon={icon}
        loading={isLoading}
        placeholder={placeholder}
        onChange={handleSearchChange}
        onKeyPress={handleKeyDown}
        value={selectedResult.title}
        disableAutocomplete
      />
    </div>
  );

  const handleFocus = () => {
    if (hasEnoughChars() && shouldSearchOnFocus) {
      handleSearchChange(selectedResult.title);
    }

    setIsFocused(true);
  };

  const handleBlur = () => {
    if (blurTimeoutRef.current) {
      clearTimeout(blurTimeoutRef.current);
    }

    blurTimeoutRef.current = setTimeout(() => {
      if (wasSelectedRef.current) {
        wasSelectedRef.current = false;
        closeDropdown();
        return;
      }

      // If the user has changed the input without selecting an option, select the typed plain-text.
      if (onResultSelect && selectedResult.title !== value) {
        onResultSelect({ result: selectedResult });
      }

      closeDropdown();
    }, 100);
  };

  const buildItem = (categoryKey: string, result: SearchResult, index) => (
    <BareDropdown.Item
      key={`${categoryKey}-${result.name}`}
      text={
        <div className={cs.entry}>
          <div className={cs.title}>{result.title}</div>
          {result.description && (
            <div className={cs.description}>{result.description}</div>
          )}
        </div>
      }
      onMouseDown={currentEvent => {
        // use onMouseDown instead of onClick to work with handleBlur
        handleResultSelect({ currentEvent, result });
      }}
      value={`${categoryKey}-${index}`}
    />
  );

  const buildSectionHeader = name => (
    <div key={name} className={cs.category}>
      {name}
    </div>
  );

  const renderDropdownItems = () => {
    // @ts-expect-error Property 'convert' does not exist on type 'LodashForEach'.ts(2339)
    const uncappedForEach = forEach.convert({ cap: false });
    const items = [];
    uncappedForEach((category: SearchCategory, key: string) => {
      // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2345
      items.push(buildSectionHeader(category.name));
      uncappedForEach((result: SearchResult, index) => {
        // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2345
        items.push(buildItem(key, result, index));
      }, category.results);
    }, results);

    return items;
  };

  const getResultsLength = () => {
    return sumBy(cat => cat?.results?.length, values(results));
  };

  const hasEnoughChars = () => selectedResult.title?.trim()?.length >= minChars;
  const shouldOpen = getResultsLength() && isFocused && hasEnoughChars();

  return (
    <BareDropdown
      className={cx(
        cs.liveSearchPopBox,
        rectangular && cs.rectangular,
        className,
      )}
      fluid
      hideArrow
      items={renderDropdownItems()}
      open={!!shouldOpen}
      trigger={renderSearchBox()}
      usePortal
      withinModal
      disableAutocomplete={true}
    />
  );
};

export default LiveSearchPopBox;
