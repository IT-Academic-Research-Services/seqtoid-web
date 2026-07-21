// Frontend coverage: BlastModals/utils.ts builds the NCBI BLAST submit URL from
// a sequence + program. prepareBlastQuery is a pure URL builder and
// determineDatabaseForBlast (exercised through it) is a switch mapping BLAST
// method to database. Cover the blastn/blastx arms and the encoding behavior.
import { prepareBlastQuery } from "~/components/views/SampleView/components/ModalManager/components/BlastModals/utils";

describe("prepareBlastQuery", () => {
  it("defaults to blastn against the nt database", () => {
    const url = prepareBlastQuery({ sequences: "ACGT" });
    expect(url).toBe(
      "https://blast.ncbi.nlm.nih.gov/Blast.cgi?CMD=PUT&DATABASE=nt&PROGRAM=blastn&QUERY=ACGT",
    );
  });

  it("uses the nr database for blastx", () => {
    const url = prepareBlastQuery({ sequences: "MK", program: "blastx" });
    expect(url).toContain("DATABASE=nr");
    expect(url).toContain("PROGRAM=blastx");
  });

  it("URI-encodes the sequence payload", () => {
    // encodeURI leaves ACGT alone but encodes spaces/newlines.
    const url = prepareBlastQuery({ sequences: "AC GT\n" });
    expect(url).toContain("QUERY=AC%20GT%0A");
  });

  it("produces an undefined database for an unknown program", () => {
    // The switch has no default arm, so an unrecognized program yields undefined.
    const url = prepareBlastQuery({ sequences: "ACGT", program: "tblastn" });
    expect(url).toContain("DATABASE=undefined");
    expect(url).toContain("PROGRAM=tblastn");
  });
});
