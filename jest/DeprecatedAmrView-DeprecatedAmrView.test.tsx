// Coverage: app/assets/src/components/views/SampleView/components/ReportPanel/components/DeprecatedAmrView/DeprecatedAmrView.tsx
//
// DeprecatedAmrView is a class wrapper around react-table. Its constructor
// derives a gene_family (first five chars of gene) onto every row, and the
// module-level column config carries the aggregate / filterMethod / Cell
// callbacks. react-table is stubbed so we can (a) confirm the constructor's
// gene_family mutation and the amr-vs-empty fallback, and (b) pull the column
// callbacks off the rendered props and exercise their branches directly.
import { render } from "@testing-library/react";

const mockTableProps: $TSFixMe[] = [];

jest.mock("react-table", () => {
  const ReactLib = require("react");
  return {
    __esModule: true,
    default: (props: $TSFixMe) => {
      mockTableProps.push(props);
      return ReactLib.createElement("div", { "data-testid": "react-table" });
    },
  };
});

jest.mock("react-table/react-table.css", () => ({}), { virtual: true });

import { DeprecatedAmrView } from "~/components/views/SampleView/components/ReportPanel/components/DeprecatedAmrView/DeprecatedAmrView";

const lastTableProps = () => mockTableProps[mockTableProps.length - 1];

beforeEach(() => {
  mockTableProps.length = 0;
});

describe("DeprecatedAmrView constructor", () => {
  it("derives gene_family as the first five characters of each gene", () => {
    const amr = {
      row0: { gene: "TEM-116", drug_family: "BETA", coverage: 90, depth: 3 },
      row1: { gene: "AB", drug_family: "OTHER", coverage: 50, depth: 1 },
    };
    render(<DeprecatedAmrView amr={amr} />);
    // gene_family is sliced to at most five characters.
    expect(amr.row0.gene_family).toBe("TEM-1");
    // Shorter gene names are passed through untouched by slice.
    expect(amr.row1.gene_family).toBe("AB");
    expect(lastTableProps().data).toBe(amr);
  });

  it("falls back to an empty data set when no amr prop is given", () => {
    render(<DeprecatedAmrView />);
    expect(lastTableProps().data).toEqual([]);
  });
});

describe("DeprecatedAmrView column callbacks", () => {
  const getColumn = (accessor: string) => {
    render(<DeprecatedAmrView amr={{ r: { gene: "GENEX" } }} />);
    return lastTableProps().columns.find(
      (c: $TSFixMe) => c.accessor === accessor,
    );
  };

  it("aggregates coverage as the rounded mean", () => {
    expect(getColumn("coverage").aggregate([10, 20, 30])).toBe(20);
  });

  it("aggregates depth as the rounded sum", () => {
    expect(getColumn("depth").aggregate([1.4, 2.4])).toBe(4);
  });

  it("renders coverage / depth cells fixed to one decimal", () => {
    expect(getColumn("coverage").Cell({ value: "3.14" })).toBe("3.1");
    expect(getColumn("depth").Cell({ value: 5 })).toBe("5.0");
  });

  it("filters numeric columns by a >= threshold on both sides", () => {
    const filterMethod = getColumn("coverage").filterMethod;
    expect(filterMethod({ id: "coverage", value: 10 }, { coverage: 15 })).toBe(
      true,
    );
    expect(filterMethod({ id: "coverage", value: 10 }, { coverage: 5 })).toBe(
      false,
    );
  });

  it("aggregates the gene column to an empty string", () => {
    expect(getColumn("gene").aggregate(["a", "b"])).toBe("");
  });
});

describe("DeprecatedAmrView default filter method", () => {
  it("does a case-insensitive substring match, both matching and not", () => {
    render(<DeprecatedAmrView amr={{ r: { gene: "GENEX" } }} />);
    const { defaultFilterMethod } = lastTableProps();
    expect(
      defaultFilterMethod({ id: "gene", value: "gen" }, { gene: "GENEX" }),
    ).toBe(true);
    expect(
      defaultFilterMethod({ id: "gene", value: "zzz" }, { gene: "GENEX" }),
    ).toBe(false);
  });

  it("uses the pivotId when present and passes rows missing the column", () => {
    render(<DeprecatedAmrView amr={{ r: { gene: "GENEX" } }} />);
    const { defaultFilterMethod } = lastTableProps();
    // pivotId path + undefined cell -> returns true (no filtering).
    expect(
      defaultFilterMethod(
        { pivotId: "missing", id: "gene", value: "x" },
        { gene: "GENEX" },
      ),
    ).toBe(true);
  });
});
