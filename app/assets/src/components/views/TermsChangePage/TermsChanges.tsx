import React from "react";
import { Footer } from "~/components/common/Footer";
import { LandingHeader } from "~/components/common/LandingHeader";
import { NarrowContainer } from "~/components/layout";

const TERMS_CHANGES_STYLES = `
  .terms-changes-page { padding: 48px 0 64px; }
  .terms-changes-legal-body { font-family: inherit; }
  .terms-changes-legal-body h2 { font-size: 20px; font-weight: 700; color: #052049; margin: 32px 0 12px; }
  .terms-changes-legal-body p { font-size: 15px; line-height: 1.7; color: #374151; margin-bottom: 16px; }
  .terms-changes-title { font-size: 28px; font-weight: 700; color: #052049; margin-bottom: 24px; }
  /* !important overrides the global \`a { color: inherit !important }\` in _header.scss (same pattern as support.scss). */
  .terms-changes-legal-body a { color: #006BE9 !important; text-decoration: none; }
  .terms-changes-legal-body a:hover { text-decoration: underline; }
`;

export const TermsChanges = () => {
  return (
    <>
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: TERMS_CHANGES_STYLES }}
      />
      <LandingHeader legalNav />
      <NarrowContainer size="small" className="terms-changes-page">
        <div className="terms-changes-legal-body">
          <h1 className="terms-changes-title">
            Terms &amp; Privacy Notice Updates
          </h1>
          <p>
            This page summarizes changes made to SeqtoID&apos;s Terms of Use and
            Privacy Notice over time, so returning Users can see what&apos;s
            changed since their last visit.
          </p>

          <h2>
            June 4, 2026 — Initial SeqtoID Terms of Use and Privacy Notice
          </h2>
          <p>
            Effective June 4, 2026, SeqtoID published its Terms of Use and
            Privacy Notice as a platform owned by The Regents of the University
            of California and operated by UCSF. This is the first version of
            these documents under SeqtoID; there are no prior versions to
            compare against.
          </p>
          <p>
            Future updates to the Terms of Use or Privacy Notice will be
            summarized on this page, along with their effective date.
          </p>
          <p>
            For questions about these documents, contact{" "}
            <a href="mailto:seqtoid@ucsf.edu">seqtoid@ucsf.edu</a>.
          </p>
        </div>
      </NarrowContainer>
      <Footer />
    </>
  );
};
