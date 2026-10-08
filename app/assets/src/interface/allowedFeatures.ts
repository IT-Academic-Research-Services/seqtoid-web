export default interface UserContextType {
  admin: boolean;
  firstSignIn: boolean;
  allowedFeatures: string[];
  appConfig: {
    autoAccountCreationEnabled?: boolean;
    maxObjectsBulkDownload?: number;
    maxSamplesBulkDownloadOriginalFiles?: number;
    // Operator-editable logged-in home banner (driven by AppConfig; see configs_for_context).
    // Text is plain text only. Severity is normalized server-side to an SDS Callout intent.
    userHomeBannerEnabled?: boolean;
    userHomeBannerText?: string;
    userHomeBannerSeverity?: "info" | "warning";
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
