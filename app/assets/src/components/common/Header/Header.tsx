import { isEmpty } from "lodash/fp";
import React from "react";
import AnnouncementBanner from "~/components/common/AnnouncementBanner";
import ToastContainer from "~ui/containers/ToastContainer";
import { SeqtoIDLogoReversed } from "~ui/icons";
import { postToUrlWithCSRF } from "~utils/links";
import cs from "./header.scss";
import MainMenu from "./MainMenu";
import UserMenuDropDown, { TermsMenuDropDown } from "./UserMenuDropDown";

interface HeaderProps {
  adminUser: boolean;
  emergencyBannerMessage: string;
  disableNavigation: boolean;
  showBlank: boolean;
  logoHref?: string;
  showLogOut: boolean;
  userSignedIn: boolean;
  email: string;
  signOutEndpoint: string;
  userName: string;
}

const Header = ({
  adminUser,
  disableNavigation,
  showBlank,
  logoHref,
  showLogOut,
  userSignedIn,
  emergencyBannerMessage,
  signOutEndpoint,
  userName,
}: HeaderProps) => {
  if (showBlank) {
    return (
      <div className={cs.header}>
        <div className={cs.logo}>
          {logoHref ? (
            <a href={logoHref}>
              <SeqtoIDLogoReversed className={cs.icon} />
            </a>
          ) : (
            <SeqtoIDLogoReversed className={cs.icon} />
          )}
        </div>
      </div>
    );
  }
  if (showLogOut) {
    return (
      <div className={cs.header}>
        <div className={cs.logo}>
          <SeqtoIDLogoReversed className={cs.icon} />
        </div>
        <div className={cs.fill} />
        <div className={cs.logout}>
          <span
            onClick={() => {
              sessionStorage.clear();
              postToUrlWithCSRF(signOutEndpoint);
            }}
            onKeyDown={() => {
              sessionStorage.clear();
              postToUrlWithCSRF(signOutEndpoint);
            }}
            role="button"
            tabIndex={0}
          >
            Log Out
          </span>
        </div>
      </div>
    );
  }
  return (
    <div>
      {/* Emergency banner -- shown within the app (not the landing page) whenever an
          operator sets a non-empty show_emergency_banner_message AppConfig value. */}

      <AnnouncementBanner
        id="emergency"
        visible={!isEmpty(emergencyBannerMessage)}
        message={emergencyBannerMessage}
      />

      <div className={cs.header}>
        <div className={cs.logo}>
          <a href="/">
            <SeqtoIDLogoReversed className={cs.icon} />
          </a>
        </div>
        <div className={cs.fill} />
        {!disableNavigation && (
          <MainMenu adminUser={adminUser} userSignedIn={userSignedIn} />
        )}
        {!disableNavigation &&
          (userSignedIn ? (
            <UserMenuDropDown
              adminUser={adminUser}
              signOutEndpoint={signOutEndpoint}
              userName={userName}
            />
          ) : (
            <TermsMenuDropDown />
          ))}
      </div>
      {/* Initialize the toast container - can be done anywhere (has absolute positioning) */}
      <ToastContainer />
      {userSignedIn && (
        <iframe
          title="background_refresh"
          className={cs.backgroundRefreshFrame}
          src="/auth0/background_refresh"
        />
      )}
    </div>
  );
};

export default Header;
