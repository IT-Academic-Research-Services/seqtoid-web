import React, { useContext, useState } from "react";
import { graphql, useMutation } from "react-relay";
import { useHistory } from "react-router-dom";
import { ANALYTICS_EVENT_NAMES, useTrackEvent } from "~/api/analytics";
import { EMAIL_TAKEN_ERROR } from "~/api/user";
import { UserContext } from "~/components/common/UserContext";
import ExternalLink from "~/components/ui/controls/ExternalLink";
import ArrowSubmit from "~/components/ui/icons/IconSubmitArrow";
import { CONTACT_US_LINK } from "~/components/utils/documentationLinks";
import cs from "./HeroEmailForm.scss";

const HeroEmailFormMutation = graphql`
  mutation HeroEmailFormMutation($email: String!) {
    createUser(email: $email) {
      email
    }
  }
`;

export const HeroEmailForm = () => {
  const trackEvent = useTrackEvent();
  const { appConfig } = useContext(UserContext);
  // SMP-1709 -- self-service signup is disabled in the closed invite-only beta/staging/prod.
  // Absent/undefined => disabled (fail-closed), matching the server-side default.
  const selfServiceSignupEnabled = Boolean(appConfig?.selfServiceSignupEnabled);
  const [enteredEmail, setEnteredEmail] = useState("");
  const [commitMutation, isMutationInFlight] = useMutation(
    HeroEmailFormMutation,
  );
  const RouterHistory = useHistory();

  function isValidEmail(enteredEmail: string) {
    const emailRegex =
      /^(([^<>()\]\\.,;:\s@"]+(\.[^<>()\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/;
    return emailRegex.test(enteredEmail);
  }

  async function registerAccount(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (isValidEmail(enteredEmail)) {
      commitMutation({
        variables: {
          email: enteredEmail,
        },
        onCompleted: () => {
          RouterHistory.push("/users/register");
          location.reload();
        },
        onError: err => {
          if (err.message.includes(EMAIL_TAKEN_ERROR)) {
            RouterHistory.push("/users/register?error=email");
          } else {
            RouterHistory.push("/users/register?error=unknown");
          }
          location.reload();
        },
      });

      // Log lowercase emails, since emails are lowercased in the database
      trackEvent(
        ANALYTICS_EVENT_NAMES.LANDING_PAGE_REGISTER_NOW_BUTTON_CLICKED,
        { email: enteredEmail.toLowerCase() },
      );
    } else {
      alert("Please enter a valid email address.");
    }
  }

  // SMP-1709 -- when self-service signup is disabled, do not offer the "Register Now" account-
  // creation form. Redirect the visitor to request access (contact / manual review + Visual
  // Compliance), matching the server-side gate on Mutations::CreateUser and /users/register.
  if (!selfServiceSignupEnabled) {
    return (
      <div className={cs.heroEmailForm}>
        <ExternalLink
          href={CONTACT_US_LINK}
          aria-label="Request access to a SeqtoID account"
        >
          Request Access
          <span>
            <ArrowSubmit />
          </span>
        </ExternalLink>
      </div>
    );
  }

  return (
    <div className={cs.heroEmailForm}>
      <form onSubmit={e => registerAccount(e)}>
        <input
          placeholder="Your email address"
          value={enteredEmail}
          onChange={e => {
            setEnteredEmail(e.target.value);
          }}
        />
        <button
          aria-label="Register for a SeqtoID account with your email address"
          type="submit"
          disabled={isMutationInFlight}
          className={isMutationInFlight ? cs.disabled : ""}
        >
          Register Now
          <span>
            <ArrowSubmit />
          </span>
        </button>
      </form>
    </div>
  );
};
