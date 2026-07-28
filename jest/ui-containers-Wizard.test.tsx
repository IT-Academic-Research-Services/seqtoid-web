// Coverage for the multi-step Wizard container that drives the sample upload
// flow. The interesting logic is the continue/back/finish state machine and the
// four mutually exclusive ways a page can gate "continue" (onContinue,
// onContinueAsync, a registered validation callback, or nothing at all).
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import Wizard from "~/components/ui/containers/Wizard";

// Keeps prettier's organize-imports from dropping the React import that the
// classic JSX runtime needs in scope.
const _React: typeof React = React;

/**
 * A custom wizard page: unlike Wizard.Page it uses the hooks the Wizard injects
 * via cloneElement, so it can enable the Continue button (which starts
 * disabled) and optionally register a validation callback / set an overlay.
 */
const CustomPage = (props: $TSFixMe) => {
  const {
    children,
    wizardEnableContinue,
    wizardSetOnContinueValidation,
    onValidate,
  } = props;
  React.useEffect(() => {
    wizardEnableContinue && wizardEnableContinue(true);
    if (onValidate && wizardSetOnContinueValidation) {
      wizardSetOnContinueValidation(onValidate);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div>{children}</div>;
};

const threePages = (extra: $TSFixMe = {}) => [
  <CustomPage key="a" title="Page One" {...(extra.one || {})}>
    one-body
  </CustomPage>,
  <CustomPage key="b" title="Page Two" {...(extra.two || {})}>
    two-body
  </CustomPage>,
  <CustomPage key="c" title="Page Three" {...(extra.three || {})}>
    three-body
  </CustomPage>,
];

const clickButton = (label: string) =>
  fireEvent.click(screen.getByText(label).closest("button") as HTMLElement);

describe("Wizard navigation", () => {
  it("renders the first page, its title and the 'n of m' page info", () => {
    render(<Wizard onComplete={jest.fn()}>{threePages()}</Wizard>);
    expect(screen.getByText("one-body")).toBeTruthy();
    expect(screen.getByText("Page One")).toBeTruthy();
    expect(screen.getByText("1 of 3")).toBeTruthy();
    // On the first page there is no Back button and no Finish button.
    expect(screen.queryByText("Back")).toBeNull();
    expect(screen.queryByText("Finish")).toBeNull();
    expect(screen.getByText("Continue")).toBeTruthy();
  });

  it("falls back to the wizard title when the page has none", () => {
    render(
      <Wizard onComplete={jest.fn()} title="Wizard Title">
        {[<Wizard.Page key="a">body</Wizard.Page>]}
      </Wizard>,
    );
    expect(screen.getByText("Wizard Title")).toBeTruthy();
  });

  it("disables Continue until a page enables it", () => {
    render(
      <Wizard onComplete={jest.fn()}>
        {[
          <Wizard.Page key="a">plain</Wizard.Page>,
          <Wizard.Page key="b">plain2</Wizard.Page>,
        ]}
      </Wizard>,
    );
    const button = screen.getByText("Continue").closest("button");
    expect((button as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button as HTMLElement);
    expect(screen.getByText("plain")).toBeTruthy();
  });

  it("advances forward, shows Back, and goes back again", async () => {
    render(<Wizard onComplete={jest.fn()}>{threePages()}</Wizard>);
    clickButton("Continue");
    await waitFor(() => expect(screen.getByText("two-body")).toBeTruthy());
    expect(screen.getByText("2 of 3")).toBeTruthy();
    expect(screen.getByText("Back")).toBeTruthy();

    clickButton("Back");
    await waitFor(() => expect(screen.getByText("one-body")).toBeTruthy());
    expect(screen.queryByText("Back")).toBeNull();
  });

  it("shows Finish on the last page and calls onComplete", async () => {
    const onComplete = jest.fn();
    render(<Wizard onComplete={onComplete}>{threePages()}</Wizard>);
    clickButton("Continue");
    await waitFor(() => expect(screen.getByText("two-body")).toBeTruthy());
    clickButton("Continue");
    await waitFor(() => expect(screen.getByText("three-body")).toBeTruthy());

    expect(screen.queryByText("Continue")).toBeNull();
    clickButton("Finish");
    expect(onComplete).toHaveBeenCalledTimes(1);
  });

  it("does not advance past the last page", async () => {
    render(
      <Wizard onComplete={jest.fn()}>
        {[
          <CustomPage key="a" title="Only">
            only-body
          </CustomPage>,
        ]}
      </Wizard>,
    );
    // A single page is immediately the last page: Finish only.
    expect(screen.queryByText("Continue")).toBeNull();
    expect(screen.getByText("Finish")).toBeTruthy();
    expect(screen.getByText("1 of 1")).toBeTruthy();
  });

  it("honors custom labels", () => {
    render(
      <Wizard
        onComplete={jest.fn()}
        labels={{ back: "Prev", continue: "Next", finish: "Done" }}
      >
        {threePages()}
      </Wizard>,
    );
    expect(screen.getByText("Next")).toBeTruthy();
    expect(screen.queryByText("Continue")).toBeNull();
  });

  it("starts on defaultPage when one is supplied", () => {
    render(
      <Wizard onComplete={jest.fn()} {...({ defaultPage: 1 } as $TSFixMe)}>
        {threePages()}
      </Wizard>,
    );
    expect(screen.getByText("two-body")).toBeTruthy();
    expect(screen.getByText("Back")).toBeTruthy();
  });

  it("hides page info for the first skipPageInfoNPages pages", async () => {
    render(
      <Wizard onComplete={jest.fn()} skipPageInfoNPages={1}>
        {threePages()}
      </Wizard>,
    );
    expect(screen.queryByText(/ of /)).toBeNull();
    clickButton("Continue");
    await waitFor(() => expect(screen.getByText("two-body")).toBeTruthy());
    // Page 2 is the first counted page, out of the 2 remaining pages.
    expect(screen.getByText("1 of 2")).toBeTruthy();
  });

  it("omits the default nav buttons when a page opts out", () => {
    render(
      <Wizard onComplete={jest.fn()}>
        {[
          <CustomPage key="a" title="No Nav" skipDefaultButtons>
            no-nav-body
          </CustomPage>,
          <CustomPage key="b" title="Second">
            second-body
          </CustomPage>,
        ]}
      </Wizard>,
    );
    expect(screen.getByText("no-nav-body")).toBeTruthy();
    expect(screen.queryByText("Continue")).toBeNull();
    expect(screen.queryByText("Finish")).toBeNull();
  });
});

describe("Wizard continue gating", () => {
  it("advances only when a synchronous onContinue returns true", async () => {
    const onContinue = jest.fn().mockReturnValue(false);
    render(
      <Wizard onComplete={jest.fn()}>
        {threePages({ one: { onContinue } })}
      </Wizard>,
    );
    clickButton("Continue");
    await waitFor(() => expect(onContinue).toHaveBeenCalledTimes(1));
    expect(screen.getByText("one-body")).toBeTruthy();

    onContinue.mockReturnValue(true);
    clickButton("Continue");
    await waitFor(() => expect(screen.getByText("two-body")).toBeTruthy());
  });

  it("awaits onContinueAsync and blocks on a falsy result", async () => {
    const onContinueAsync = jest.fn().mockResolvedValue(false);
    render(
      <Wizard onComplete={jest.fn()}>
        {threePages({ one: { onContinueAsync } })}
      </Wizard>,
    );
    clickButton("Continue");
    await waitFor(() => expect(onContinueAsync).toHaveBeenCalledTimes(1));
    expect(screen.getByText("one-body")).toBeTruthy();

    onContinueAsync.mockResolvedValue(true);
    clickButton("Continue");
    await waitFor(() => expect(screen.getByText("two-body")).toBeTruthy());
  });

  it("uses a page-registered validation callback when there is no onContinue", async () => {
    const onValidate = jest.fn().mockResolvedValue(false);
    render(
      <Wizard onComplete={jest.fn()}>
        {threePages({ one: { onValidate } })}
      </Wizard>,
    );
    clickButton("Continue");
    await waitFor(() => expect(onValidate).toHaveBeenCalledTimes(1));
    expect(screen.getByText("one-body")).toBeTruthy();

    onValidate.mockResolvedValue(true);
    clickButton("Continue");
    await waitFor(() => expect(screen.getByText("two-body")).toBeTruthy());
  });

  it("prefers onContinue over a registered validation callback", async () => {
    const onValidate = jest.fn().mockResolvedValue(true);
    const onContinue = jest.fn().mockReturnValue(true);
    render(
      <Wizard onComplete={jest.fn()}>
        {threePages({ one: { onValidate, onContinue } })}
      </Wizard>,
    );
    clickButton("Continue");
    await waitFor(() => expect(screen.getByText("two-body")).toBeTruthy());
    expect(onValidate).not.toHaveBeenCalled();
  });
});

describe("Wizard overlay", () => {
  const OverlayPage = ({
    wizardSetOverlay,
    wizardEnableContinue,
  }: $TSFixMe) => (
    <div>
      <button
        onClick={() => wizardSetOverlay(<div>the-overlay</div>)}
        type="button"
      >
        show-overlay
      </button>
      <button onClick={() => wizardEnableContinue(true)} type="button">
        enable
      </button>
    </div>
  );

  it("renders the overlay and hides the wizard body when set", () => {
    const { container } = render(
      <Wizard onComplete={jest.fn()}>
        {[<OverlayPage key="a" title="Overlay Page" />]}
      </Wizard>,
    );
    expect(container.querySelector(".wizard__hidden")).toBeNull();
    fireEvent.click(screen.getByText("show-overlay"));
    expect(screen.getByText("the-overlay")).toBeTruthy();
    expect(container.querySelector(".wizard__hidden")).toBeTruthy();
  });
});

describe("Wizard.Page", () => {
  it("calls onLoad on mount and renders its children", () => {
    const onLoad = jest.fn();
    render(
      <Wizard onComplete={jest.fn()}>
        {[
          <Wizard.Page key="a" onLoad={onLoad}>
            page-child
          </Wizard.Page>,
        ]}
      </Wizard>,
    );
    expect(onLoad).toHaveBeenCalledTimes(1);
    expect(screen.getByText("page-child")).toBeTruthy();
  });

  it("renders without an onLoad handler", () => {
    render(
      <Wizard onComplete={jest.fn()}>
        {[<Wizard.Page key="a">plain-child</Wizard.Page>]}
      </Wizard>,
    );
    expect(screen.getByText("plain-child")).toBeTruthy();
  });
});

describe("Wizard.Action", () => {
  const pagesWithActions = [
    <CustomPage key="a" title="One">
      <Wizard.Action action="continue">go-forward</Wizard.Action>
      <Wizard.Action action="back">go-back</Wizard.Action>
    </CustomPage>,
    <CustomPage key="b" title="Two">
      two-body
    </CustomPage>,
  ];

  it("invokes the wizard action from the context", async () => {
    render(<Wizard onComplete={jest.fn()}>{pagesWithActions}</Wizard>);
    // Back on page 0 is a no-op (guarded by currentPage > 0).
    fireEvent.click(screen.getByText("go-back"));
    expect(screen.getByText("go-forward")).toBeTruthy();

    fireEvent.click(screen.getByText("go-forward"));
    await waitFor(() => expect(screen.getByText("two-body")).toBeTruthy());
  });

  it("calls onAfterAction once the action has run", async () => {
    const onAfterAction = jest.fn();
    render(
      <Wizard onComplete={jest.fn()}>
        {[
          <CustomPage key="a" title="One">
            <Wizard.Action action="continue" onAfterAction={onAfterAction}>
              go
            </Wizard.Action>
          </CustomPage>,
          <CustomPage key="b" title="Two">
            two-body
          </CustomPage>,
        ]}
      </Wizard>,
    );
    fireEvent.click(screen.getByText("go"));
    await waitFor(() => expect(onAfterAction).toHaveBeenCalledTimes(1));
    expect(screen.getByText("two-body")).toBeTruthy();
  });
});
