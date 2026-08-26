import { useContext } from "react";
import { UserContext } from "~/components/common/UserContext";

// Help-center links are authored as host-relative paths behind this sentinel
// (e.g. "helpcenter:/articles/sample-qc"). This hook is the single place the
// environment-specific host is applied. Nothing else in the app uses this
// prefix, so it can never collide with an internal Rails route (e.g. "/terms").
export const HELP_CENTER_SENTINEL = "helpcenter:";
// Prod fallback for the out-of-provider case (e.g. the 404 tree, the public
// register / password-reset pages), so we never emit a bare "helpcenter:" value.
export const HELP_CENTER_HOST_FALLBACK = "https://helpcenter.seqtoid.org";

// Resolve a "helpcenter:" sentinel href to the environment's help-center host,
// read from UserContext. Non-sentinel hrefs (internal Rails routes, absolute
// external URLs, undefined) are returned unchanged. useContext may return
// undefined when a component renders outside the provider; fall back to the prod
// host rather than emitting a bare "helpcenter:" value. This is the shared
// resolver used by Link (the DOM sink for every link) and by the few call sites
// that must keep third-party styling (SDS <Link sdsStyle=...>) and so cannot
// route through Link itself.
export const useHelpCenterHref = (href?: string): string | undefined => {
  const helpCenterHost =
    useContext(UserContext)?.helpCenterHost ?? HELP_CENTER_HOST_FALLBACK;
  return href?.startsWith(HELP_CENTER_SENTINEL)
    ? helpCenterHost + href.slice(HELP_CENTER_SENTINEL.length)
    : href;
};
