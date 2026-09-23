import React from "react";
import { ANALYTICS_EVENT_NAMES, useTrackEvent } from "~/api/analytics";
import cs from "./HeroEmailForm.scss";

// SMP-1901: the landing page no longer collects an email. This is now a single "Register Now"
// button that sends the user to the pre-account export-control signup form
// (/export_control_signup), where the email and the rest of the account details are captured and
// screened. (/users/register is the post-activation profile form and needs an authenticated user,
// so it cannot be the entry point for a brand-new visitor.)
export const HeroEmailForm = () => {
  const trackEvent = useTrackEvent();

  function goToRegistration() {
    trackEvent(ANALYTICS_EVENT_NAMES.LANDING_PAGE_REGISTER_NOW_BUTTON_CLICKED, {});
    // The signup form is a server-rendered (non-React) page, so navigate with a full page load.
    window.location.assign("/export_control_signup");
  }

  return (
    <div className={cs.heroEmailForm}>
      <button
        type="button"
        aria-label="Register for a SeqtoID account"
        onClick={goToRegistration}
      >
        Register Now
      </button>
    </div>
  );
};
