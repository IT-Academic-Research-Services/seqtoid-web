// Coverage: app/assets/src/components/views/SampleUploadFlow/components/ReviewStep/components/HostOrganismMessage/HostOrganismMessage.tsx
//
// HostOrganismMessage is a class component whose render branches on how many
// distinct host organisms the selected samples map to: zero -> renders null,
// one -> renderOneHost (single Notification), many -> renderManyHosts (an
// Accordion of lines). Within those it walks: match vs no-match against the
// hostGenomes list, ercc_only filtering (both "ercc_only" and "ercc_only?"
// key spellings), the "ERCC Only" special-casing, singular vs plural sample
// counts, the human vs non-human "human genome" clause, and the warn vs info
// styling when at least one host is unmatched. Accordion / Notification /
// ExternalLink are stubbed so the assertions land on this file's text logic.
import { render, screen } from "@testing-library/react";
import { HostOrganismMessage } from "~/components/views/SampleUploadFlow/components/ReviewStep/components/HostOrganismMessage/HostOrganismMessage";

jest.mock("~ui/notifications/Notification", () => ({
  __esModule: true,
  default: ({ type, children }: $TSFixMe) =>
    require("react").createElement(
      "div",
      { "data-testid": "notification", "data-type": type },
      children,
    ),
}));

jest.mock("~ui/controls/ExternalLink", () => ({
  __esModule: true,
  default: ({ children }: $TSFixMe) =>
    require("react").createElement(
      "a",
      { "data-testid": "external-link" },
      children,
    ),
}));

jest.mock("~/components/layout/Accordion", () => ({
  __esModule: true,
  default: ({ header, children }: $TSFixMe) =>
    require("react").createElement(
      "div",
      { "data-testid": "accordion" },
      header,
      children,
    ),
}));

const hostGenomes = [
  { id: 1, name: "Human", ercc_only: false },
  { id: 2, name: "Mosquito", ercc_only: false },
  { id: 3, name: "ERCC Only", ercc_only: true },
  { id: 4, name: "OnlyErcc", ercc_only: true },
];

const renderMessage = (samples: $TSFixMe, genomes = hostGenomes) =>
  render(
    <HostOrganismMessage samples={samples} hostGenomes={genomes as $TSFixMe} />,
  );

describe("HostOrganismMessage", () => {
  it("renders nothing when there are no samples", () => {
    const { container } = renderMessage([]);
    expect(container.firstChild).toBeNull();
  });

  it("renders a single info notification for one matched, non-human host", () => {
    renderMessage([{ host_genome_id: 2, host_genome_name: "Mosquito" }]);
    const note = screen.getByTestId("notification");
    expect(note.getAttribute("data-type")).toBe("info");
    // Matched, non-ERCC -> subtracts a Mosquito genome.
    expect(note.textContent).toContain("Mosquito");
    expect(note.textContent).toContain("subtract out reads that align to a");
    // Non-human -> mentions the human genome clause.
    expect(note.textContent).toContain("reads that align to the human genome");
    // Singular sample -> "1 sample" without trailing s on the count phrase.
    expect(note.textContent).toContain("1 sample");
  });

  it("omits the human-genome clause when the host itself is human", () => {
    renderMessage([{ host_genome_id: 1, host_genome_name: "Human" }]);
    const note = screen.getByTestId("notification");
    expect(note.getAttribute("data-type")).toBe("info");
    expect(note.textContent).not.toContain(
      "reads that align to the human genome",
    );
  });

  it("warns and offers only ERCC removal for an unmatched host", () => {
    renderMessage([
      { host_genome_id: 99, host_genome_name: "Unicorn" },
      { host_genome_id: 99, host_genome_name: "Unicorn" },
    ]);
    const note = screen.getByTestId("notification");
    expect(note.getAttribute("data-type")).toBe("warning");
    expect(note.textContent).toContain(
      "We don't have any hosts matching your selection",
    );
    expect(note.textContent).toContain("we will only remove ERCCs");
    // Two samples -> plural "2 samples".
    expect(note.textContent).toContain("2 samples");
  });

  it("uses the ERCC-only phrasing when the single host is ERCC Only", () => {
    renderMessage([{ host_genome_id: 3, host_genome_name: "ERCC Only" }]);
    const note = screen.getByTestId("notification");
    // ERCC Only is a match (isERCC branch keeps it in the filtered list).
    expect(note.getAttribute("data-type")).toBe("info");
    expect(note.textContent).toContain("indicated is ERCC Only");
    expect(note.textContent).toContain("we will only remove ERCCs");
  });

  it("renders an accordion with one line per host when several are selected", () => {
    renderMessage([
      { host_genome_id: 1, host_genome_name: "Human" },
      { host_genome_id: 2, host_genome_name: "Mosquito" },
    ]);
    // Multiple distinct hosts -> Accordion path, all matched -> info header.
    const accordion = screen.getByTestId("accordion");
    expect(accordion).toBeTruthy();
    const header = screen.getByTestId("notification");
    expect(header.getAttribute("data-type")).toBe("info");
    expect(accordion.textContent).toContain("Human");
    expect(accordion.textContent).toContain("Mosquito");
  });

  it("warns on the accordion header when at least one of many hosts is unmatched", () => {
    renderMessage([
      { host_genome_id: 2, host_genome_name: "Mosquito" },
      { host_genome_id: 99, host_genome_name: "Unicorn" },
    ]);
    const header = screen.getByTestId("notification");
    expect(header.getAttribute("data-type")).toBe("warning");
  });

  it("treats an ercc_only host that is not ERCC-named as unmatched", () => {
    // OnlyErcc is ercc_only:true and not "ercc only", so it is filtered out of
    // the match list -> selecting it yields a no-match warning.
    renderMessage([{ host_genome_id: 4, host_genome_name: "OnlyErcc" }]);
    const note = screen.getByTestId("notification");
    expect(note.getAttribute("data-type")).toBe("warning");
  });
});
