// Coverage: app/assets/src/components/views/PathogenListView/components/AnchorMenu/AnchorMenu.tsx
// The menu groups pathogens by category into <Section>s and wires an
// IntersectionObserver whose callback maps the first intersecting section back
// to its index. The branches worth exercising are the callback's
// "any intersecting entry?" guard (0 vs >0), the optional-chained
// `entry?.target?.id` (an entry with no target), and an id that matches no
// section (findIndex -> -1).
//
// react-relay is mocked so `useFragment` just hands the fragment key back --
// the component only reads `data.pathogens`.
import { render, screen } from "@testing-library/react";
import { AnchorMenu } from "~/components/views/PathogenListView/components/AnchorMenu/AnchorMenu";

jest.mock("react-relay", () => ({
  graphql: () => ({}),
  useFragment: (_fragment: unknown, key: unknown) => key,
}));

const PATHOGEN_DATA = {
  pathogens: [
    { category: "Viruses", name: "Zika virus", taxId: 64320 },
    { category: "Bacteria", name: "Vibrio cholerae", taxId: 666 },
    { category: "Bacteria", name: "Bacillus anthracis", taxId: 1392 },
    { category: "Fungi", name: "Candida auris", taxId: 498019 },
  ],
} as $TSFixMe;

let observerCallbacks: IntersectionObserverCallback[];
let observed: Element[];
let unobserved: Element[];

beforeEach(() => {
  observerCallbacks = [];
  observed = [];
  unobserved = [];

  class FakeIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      observerCallbacks.push(callback);
    }
    observe(el: Element) {
      observed.push(el);
    }
    unobserve(el: Element) {
      unobserved.push(el);
    }
    disconnect() {
      // no-op
    }
  }

  (global as $TSFixMe).IntersectionObserver = FakeIntersectionObserver;
});

// Invoke the most recently constructed observer's callback.
const fire = (entries: unknown[]) =>
  (observerCallbacks[observerCallbacks.length - 1] as $TSFixMe)(entries);

describe("AnchorMenu", () => {
  it("renders one section per category, alphabetized by pathogen name", () => {
    render(
      <AnchorMenu
        pathogenData={PATHOGEN_DATA}
        setCurrentSectionIndex={jest.fn()}
      />,
    );

    // categorizeItems sorts by name first, so Bacillus (B) precedes Candida (C)
    // precedes Vibrio (V) precedes Zika (Z) -- giving Bacteria, Fungi, Viruses.
    const headings = screen.getAllByRole("heading").map(h => h.textContent);
    expect(headings).toEqual(["Bacteria", "Fungi", "Viruses"]);

    expect(screen.getByText("Bacillus anthracis")).toBeTruthy();
    expect(screen.getByText("Vibrio cholerae")).toBeTruthy();
    expect(screen.getByText("Candida auris")).toBeTruthy();
    expect(screen.getByText("Zika virus")).toBeTruthy();
  });

  it("gives each section a slugified id and observes it", () => {
    const { container } = render(
      <AnchorMenu
        pathogenData={
          {
            pathogens: [
              { category: "Large DNA viruses", name: "Variola", taxId: 10255 },
            ],
          } as $TSFixMe
        }
        setCurrentSectionIndex={jest.fn()}
      />,
    );

    expect(container.querySelector("#large-dna-viruses")).toBeTruthy();
    // The observer is created in an effect, so the sections re-render once it
    // exists and then register themselves.
    expect(observed).toHaveLength(1);
    expect((observed[0] as HTMLElement).id).toBe("large-dna-viruses");
  });

  it("reports the index of the first intersecting section", () => {
    const setCurrentSectionIndex = jest.fn();
    render(
      <AnchorMenu
        pathogenData={PATHOGEN_DATA}
        setCurrentSectionIndex={setCurrentSectionIndex}
      />,
    );

    fire([
      { isIntersecting: false, target: { id: "bacteria" } },
      { isIntersecting: true, target: { id: "viruses" } },
    ]);
    expect(setCurrentSectionIndex).toHaveBeenCalledWith(2);

    fire([{ isIntersecting: true, target: { id: "fungi" } }]);
    expect(setCurrentSectionIndex).toHaveBeenLastCalledWith(1);
  });

  it("does nothing when no entry is intersecting", () => {
    const setCurrentSectionIndex = jest.fn();
    render(
      <AnchorMenu
        pathogenData={PATHOGEN_DATA}
        setCurrentSectionIndex={setCurrentSectionIndex}
      />,
    );

    fire([]);
    fire([{ isIntersecting: false, target: { id: "bacteria" } }]);
    expect(setCurrentSectionIndex).not.toHaveBeenCalled();
  });

  it("reports -1 for an intersecting entry with an unknown or missing target", () => {
    const setCurrentSectionIndex = jest.fn();
    render(
      <AnchorMenu
        pathogenData={PATHOGEN_DATA}
        setCurrentSectionIndex={setCurrentSectionIndex}
      />,
    );

    fire([{ isIntersecting: true, target: { id: "protozoa" } }]);
    expect(setCurrentSectionIndex).toHaveBeenLastCalledWith(-1);

    // The optional chaining on `target` keeps a target-less entry from throwing.
    fire([{ isIntersecting: true }]);
    expect(setCurrentSectionIndex).toHaveBeenLastCalledWith(-1);
    expect(setCurrentSectionIndex).toHaveBeenCalledTimes(2);
  });

  it("renders nothing but an empty container for an empty pathogen list", () => {
    const { container } = render(
      <AnchorMenu
        pathogenData={{ pathogens: [] } as $TSFixMe}
        setCurrentSectionIndex={jest.fn()}
      />,
    );

    expect(screen.queryAllByRole("heading")).toHaveLength(0);
    expect((container.firstChild as HTMLElement).childNodes).toHaveLength(0);
    expect(observed).toHaveLength(0);
  });

  it("unobserves its sections on unmount", () => {
    const { unmount } = render(
      <AnchorMenu
        pathogenData={PATHOGEN_DATA}
        setCurrentSectionIndex={jest.fn()}
      />,
    );

    expect(observed).toHaveLength(3);
    unmount();
    expect(unobserved).toHaveLength(3);
  });
});
