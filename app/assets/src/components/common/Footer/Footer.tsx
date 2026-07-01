import cx from "classnames";
import React from "react";
import { CONTACT_US_LINK } from "~/components/utils/documentationLinks";
import { SeqtoIDLogoReversed } from "~ui/icons";
import cs from "./Footer.scss";

export const Footer = () => {
  return (
    <div className={cs.footer}>
      <div className={cs.topNavContainer}>
        <a aria-label="Go to the SeqtoID homepage" href="/">
          <SeqtoIDLogoReversed className={cs.footerLogo} />
        </a>
        <div className={cs.topNavMenu}>
          <a
            href="https://github.com/chanzuckerberg/czid-workflows"
            aria-label="View the repo for czid-workflows on GitHub (opens in new window)"
            target="_blank"
            rel="noreferrer"
          >
            Github
          </a>
          <a
            // NOTE(2021-09-30): Alternatively there is https://boards.greenhouse.io/chanzuckerberginitiative/jobs/2931482 as of now.
            href="https://boards.greenhouse.io/chanzuckerberginitiative/jobs/3293983"
            aria-label="View the UCSF careers page (opens in new window)"
            target="_blank"
            rel="noreferrer"
          >
            Careers
          </a>
          <a
            href="http://help.czid.org"
            aria-label="View the SeqtoID help page (opens in new window)"
            target="_blank"
            rel="noreferrer"
          >
            Resources
          </a>
        </div>
      </div>
      <div className={cs.bottomNavContainer}>
        <div className={cs.bottomNavMenu}>
          <div>
            <a
              href="/privacy"
              aria-label="View the SeqtoID privacy notice (opens in new window)"
              target="_blank"
              rel="noopener noreferrer"
            >
              Privacy
            </a>
            <span>|</span>
            <a
              href="/terms"
              aria-label="View the SeqtoID terms of use (opens in new window)"
              target="_blank"
              rel="noopener noreferrer"
            >
              Terms
            </a>
            <span>|</span>
            <a href={CONTACT_US_LINK} target="_blank" rel="noreferrer">
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
    </div>
  );
};
