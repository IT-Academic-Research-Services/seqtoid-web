// Coverage: app/assets/src/components/utils/toast.ts
// showToast is a thin wrapper around react-toastify that pins a set of default
// toast options. The two branches worth pinning are the default `params = {}`
// arm and the caller-supplied-params arm (which must be able to override the
// defaults, because it is spread last).
jest.mock("react-toastify", () => ({ toast: jest.fn() }));

import { toast } from "react-toastify";
import { showToast } from "../app/assets/src/components/utils/toast";

const toastMock = toast as unknown as jest.Mock;

describe("utils/toast showToast", () => {
  beforeEach(() => {
    toastMock.mockClear();
  });

  it("forwards the component and applies the default toast options", () => {
    const component = () => "hello";
    showToast(component as $TSFixMe);

    expect(toastMock).toHaveBeenCalledTimes(1);
    const [passedComponent, options] = toastMock.mock.calls[0];
    expect(passedComponent).toBe(component);
    expect(options).toEqual({
      closeButton: false,
      closeOnClick: false,
      draggable: false,
      hideProgressBar: true,
    });
  });

  it("merges caller params on top of the defaults", () => {
    const component = () => "bye";
    showToast(component as $TSFixMe, {
      autoClose: 1234,
      closeOnClick: true,
    });

    const options = toastMock.mock.calls[0][1];
    // caller value wins over the default
    expect(options.closeOnClick).toBe(true);
    // extra caller keys are passed through
    expect(options.autoClose).toBe(1234);
    // untouched defaults survive the merge
    expect(options.closeButton).toBe(false);
    expect(options.draggable).toBe(false);
    expect(options.hideProgressBar).toBe(true);
  });
});
