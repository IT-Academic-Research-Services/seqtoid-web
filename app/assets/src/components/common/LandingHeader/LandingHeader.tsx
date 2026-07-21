import { isEmpty } from "lodash/fp";
import React, { useState } from "react";
import AnnouncementBanner from "~/components/common/AnnouncementBanner";
import {
  PrivacyDropdownItem,
  TermsDropdownItem,
} from "~/components/common/Header/UserMenuDropDown";
import ExternalLink from "~/components/ui/controls/ExternalLink";
import IconMobileNavClose from "~/components/ui/icons/IconMobileNavClose";
import BareDropdown from "~ui/controls/dropdowns/BareDropdown";
import { SeqtoIDLogoReversed } from "~ui/icons";
import cs from "./LandingHeader.scss";

interface LandingHeaderProps {
  announcementBannerEnabled?: boolean;
  emergencyBannerMessage?: string;
  impactPage?: boolean;
  // REBRAND: legal-page variant. When set, the right-side nav shows
  // "Help Center" + a "Terms" dropdown instead of "Resources" + "Sign in".
  // Used only by TermsOfUse / PrivacyNotice; homepage usage is unchanged.
  legalNav?: boolean;
  // REBRAND: bare variant -- render only the logo, no right-side nav.
  // Used by the Metadata Dictionary page.
  logoOnly?: boolean;
}

export const LandingHeader = ({
  announcementBannerEnabled,
  emergencyBannerMessage,
  legalNav,
  logoOnly,
}: LandingHeaderProps) => {
  const [menuOpen, setMenuOpen] = useState(false);

  function toggleMobileNav() {
    setMenuOpen(!menuOpen);
  }

  return (
    <>
      {/* Announcement banners we only want to show on the landing page, not within the app */}

      <AnnouncementBanner
        id="emergency"
        visible={!isEmpty(emergencyBannerMessage)}
        message={emergencyBannerMessage}
      />

      <AnnouncementBanner
        id="czid-transfer"
        visible={announcementBannerEnabled}
        message={
          <>
            {
              " UCSF’S INSTITUTE FOR GLOBAL HEALTH SCIENCES WILL MANAGE SeqtoID TOWARD THE END OF 2025. CLICK "
            }
            <ExternalLink
              className={cs.link}
              href="https://helpcenter.seqtoid.org/articles/faqs-czid-s-transfer-to-the-university-of-california-san-francisco/"
            >
              HERE
            </ExternalLink>
            {" FOR MORE INFORMATION. "}
          </>
        }
      />

      <div className={cs.header} data-testid="home-top-nav-bar">
        <a aria-label="Go to the SeqtoID homepage" href="/">
          <SeqtoIDLogoReversed className={cs.headerLogo} />
        </a>
        {!logoOnly && (
          <nav className={cs.nav} data-test-id="home-top-nav">
          {legalNav ? (
            <div className={cs.legalNav}>
              {/* TODO: update to help.seqtoid.org once help center migration is complete */}
              <a
                className={cs.textLink}
                href="#"
                aria-label="View the SeqtoID help center"
                data-testid="home-top-nav-help-center"
              >
                Help Center
              </a>
              <div className={cs.legalDivider} />
              <BareDropdown
                trigger={<span className={cs.legalTrigger}>Legal</span>}
                className={cs.termsDropdown}
                items={[TermsDropdownItem, PrivacyDropdownItem]}
                direction="left"
              />
            </div>
          ) : (
            <span className={cs.hideMobile}>
              {/* REBRAND: Case Studies temporarily disabled - impact page hidden */}
              {/* <a
                className={`${cs.textLink} ${
                  impactPage ? cs.textLinkActive : null
                }`}
                href="/impact"
                aria-label="View the SeqtoID impact page"
                data-testid="home-top-nav-impact"
              >
                Case Studies
              </a> */}
              {/* TODO: update to help.seqtoid.org once help center migration is complete */}
              <a
                className={cs.textLink}
                href="#"
                aria-label="View the SeqtoID help page"
                data-testid="home-top-nav-resources"
              >
                Resources
              </a>
              <a
                className={cs.buttonLink}
                href="/auth0/login"
                data-testid="home-top-nav-login"
              >
                Sign in
              </a>
            </span>
          )}
          <div
            onClick={toggleMobileNav}
            onKeyDown={toggleMobileNav}
            className={cs.hamburgerIcon}
            data-testid="home-mobile-hamburger"
            role="button"
            tabIndex={0}
          >
            <div className={cs.bar1}></div>
            <div className={cs.bar2}></div>
            <div className={cs.bar3}></div>
          </div>
          <div
            className={cs.mobileNav}
            style={menuOpen ? { width: "100%" } : { width: "0" }}
          >
            <div className={cs.mobileNavCloseContainer}>
              <span
                className={cs.mobileNavClose}
                onClick={toggleMobileNav}
                onKeyDown={toggleMobileNav}
                data-testid="home-mobile-close-hamburger"
                role="button"
                tabIndex={0}
              >
                <IconMobileNavClose />
              </span>
            </div>
            <div className={cs.mobileNavLinkContainer}>
              {legalNav ? (
                <>
                  {/* TODO: update to help.seqtoid.org once help center migration is complete */}
                  <a
                    className={cs.mobileNavLink}
                    href="#"
                    style={menuOpen ? { opacity: "1" } : { opacity: "0" }}
                    aria-label="View the SeqtoID help center"
                    data-testid="home-mobile-menu-help-center"
                  >
                    Help Center
                  </a>
                  <div
                    className={cs.mobileNavSeparator}
                    style={menuOpen ? { opacity: "1" } : { opacity: "0" }}
                  ></div>
                  <a
                    className={cs.mobileNavLink}
                    href="/terms"
                    style={menuOpen ? { opacity: "1" } : { opacity: "0" }}
                    aria-label="View the SeqtoID terms of use"
                    data-testid="home-mobile-menu-terms"
                  >
                    Terms of Use
                  </a>
                  <a
                    className={cs.mobileNavLink}
                    href="/privacy"
                    style={menuOpen ? { opacity: "1" } : { opacity: "0" }}
                    aria-label="View the SeqtoID privacy notice"
                    data-testid="home-mobile-menu-privacy"
                  >
                    Privacy Policy
                  </a>
                </>
              ) : (
                <>
                  {/* REBRAND: Case Studies mobile link temporarily disabled */}
                  {/* <a
                    className={cs.mobileNavLink}
                    href="/impact"
                    style={menuOpen ? { opacity: "1" } : { opacity: "0" }}
                    target="_blank"
                    rel="noreferrer"
                    aria-label="View the SeqtoID impact page (opens in new window)"
                    data-testid="home-mobile-menu-impact"
                  >
                    Case Studies
                  </a> */}
                  {/* TODO: update to help.seqtoid.org once help center migration is complete */}
                  <a
                    className={cs.mobileNavLink}
                    href="#"
                    style={menuOpen ? { opacity: "1" } : { opacity: "0" }}
                    aria-label="View the SeqtoID help page"
                    data-testid="home-mobile-menu-resources"
                  >
                    Resources
                  </a>
                  <div
                    className={cs.mobileNavSeparator}
                    style={menuOpen ? { opacity: "1" } : { opacity: "0" }}
                  ></div>
                  <a
                    className={cs.mobileNavLink}
                    href="/auth0/login"
                    style={menuOpen ? { opacity: "1" } : { opacity: "0" }}
                    data-testid="home-mobile-menu-login"
                  >
                    Sign In
                  </a>
                </>
              )}
            </div>
          </div>
          </nav>
        )}
      </div>
    </>
  );
};
