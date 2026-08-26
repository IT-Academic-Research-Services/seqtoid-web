import { get } from "~/api/core";

const getIdentityExpiresAt = () =>
  get("/identify").then(data => data.expires_at);

// Date.parse() and Date.now() are both epoch MILLISECONDS, so this threshold must be
// in milliseconds too. It previously read `2 * 60` (120), i.e. 120 ms -- off by 1000x --
// so the token was treated as valid until 120 ms before expiry and the intended
// 2-minute proactive refresh never happened, leaving requests to fire against an
// about-to-expire token (SMP-1497 / SMP-1501). Kept as a ms threshold (rather than
// dividing the delta by 1000) so the name carries the unit and the comparison stays in
// the delta's native units.
const twoMinutesInMs = 2 * 60 * 1000;

const isIdentityValid = () => {
  const identityExpiresAt = localStorage.getItem("identityExpiresAt");
  if (!identityExpiresAt) {
    return false;
  }
  const expirationTimeUnix = Date.parse(identityExpiresAt);
  const currentTimeUnix = Date.now();

  // Identify is valid if it expires in more than 2 minutes.
  return expirationTimeUnix - currentTimeUnix > twoMinutesInMs;
};

export const getValidIdentity = async () => {
  if (isIdentityValid()) {
    return;
  }
  const identityExpiresAt = await getIdentityExpiresAt();
  localStorage.setItem("identityExpiresAt", identityExpiresAt);
};
