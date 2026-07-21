import cx from "classnames";
import React from "react";
import { CONTACT_US_LINK } from "~/components/utils/documentationLinks";
import { SeqtoIDLogoReversed } from "~ui/icons";
import cs from "./Footer.scss";

export const Footer = () => {
  return (
    // Semantic <footer> element (REBRAND-26): gives the sitewide sticky-footer
    // rules in home.scss a stable, non-CSS-modules hook (`.page_content:has(footer)`).
    <footer className={cs.footer}>
      <div className={cs.topNavContainer}>
        <a aria-label="Go to the SeqtoID homepage" href="/">
          <SeqtoIDLogoReversed className={cs.footerLogo} />
        </a>
        <div className={cs.topNavMenu}>
        </div>
      </div>
      <div className={cs.bottomNavContainer}>
        <div className={cs.bottomNavMenu}>
          <div>
            <a
              href="/privacy"
              aria-label="View the SeqtoID privacy notice"
            >
              Privacy
            </a>
            <span>|</span>
            <a
              href="/terms"
              aria-label="View the SeqtoID terms of use"
            >
              Terms
            </a>
            <span>|</span>
            <a href={CONTACT_US_LINK} target="_blank" rel="noreferrer" aria-label="Contact the SeqtoID team (opens in new window)">
              Contact us
            </a>
            <span>|</span>
            <span
              aria-label="View the SeqtoID cookie settings (opens in a modal)"
              className={cx(cs.cookieSettings, "optanon-show-settings")}
            >
              Cookie Settings
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};
