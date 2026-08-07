import { Link } from "@czi-sds/components";
import { isEmpty } from "lodash/fp";
import React from "react";
import cs from "./confirmation_message.scss";
interface ConfirmationMessageProps {
  errorType?: string;
}

const SUCCESS_MESSAGE =
  "Form submitted! Please check your email for next steps.";

export const ConfirmationMessage = ({
  errorType,
}: ConfirmationMessageProps) => {
  const message = () => {
    if (isEmpty(errorType)) {
      return SUCCESS_MESSAGE;
    } else if (errorType === "email") {
      return (
        <div>
          There is an existing account associated with the email address you
          entered. Please{" "}
          <Link sdsStyle="default" href="/">
            register
          </Link>{" "}
          with a different email address or{" "}
          <Link sdsStyle="default" href="/auth0/login">
            log in
          </Link>{" "}
          instead.
        </div>
      );
    } else if (errorType === "unknown") {
      return (
        <div>
          There has been an error in creating your account. Please try again or
          contact us at{" "}
          {/* TODO(SW-2-SDS-LINKS): env-aware help host not applied here. Routing
              through Link (the resolver) loses the SDS sdsStyle="default" treatment,
              so this stays the absolute prod host until we decide how to preserve SDS
              styling through the resolver. */}
          <Link
            sdsStyle="default"
            href="https://helpcenter.seqtoid.org/contact"
            target="_blank"
          >
            our Help Center
          </Link>{" "}
          for assistance.
        </div>
      );
    }
  };

  return (
    <div className={cs.container}>
      <div className={cs.text}>{message()}</div>
    </div>
  );
};
