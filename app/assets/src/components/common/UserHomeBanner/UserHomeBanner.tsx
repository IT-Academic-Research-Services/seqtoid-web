import { Callout } from "@czi-sds/components";
import React, { useContext } from "react";
import { UserContext } from "~/components/common/UserContext";
import cs from "./user_home_banner.scss";

// Operator-editable notice shown above the logged-in home (My Data) page content. Everything is driven by
// AppConfig (delivered through UserContext.appConfig), so the text/severity can change without a deploy.
// Renders NOTHING when disabled or when the text is empty -- never a blank banner. The notice is NOT
// dismissible: it stays visible for as long as an operator keeps it enabled (there is no close button and
// nothing is persisted). The text is rendered as PLAIN TEXT (passed as Callout children, which React
// escapes); it is never treated as HTML.
export const UserHomeBanner = () => {
  const { appConfig } = useContext(UserContext) || {};
  const enabled = appConfig?.userHomeBannerEnabled ?? false;
  const text = appConfig?.userHomeBannerText ?? "";
  // Severity is already normalized to "info" | "warning" server-side; be defensive anyway.
  const intent = appConfig?.userHomeBannerSeverity === "warning" ? "warning" : "info";

  // Render nothing when disabled or when there is no text.
  if (!enabled || text.trim() === "") return null;

  // No `onClose` -> the SDS Callout renders no dismiss affordance, so the notice is not dismissible.
  return (
    <div className={cs.userHomeBanner} data-testid="user-home-banner">
      <Callout intent={intent}>{text}</Callout>
    </div>
  );
};

export default UserHomeBanner;
