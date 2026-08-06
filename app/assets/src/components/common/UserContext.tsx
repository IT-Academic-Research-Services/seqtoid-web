import React, { useContext } from "react";
import UserContextType from "~/interface/allowedFeatures";

const UserContextValues: UserContextType = {
  admin: false,
  firstSignIn: false,
  allowedFeatures: [],
  appConfig: {},
  userSignedIn: false,
  userId: null,
  userName: null,
  userEmail: null,
  profileCompleted: false,
  // Default to the prod host so an out-of-provider render still yields a working link.
  helpCenterHost: "https://helpcenter.seqtoid.org",
};

export const UserContext = React.createContext(UserContextValues);
// Name to show in DevTools
UserContext.displayName = "UserContext";

// hook for retrieving allowedFeatures from UserContext
export const useAllowedFeatures = () => {
  const { allowedFeatures } = useContext(UserContext);
  return allowedFeatures;
};
