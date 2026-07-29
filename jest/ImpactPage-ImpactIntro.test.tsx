// Coverage: app/assets/src/components/views/ImpactPage/components/ImpactIntro/ImpactIntro.tsx
// The intro renders static copy plus one clickable map dot per grant country.
// The branchy parts are the per-dot cycle class (cycle === 1 vs anything else),
// the click handler and the keydown handler, which only fires on "Enter".
//
// ImpactCountryData is mocked: the real module `require()`s a dozen PNGs that
// jest.config.js has no mapper for, and a fixture lets us assert exact dot
// positions and cycles.
import { fireEvent, render, screen } from "@testing-library/react";
import { ImpactIntro } from "~/components/views/ImpactPage/components/ImpactIntro/ImpactIntro";

// jest.config.js maps every .scss import to this stub, which normally exports
// an empty object -- so `cs.cycle1` and `cs.cycle2` would both be undefined and
// the cycle branch would be unobservable. Hand back the key instead.
jest.mock(
  "./__mocks__/styleMock",
  () =>
    new Proxy(
      {},
      {
        get: (_target, key: string) =>
          key === "__esModule" ? false : `scss-${String(key)}`,
      },
    ),
  { virtual: false },
);

jest.mock("~/images/impact_page/ImpactMap.svg", () => "impact-map.svg");
jest.mock("~/images/impact_page/logo-czi-color.png", () => "logo-czi.png");
jest.mock(
  "~/images/impact_page/logo-gates-foundation.png",
  () => "logo-gates.png",
);

jest.mock("~/components/views/ImpactPage/components/ImpactCountryData", () => ({
  ImpactCountryData: [
    {
      countryName: "Brazil",
      cycle: 1,
      mapPosition: { bottom: "32%", left: "30%" },
    },
    {
      countryName: "Cambodia",
      cycle: 2,
      mapPosition: { bottom: "40%", left: "70%" },
    },
    {
      countryName: "Kenya",
      cycle: 1,
      mapPosition: { bottom: "35%", left: "55%" },
    },
  ],
}));

const dots = () =>
  screen
    .getAllByRole("button")
    .filter(
      el =>
        el.textContent === "Brazil" ||
        el.textContent === "Cambodia" ||
        el.textContent === "Kenya",
    );

describe("ImpactIntro", () => {
  it("renders the heading, partner copy and the three partner logo links", () => {
    const { container } = render(
      <ImpactIntro
        setSelectedCountry={jest.fn()}
        selectedCountry={{ countryName: "Brazil" } as $TSFixMe}
      />,
    );

    expect(screen.getByText("SeqtoID Around the World")).toBeTruthy();
    expect(screen.getByText("In partnership with")).toBeTruthy();

    const hrefs = Array.from(container.querySelectorAll("a")).map(a =>
      a.getAttribute("href"),
    );
    // Two inline prose links plus three logo links.
    expect(hrefs).toContain("https://chanzuckerberg.com/");
    expect(hrefs).toContain("https://www.czbiohub.org/");
    expect(hrefs).toContain("https://www.gatesfoundation.org/");
    expect(hrefs.filter(h => h === "https://www.czbiohub.org/")).toHaveLength(
      2,
    );
  });

  it("renders one positioned dot per country and both cycle legend entries", () => {
    render(
      <ImpactIntro
        setSelectedCountry={jest.fn()}
        selectedCountry={{ countryName: "Brazil" } as $TSFixMe}
      />,
    );

    const countryDots = dots();
    expect(countryDots).toHaveLength(3);
    expect(countryDots.map(d => d.textContent)).toEqual([
      "Brazil",
      "Cambodia",
      "Kenya",
    ]);
    expect(countryDots[1].style.bottom).toBe("40%");
    expect(countryDots[1].style.left).toBe("70%");

    expect(screen.getByText("Cycle 1")).toBeTruthy();
    expect(screen.getByText("Cycle 2")).toBeTruthy();
  });

  it("gives cycle-1 and cycle-2 countries different dot classes", () => {
    render(
      <ImpactIntro
        setSelectedCountry={jest.fn()}
        selectedCountry={{ countryName: "Brazil" } as $TSFixMe}
      />,
    );

    const [brazil, cambodia, kenya] = dots();
    // The scss module stub returns the key name, so cycle1 !== cycle2 and the
    // two cycle-1 countries share a class.
    expect(brazil.className).toBe(kenya.className);
    expect(brazil.className).not.toBe(cambodia.className);
  });

  it("selects the clicked country", () => {
    const setSelectedCountry = jest.fn();
    render(
      <ImpactIntro
        setSelectedCountry={setSelectedCountry}
        selectedCountry={{ countryName: "Brazil" } as $TSFixMe}
      />,
    );

    fireEvent.click(dots()[2]);
    expect(setSelectedCountry).toHaveBeenCalledTimes(1);
    expect(setSelectedCountry.mock.calls[0][0].countryName).toBe("Kenya");
  });

  it("selects on Enter but ignores other keys", () => {
    const setSelectedCountry = jest.fn();
    render(
      <ImpactIntro
        setSelectedCountry={setSelectedCountry}
        selectedCountry={{ countryName: "Brazil" } as $TSFixMe}
      />,
    );

    fireEvent.keyDown(dots()[1], { key: " " });
    fireEvent.keyDown(dots()[1], { key: "Escape" });
    expect(setSelectedCountry).not.toHaveBeenCalled();

    fireEvent.keyDown(dots()[1], { key: "Enter" });
    expect(setSelectedCountry).toHaveBeenCalledTimes(1);
    expect(setSelectedCountry.mock.calls[0][0].countryName).toBe("Cambodia");
  });
});
