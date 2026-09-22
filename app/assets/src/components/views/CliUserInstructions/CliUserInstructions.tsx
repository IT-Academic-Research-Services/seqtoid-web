import React, { ReactNode } from "react";
import ReactMarkdown, { Components } from "react-markdown";
import cs from "./cli_user_instructions.scss";

// react-markdown does not emit `id` attributes on headings (and, as of v10, does
// not render raw HTML either). GitHub's markdown renderer auto-assigns each
// heading a slug id, so in-page anchor links in the vendored README -- such as
// [installing from binaries](#from-binaries) -> #### From Binaries -- resolve on
// GitHub but have no target when the same file is rendered here in the help
// center. Recreate GitHub's heading-slug ids so those anchors resolve. (SMP-1886)
const slugify = (text: string): string =>
  text
    .trim()
    .toLowerCase()
    .replace(/[^\w\- ]+/g, "")
    .replace(/\s+/g, "-");

// Heading content can be a string, a number, or nested elements (e.g. inline
// code or emphasis). Flatten it to plain text before slugging.
const flattenText = (node: ReactNode): string => {
  if (typeof node === "string" || typeof node === "number") {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join("");
  }
  if (React.isValidElement(node)) {
    return flattenText((node.props as { children?: ReactNode }).children);
  }
  return "";
};

const makeHeading = (Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6") =>
  function Heading({ children }: { children?: ReactNode }) {
    return <Tag id={slugify(flattenText(children))}>{children}</Tag>;
  };

const MARKDOWN_COMPONENTS: Components = {
  h1: makeHeading("h1"),
  h2: makeHeading("h2"),
  h3: makeHeading("h3"),
  h4: makeHeading("h4"),
  h5: makeHeading("h5"),
  h6: makeHeading("h6"),
};

export const CliUserInstructions = (props: { readme: string }) => {
  const readme = props.readme.replace(/&#39;/g, "'").replace(/&quot;/g, '"');
  return (
    <div className={cs.instructionContainer}>
      <ReactMarkdown components={MARKDOWN_COMPONENTS}>{readme}</ReactMarkdown>
    </div>
  );
};
