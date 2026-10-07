import { Callout } from "@czi-sds/components";
import React, { useContext, useEffect, useState } from "react";
import { UserContext } from "~/components/common/UserContext";
import cs from "./user_home_banner.scss";

// Stable 32-bit string hash (djb2). It only needs to CHANGE when the text changes, so that editing the
// banner copy produces a new localStorage key and the banner reappears for everyone who dismissed the
// previous wording. It is NOT used for anything security-sensitive.
const hashText = (text: string): string => {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 33) ^ text.charCodeAt(i);
  }
  // `>>> 0` coerces to an unsigned 32-bit int; base36 keeps the key short.
  return (hash >>> 0).toString(36);
};

const dismissKey = (text: string) => `userHomeBannerDismissed-${hashText(text)}`;

// Operator-editable notice shown above the logged-in home (My Data) page content. Everything is driven by
// AppConfig (delivered through UserContext.appConfig), so the text/severity can be changed without a
// deploy. Renders NOTHING when disabled or when the text is empty -- never a blank banner. The text is
// rendered as PLAIN TEXT (passed as Callout children, which React escapes); it is never treated as HTML.
export const UserHomeBanner = () => {
  const { appConfig } = useContext(UserContext) || {};
  const enabled = appConfig?.userHomeBannerEnabled ?? false;
  const text = appConfig?.userHomeBannerText ?? "";
  // Severity is already normalized to "info" | "warning" server-side; be defensive anyway.
  const intent = appConfig?.userHomeBannerSeverity === "warning" ? "warning" : "info";

  const [dismissed, setDismissed] = useState(false);

  // Read the persisted dismissal for THIS text. The key embeds a hash of the text, so a re-worded banner
  // has a new key and reappears for everyone who dismissed the old one. Wrapped in try/catch so a
  // disabled/throwing localStorage (private mode, quota, etc.) never breaks the page.
  useEffect(() => {
    if (!enabled || text.trim() === "") return;
    try {
      setDismissed(localStorage.getItem(dismissKey(text)) === "true");
    } catch {
      setDismissed(false);
    }
  }, [enabled, text]);

  // Render nothing when disabled, when there is no text, or once dismissed.
  if (!enabled || text.trim() === "" || dismissed) return null;

  const handleClose = () => {
    setDismissed(true);
    try {
      localStorage.setItem(dismissKey(text), "true");
    } catch {
      // Ignore: dismissal simply won't persist across reloads if the store is unavailable.
    }
  };

  return (
    <div className={cs.userHomeBanner} data-testid="user-home-banner">
      <Callout intent={intent} onClose={handleClose}>
        {text}
      </Callout>
    </div>
  );
};

export default UserHomeBanner;
