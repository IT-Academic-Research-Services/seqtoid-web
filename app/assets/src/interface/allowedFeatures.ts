export default interface UserContextType {
  admin: boolean;
  firstSignIn: boolean;
  allowedFeatures: string[];
  appConfig: {
    autoAccountCreationEnabled?: boolean;
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
