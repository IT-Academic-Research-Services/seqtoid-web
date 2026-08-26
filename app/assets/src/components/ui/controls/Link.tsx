import cx from "classnames";
import React from "react";
import { useTrackEvent } from "~/api/analytics";
import cs from "./link.scss";
import { useHelpCenterHref } from "./useHelpCenterHref";

// The "helpcenter:" sentinel and its resolution now live in useHelpCenterHref -
// the single shared resolver - so call sites that must keep third-party styling
// (SDS <Link>) can resolve without routing through Link. Re-exported here to
// preserve Link's public surface.
export { HELP_CENTER_SENTINEL } from "./useHelpCenterHref";

export interface LinkProps {
  // We use black styling for links on a colored background.
  coloredBackground?: boolean;
  children?: React.ReactNode;
  className?: string;
  disabled?: boolean;
  external?: boolean;
  href?: string;
  // Skip the default link color (cs.linkDefault/linkBlack) so a caller that owns
  // its color (nav, footer, dropdown items) keeps it. Must be explicit - do NOT
  // infer from className, since ~1/3 of callers pass className only for layout and
  // still rely on the default color.
  unstyled?: boolean;
  // Explicit named passthrough (not a rest spread) for the attributes callers
  // actually need on the underlying <a> when routing through Link.
  "aria-label"?: string;
  id?: string;
  "data-testid"?: string;
  // Inline style passthrough - needed by the mobile nav links whose opacity is
  // animated by the menu-open state. Still a named prop, not a rest spread.
  style?: React.CSSProperties;
  // We intentionally don't have an onClick prop, because we don't want to encourage arbitrary onClick handlers,
  // since there is already an on-click behavior (following the link href). trackEvent is an exception.
  analyticsEventName?: string;
  analyticsEventData?: object;
}

const Link = ({
  analyticsEventData = {},
  analyticsEventName,
  external = false,
  href,
  coloredBackground = false,
  children,
  className,
  disabled,
  unstyled = false,
  "aria-label": ariaLabel,
  id,
  "data-testid": dataTestId,
  style,
}: LinkProps) => {
  const trackEvent = useTrackEvent();
  // Resolve the help-center sentinel to the environment's host via the shared
  // resolver. Internal routes, absolute external URLs, and undefined pass
  // through unchanged.
  const resolvedHref = useHelpCenterHref(href);
  const onClick = () => {
    if (analyticsEventName) {
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-ignore-next-line ignore ts error for now while we add types to withAnalytics/trackEvent
      trackEvent(analyticsEventName, analyticsEventData);
    }
  };
  return (
    <a
      href={resolvedHref}
      id={id}
      aria-label={ariaLabel}
      data-testid={dataTestId}
      style={style}
      className={cx(
        !unstyled && (coloredBackground ? cs.linkBlack : cs.linkDefault),
        disabled && cs.linkDisabled,
        className,
      )}
      // @ts-expect-error CZID-8698 expect strictNullCheck error: error TS2322
      target={external ? "_blank" : null}
      rel="noopener noreferrer"
      onClick={onClick}
    >
      {children}
    </a>
  );
};

export default Link;
