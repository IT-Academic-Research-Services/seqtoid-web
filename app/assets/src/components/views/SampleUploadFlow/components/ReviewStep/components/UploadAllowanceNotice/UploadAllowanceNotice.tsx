import React, { useEffect, useState } from "react";
import { getUploadAllowance, UploadAllowance } from "~/api/upload";
import ExternalLink from "~/components/ui/controls/ExternalLink";
import { CONTACT_US_LINK } from "~/components/utils/documentationLinks";
import cs from "../../review_step.scss";

// The uploader's upload type -> the server's weekly-limit channel (WeeklySampleUploadLimit).
const CHANNEL_BY_UPLOAD_TYPE: Record<string, string> = {
  local: "web",
  remote: "s3",
  basespace: "basespace",
};

// How a channel's allowance is described. S3 and BaseSpace share the CLI's allowance unless they
// have a limit of their own, so say so -- otherwise "1000 left" looks wrong after a CLI upload.
const allowanceLabel = (channel: string, allowance: UploadAllowance) => {
  if (channel === "web") return "with the web uploader";
  const ownLimit = allowance.limits[channel] != null;
  if (ownLimit)
    return channel === "s3" ? "by S3 import" : "by BaseSpace import";
  return "with the SeqtoID CLI, S3 import and BaseSpace import combined";
};

// "on Sunday, November 1 at 12:00 AM Pacific" -- the week resets at midnight Pacific.
export const formatAllowanceReset = (resetsAt: string) => {
  const date = new Date(resetsAt);
  if (Number.isNaN(date.getTime())) return "at the start of next week";
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
  return `on ${day} at ${time} Pacific`;
};

interface UploadAllowanceNoticeProps {
  uploadType: string;
  sampleCount: number;
  // Tells the review step whether this upload is over the allowance, so it can hold back
  // "Start Upload".
  onExceededChange: (exceeded: boolean) => void;
}

// Shows the user's remaining weekly upload allowance for this upload method before they start,
// and explains (and blocks) an upload that would go over it. Fail-open: if the allowance cannot be
// loaded, or this method has no limit, nothing is shown and nothing is blocked -- the server
// still enforces the limit and the upload modal shows its reason.
export const UploadAllowanceNotice = ({
  uploadType,
  sampleCount,
  onExceededChange,
}: UploadAllowanceNoticeProps) => {
  const [allowance, setAllowance] = useState<UploadAllowance | null>(null);

  useEffect(() => {
    let cancelled = false;
    getUploadAllowance()
      .then(result => {
        if (!cancelled) setAllowance(result);
      })
      .catch(() => {
        // Fail-open; see above.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const channel = CHANNEL_BY_UPLOAD_TYPE[uploadType];
  const remaining =
    allowance && channel ? allowance.remaining?.[channel] : undefined;
  const limited =
    allowance != null && !allowance.unlimited && remaining != null;
  const exceeded = limited && sampleCount > (remaining as number);

  useEffect(() => {
    onExceededChange(exceeded);
  }, [exceeded, onExceededChange]);

  if (!limited || !allowance) return null;

  const left = remaining as number;
  const label = allowanceLabel(channel, allowance);
  const resets = formatAllowanceReset(allowance.resets_at);
  const plural = (n: number) => (n === 1 ? "sample" : "samples");

  if (exceeded) {
    return (
      <div className={cs.allowanceExceeded} role="alert">
        This upload has {sampleCount} {plural(sampleCount)}, but you can upload
        only {left} more {plural(left)} this week {label}. Remove some samples,
        or upload the rest after the limit resets {resets}.{" "}
        <ExternalLink href={CONTACT_US_LINK}>Contact us</ExternalLink> if you
        need a higher limit.
      </div>
    );
  }

  return (
    <div className={cs.allowance}>
      You can upload {left} more {plural(left)} this week {label}. The limit
      resets {resets}.
    </div>
  );
};
