// Frontend coverage: supplemental NewickParser cases that jest/NewickParser.test.ts
// does not reach -- the unrooted-tree hand-off, the nodeGroups accessor, tokens that
// run to the end of the string, and the two remaining parse() token arms (an empty
// token before ')' and a named token before ';').
import NewickParser from "~/components/utils/parsers/NewickParser";

describe("NewickParser.getUnrootedTree", () => {
  it("delegates to the injected convertToUnrootedTree with the root node", () => {
    const parser = new NewickParser("(A,B);");
    parser.parse();
    const convert = jest.fn(() => "unrooted");
    parser.convertToUnrootedTree = convert;

    expect(parser.getUnrootedTree()).toBe("unrooted");
    expect(convert).toHaveBeenCalledTimes(1);
    expect(convert).toHaveBeenCalledWith(parser.root);
  });

  it("throws when no converter has been supplied", () => {
    const parser = new NewickParser("(A,B);");
    // convertToUnrootedTree is declared but never assigned by the class itself.
    expect(() => parser.getUnrootedTree()).toThrow(TypeError);
  });
});

describe("NewickParser.lastNode", () => {
  it("returns the final node of the final node group", () => {
    const parser = new NewickParser("(A,B);");
    const a = { name: "a" };
    const b = { name: "b" };
    const c = { name: "c" };
    parser.nodeGroups = [[a], [b, c]];

    expect(parser.lastNode()).toBe(c);
  });

  it("returns the only node when there is a single group of one", () => {
    const parser = new NewickParser("(A,B);");
    const only = { name: "only" };
    parser.nodeGroups = [[only]];

    expect(parser.lastNode()).toBe(only);
  });
});

describe("NewickParser.getNextTokenAndSymbol", () => {
  it("returns an undefined symbol when the string ends before any symbol", () => {
    const parser = new NewickParser("ABC");
    const { token, symbol } = parser.getNextTokenAndSymbol(0);
    expect(token).toBe("ABC");
    expect(symbol).toBeUndefined();
  });

  it("returns an empty token when the cursor already sits on a symbol", () => {
    const parser = new NewickParser("(A,B);");
    const { token, symbol } = parser.getNextTokenAndSymbol(0);
    expect(token).toBe("");
    expect(symbol).toBe("(");
  });
});

describe("NewickParser.parse structural arms", () => {
  it("closes an unnamed clade when ')' is reached with an empty token", () => {
    // The outer ')' in "((A,B));" is preceded by another ')', so the token is empty
    // and the parser must pop the predecessor without renaming anything.
    const parser = new NewickParser("((A,B));");
    expect(parser.parse()).toBe(parser);

    // The extra parens produce one unnamed clade holding the two leaves.
    expect(parser.root.children).toHaveLength(1);
    const clade = parser.root.children[0];
    expect(clade.name).toBeUndefined();
    expect(clade.children.map((c: { name: string }) => c.name)).toEqual([
      "A",
      "B",
    ]);
  });

  it("applies a trailing token before ';' to the current node", () => {
    const parser = new NewickParser("(A,B)myroot;");
    expect(parser.parse()).toBe(parser);
    expect(parser.root.name).toBe("myroot");
  });

  it("leaves the root untouched when ';' is reached with an empty token", () => {
    const parser = new NewickParser("(A,B);");
    parser.parse();
    expect(parser.root.name).toBeUndefined();
  });
});
