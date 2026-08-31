export default interface UserContextType {
  admin: boolean;
  firstSignIn: boolean;
  allowedFeatures: string[];
  appConfig: {
    autoAccountCreationEnabled?: boolean;
    // SMP-1709 -- when false/undefined, self-service signup is disabled (beta/staging/prod) and the
    // landing page shows a request-access CTA instead of the "Register Now" form.
    selfServiceSignupEnabled?: boolean;
    maxObjectsBulkDownload?: number;
    maxSamplesBulkDownloadOriginalFiles?: number;
  };
  userSignedIn: boolean;
  userId?: number | null;
  userName?: string | null;
  userEmail?: string | null;
  profileCompleted: boolean;
  // Environment-specific help center host (from user_context). The "helpcenter:"
  // sentinel on help links is resolved against this in Link.tsx.
  helpCenterHost: string;
}
