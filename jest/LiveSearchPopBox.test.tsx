import { configure, shallow } from "enzyme";
import Adapter from "enzyme-adapter-react-16";
import React from "react";
import LiveSearchPopBox from "../app/assets/src/components/ui/controls/LiveSearchPopBox";

configure({ adapter: new Adapter() });

describe("LiveSearchPopBox", () => {
  it("renders correctly with default props", () => {
    const wrapper = shallow(<LiveSearchPopBox value="initial value" />);
    expect(wrapper).toBeTruthy();
    expect(wrapper.find("BareDropdown").length).toBe(1);
  });

  it("triggers onResultSelect with correct SearchResult format on keypress of Enter when inputMode is true", () => {
    const onResultSelectMock = jest.fn();
    const wrapper = shallow(
      <LiveSearchPopBox
        value="test-query"
        inputMode={true}
        onResultSelect={onResultSelectMock}
      />,
    );

    const trigger = wrapper
      .find("BareDropdown")
      .prop("trigger") as React.ReactElement;
    const triggerWrapper = shallow(trigger);

    // Simulate keyPress on Input inside trigger
    triggerWrapper.find("Input").simulate("keyPress", { key: "Enter" });

    // Since we initialized value="test-query", onResultSelect should be called with the structured SearchResult
    expect(onResultSelectMock).toHaveBeenCalledWith({
      currentEvent: {},
      result: {
        title: "test-query",
        name: "test-query",
      },
    });
  });

  it("triggers onResultSelect with correct SearchResult format on blur when value is untouched (does not trigger)", () => {
    const onResultSelectMock = jest.fn();
    const wrapper = shallow(
      <LiveSearchPopBox value="initial" onResultSelect={onResultSelectMock} />,
    );

    const trigger = wrapper
      .find("BareDropdown")
      .prop("trigger") as React.ReactElement;
    const triggerWrapper = shallow(trigger);

    // Simulate blur on the outer div of search box trigger
    triggerWrapper.simulate("blur");

    // Since value was initial, and inputValue is initial, onResultSelect shouldn't be called.
    expect(onResultSelectMock).not.toHaveBeenCalled();
  });
});
