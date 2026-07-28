// Coverage: app/assets/src/components/views/RawResultsFolder/RawResultsFolder.tsx
//
// RawResultsFolder is a small class component that renders a breadcrumb built by
// splitting `filePath` on "/", then either a table of downloadable files or the
// "No files to show" fallback. Its branches are: the empty vs populated fileList,
// and the "results" vs "fastqs" table heading derived from filePath[3]. Clicking a
// row assigns window.location.href, which is stubbed here so jsdom does not attempt
// a real navigation.
import { fireEvent, render, screen } from "@testing-library/react";
import RawResultsFolder from "~/components/views/RawResultsFolder/RawResultsFolder";

let hrefSpy: jest.Mock;

beforeEach(() => {
  hrefSpy = jest.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      set href(value: string) {
        hrefSpy(value);
      },
      get href() {
        return "http://localhost/";
      },
    },
  });
});

const baseProps = {
  samplePath: "/samples/42",
  sampleName: "Sample 42",
  projectName: "My Project",
  filePath: "home/7/samples/results",
  fileList: [],
};

describe("RawResultsFolder breadcrumb", () => {
  it("renders each path segment with links derived from filePath", () => {
    const { container } = render(<RawResultsFolder {...baseProps} />);

    const links = Array.from(container.querySelectorAll("a"));
    expect(links.map(a => a.getAttribute("href"))).toEqual([
      "/",
      "/home?project_id=7",
      "/samples/42",
    ]);
    expect(links[0].textContent).toBe("home");
    expect(links[1].textContent).toBe("My Project");
    expect(links[2].textContent).toBe("Sample 42");
    expect(container.textContent).toContain("results");
  });
});

describe("RawResultsFolder file list branches", () => {
  it("shows the fallback message when the file list is empty", () => {
    const { container } = render(<RawResultsFolder {...baseProps} />);

    expect(container.textContent).toContain("No files to show");
    expect(container.querySelector("table")).toBeNull();
  });

  it('labels the table "Results folder" when the fourth segment is results', () => {
    render(
      <RawResultsFolder
        {...baseProps}
        fileList={[
          { display_name: "report.csv", size: "1 KB", url: "/d/report.csv" },
        ]}
      />,
    );

    expect(screen.getByText("Results folder")).toBeTruthy();
    expect(screen.queryByText("Fastqs folder")).toBeNull();
    expect(screen.queryByText("No files to show")).toBeNull();
  });

  it('labels the table "Fastqs folder" for any other fourth segment', () => {
    render(
      <RawResultsFolder
        {...baseProps}
        filePath="home/7/samples/fastqs"
        fileList={[
          { display_name: "reads.fastq", size: "9 MB", url: "/d/reads.fastq" },
        ]}
      />,
    );

    expect(screen.getByText("Fastqs folder")).toBeTruthy();
    expect(screen.queryByText("Results folder")).toBeNull();
  });

  it("renders one row per file with its display name and size tag", () => {
    const { container } = render(
      <RawResultsFolder
        {...baseProps}
        fileList={[
          { display_name: "a.csv", size: "1 KB", url: "/d/a" },
          { display_name: "b.csv", size: "2 KB", url: "/d/b" },
        ]}
      />,
    );

    const rows = container.querySelectorAll("tr.file-link");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("a.csv");
    expect(rows[0].textContent).toContain("-- 1 KB");
    expect(rows[1].textContent).toContain("b.csv");
    expect(rows[1].textContent).toContain("-- 2 KB");
  });

  it("navigates to the file url when a row is clicked", () => {
    const { container } = render(
      <RawResultsFolder
        {...baseProps}
        fileList={[
          { display_name: "a.csv", size: "1 KB", url: "/download/a.csv" },
          { display_name: "b.csv", size: "2 KB", url: "/download/b.csv" },
        ]}
      />,
    );

    const rows = container.querySelectorAll("tr.file-link");
    fireEvent.click(rows[1]);

    expect(hrefSpy).toHaveBeenCalledWith("/download/b.csv");
  });
});
