import React from "react";
import cs from "../../upload_progress_modal.scss";

interface UploadErrorMessagesProps {
  messages: string[];
}

// The server's reasons an upload was refused (see userFacingUploadErrors), shown at the top of the
// upload progress modal. role="alert" so a screen reader announces it when it appears.
export const UploadErrorMessages = ({ messages }: UploadErrorMessagesProps) => {
  if (messages.length === 0) return null;

  return (
    <div className={cs.uploadErrors} role="alert">
      {messages.map(message => (
        <p key={message} className={cs.uploadErrorMessage}>
          {message}
        </p>
      ))}
    </div>
  );
};
