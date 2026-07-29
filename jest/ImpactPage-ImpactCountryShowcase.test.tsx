// Coverage: app/assets/src/components/views/ImpactPage/components/ImpactCountryShowcase/ImpactCountryShowcase.tsx
// The showcase renders a scroller of every grant country plus a detail window
// for the selected one. Branch-heavy areas: which country map artwork is shown
// (the inline Brazil/Gambia/Guinea/Pakistan SVGs vs an <img>), the optional
// headshot, singular vs plural publication buttons, and the prev/next nav,
// whose guards use a truthiness check on the index (so index 0 is treated as
// "no previous").
//
// ImpactCountryData is mocked wholesale: the real module `require()`s a dozen
// PNGs, which jest.config.js has no mapper for, and a fixture lets us drive
// every rendering branch deterministically.
import { fireEvent, render, screen } from "@testing-library/react";
import { ImpactCountryShowcase } from "~/components/views/ImpactPage/components/ImpactCountryShowcase/ImpactCountryShowcase";

jest.mock("~/components/views/ImpactPage/components/ImpactCountryData", () => ({
  ImpactCountryData: [
    {
      countryName: "Brazil",
      institution: "Fiocruz, Bahia",
      principalInvestigator: "Federico Costa",
      projectTitle: "Surveillance in Brazil",
      summary: "Brazil cycle one summary.",
      cycle: 1,
      nextCountryIndex: 1,
    },
    {
      countryName: "Brazil",
      institution: "Fiocruz, Rio de Janeiro",
      principalInvestigator: "Ida Kolte",
      projectTitle: "Severe Lung Infections",
      summary: "Brazil cycle two summary.",
      cycle: 2,
      prevCountryIndex: 0,
      nextCountryIndex: 2,
    },
    {
      countryName: "The Gambia",
      institution: "MRC Gambia",
      principalInvestigator: "Abdul Sesay",
      projectTitle: "Respiratory Pathogens",
      summary: "Gambia summary.",
      cycle: 1,
      mapImage: { src: "gambia-map.png", alt: "outline map of The Gambia" },
      headshot: { src: "sesay.png", alt: "Abdul Sesay" },
      publications: [{ src: "https://pub-one" }, { src: "https://pub-two" }],
      prevCountryIndex: 1,
      nextCountryIndex: 3,
    },
    {
      countryName: "Guinea",
      institution: "INSP Guinea",
      principalInvestigator: "Mamadou Diallo",
      projectTitle: "Viral Haemorrhagic Fevers",
      summary: "Guinea summary.",
      cycle: 2,
      mapImage: { src: "guinea-map.png" },
      publications: [{ src: "https://pub-only" }],
      prevCountryIndex: 2,
      // Deliberately dangling: exercises the "index set but no such country"
      // branch that renders the greyed-out arrow.
      nextCountryIndex: 99,
    },
    {
      countryName: "Pakistan",
      institution: "AKU Karachi",
      principalInvestigator: "Zahra Hasan",
      projectTitle: "Febrile Illness",
      summary: "Pakistan summary.",
      cycle: 1,
      prevCountryIndex: 3,
    },
  ],
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  ImpactCountryData,
} = require("~/components/views/ImpactPage/components/ImpactCountryData");

// jsdom does not implement scrollIntoView, which the mount effect calls.
const scrollIntoView = jest.fn();

beforeAll(() => {
  (Element.prototype as any).scrollIntoView = scrollIntoView;
});

beforeEach(() => scrollIntoView.mockClear());

const renderShowcase = (index: number) => {
  const setSelectedCountry = jest.fn();
  const utils = render(
    <ImpactCountryShowcase
      selectedCountry={ImpactCountryData[index]}
      setSelectedCountry={setSelectedCountry}
    />,
  );
  return { ...utils, setSelectedCountry };
};

// The scroller items come first in the DOM; the two nav arrows are last.
const navButtons = (container: HTMLElement) => {
  const buttons = Array.from(
    container.querySelectorAll('[role="button"]'),
  ) as HTMLElement[];
  return {
    prev: buttons[buttons.length - 2],
    next: buttons[buttons.length - 1],
  };
};

const arrowStroke = (el: HTMLElement) =>
  el.querySelector("svg circle")?.getAttribute("stroke");

describe("ImpactCountryShowcase", () => {
  it("renders a scroller entry for every country and scrolls the active one into view", () => {
    renderShowcase(0);
    // "Brazil" appears twice in the scroller (two cycles) plus once more in
    // the detail window's country-name line.
    expect(screen.getAllByText("Brazil")).toHaveLength(3);
    expect(screen.getByText("Guinea")).toBeTruthy();
    expect(screen.getByText("Pakistan")).toBeTruthy();
    expect(screen.getByText("MRC Gambia")).toBeTruthy();
    expect(screen.getByText("AKU Karachi")).toBeTruthy();
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "nearest",
    });
  });

  it("renders the selected country's project title, PI and summary", () => {
    renderShowcase(2);
    expect(screen.getByText("Respiratory Pathogens")).toBeTruthy();
    expect(screen.getByText("Abdul Sesay")).toBeTruthy();
    expect(screen.getByText("Gambia summary.")).toBeTruthy();
    expect(screen.getByText("Principal Investigator")).toBeTruthy();
  });

  it("selects a country when a scroller item is clicked", () => {
    const { container, setSelectedCountry } = renderShowcase(0);
    const items = Array.from(container.querySelectorAll('[role="button"]'));
    fireEvent.click(items[3]);
    expect(setSelectedCountry).toHaveBeenCalledWith(ImpactCountryData[3]);
  });

  it("selects a country on Enter but not on other keys", () => {
    const { container, setSelectedCountry } = renderShowcase(0);
    const items = Array.from(container.querySelectorAll('[role="button"]'));
    fireEvent.keyDown(items[1], { key: "Tab" });
    expect(setSelectedCountry).not.toHaveBeenCalled();
    fireEvent.keyDown(items[1], { key: "Enter" });
    expect(setSelectedCountry).toHaveBeenCalledWith(ImpactCountryData[1]);
  });

  it("renders the inline Brazil artwork (not an <img>) for both Brazil cycles", () => {
    const cycle1 = renderShowcase(0);
    // No map <img> for Brazil: the || chain in the source resolves to "Brazil",
    // so Brazil is the one country excluded from the image path.
    expect(cycle1.container.querySelectorAll("img")).toHaveLength(0);
    const cycle1Fill = cycle1.container
      .querySelector("svg path")
      ?.getAttribute("fill");
    cycle1.unmount();

    const cycle2 = renderShowcase(1);
    expect(cycle2.container.querySelectorAll("img")).toHaveLength(0);
    const cycle2Fill = cycle2.container
      .querySelector("svg path")
      ?.getAttribute("fill");

    // Cycle 1 and cycle 2 use different fills, proving the two SVG variants.
    expect(cycle1Fill).toBe("#E6F7ED");
    expect(cycle2Fill).toBe("#3867FA");
  });

  it("renders the country map image with its alt text for non-Brazil countries", () => {
    const { container } = renderShowcase(2);
    const map = container.querySelector(
      'img[src="gambia-map.png"]',
    ) as HTMLImageElement;
    expect(map).toBeTruthy();
    expect(map.getAttribute("alt")).toBe("outline map of The Gambia");
  });

  it("falls back to an empty alt when the map image has none", () => {
    const { container } = renderShowcase(3);
    const map = container.querySelector(
      'img[src="guinea-map.png"]',
    ) as HTMLImageElement;
    expect(map).toBeTruthy();
    expect(map.getAttribute("alt")).toBe("");
  });

  it("renders the headshot only when the country has one", () => {
    const withHeadshot = renderShowcase(2);
    expect(
      withHeadshot.container.querySelector('img[src="sesay.png"]'),
    ).toBeTruthy();
    withHeadshot.unmount();

    const withoutHeadshot = renderShowcase(4);
    expect(
      withoutHeadshot.container.querySelector('img[alt="Zahra Hasan"]'),
    ).toBeNull();
  });

  it("numbers the publication buttons when there is more than one", () => {
    renderShowcase(2);
    const one = screen.getByText("View Publication (1)").closest("a");
    const two = screen.getByText("View Publication (2)").closest("a");
    expect(one?.getAttribute("href")).toBe("https://pub-one");
    expect(two?.getAttribute("href")).toBe("https://pub-two");
  });

  it("renders a single unnumbered publication button when there is exactly one", () => {
    renderShowcase(3);
    const link = screen.getByText("View Publication").closest("a");
    expect(link?.getAttribute("href")).toBe("https://pub-only");
    expect(screen.queryByText("View Publication (1)")).toBeNull();
  });

  it("renders no publication section when the country has no publications", () => {
    renderShowcase(0);
    expect(screen.queryByText(/View Publication/)).toBeNull();
  });

  it("navigates to the previous and next country from the nav arrows", () => {
    const { container, setSelectedCountry } = renderShowcase(2);
    const { prev, next } = navButtons(container);

    fireEvent.click(prev);
    expect(setSelectedCountry).toHaveBeenLastCalledWith(ImpactCountryData[1]);

    fireEvent.click(next);
    expect(setSelectedCountry).toHaveBeenLastCalledWith(ImpactCountryData[3]);
    expect(setSelectedCountry).toHaveBeenCalledTimes(2);
  });

  it("navigates on Enter and ignores other keys", () => {
    const { container, setSelectedCountry } = renderShowcase(2);
    const { next } = navButtons(container);

    fireEvent.keyDown(next, { key: "Escape" });
    expect(setSelectedCountry).not.toHaveBeenCalled();

    fireEvent.keyDown(next, { key: "Enter" });
    expect(setSelectedCountry).toHaveBeenCalledWith(ImpactCountryData[3]);
  });

  it("does nothing when the previous index is 0 (falsy) or absent", () => {
    // Index 1 has prevCountryIndex 0, which the truthiness guard rejects.
    const first = renderShowcase(1);
    fireEvent.click(navButtons(first.container).prev);
    expect(first.setSelectedCountry).not.toHaveBeenCalled();
    first.unmount();

    // Index 0 has no prevCountryIndex at all.
    const zeroth = renderShowcase(0);
    fireEvent.click(navButtons(zeroth.container).prev);
    fireEvent.keyDown(navButtons(zeroth.container).prev, { key: "Enter" });
    expect(zeroth.setSelectedCountry).not.toHaveBeenCalled();
  });

  it("does nothing when the next index points at a country that does not exist", () => {
    const { container, setSelectedCountry } = renderShowcase(3);
    const { next } = navButtons(container);
    fireEvent.click(next);
    expect(setSelectedCountry).not.toHaveBeenCalled();
    // A dangling index renders the greyed-out arrow.
    expect(arrowStroke(next)).toBe("#cccccc");
  });

  it("renders enabled arrows when the neighbouring countries exist", () => {
    const { container } = renderShowcase(2);
    const { prev, next } = navButtons(container);
    expect(arrowStroke(prev)).toBe("#3867FA");
    expect(arrowStroke(next)).toBe("#3867FA");
  });

  it("renders the last country's next arrow in its enabled styling when no next index is set", () => {
    const { container, setSelectedCountry } = renderShowcase(4);
    const { next } = navButtons(container);
    // No nextCountryIndex: the guard short-circuits before the lookup, so the
    // non-disabled arrow renders but clicking it does nothing.
    expect(arrowStroke(next)).toBe("#3867FA");
    fireEvent.click(next);
    expect(setSelectedCountry).not.toHaveBeenCalled();
  });
});
