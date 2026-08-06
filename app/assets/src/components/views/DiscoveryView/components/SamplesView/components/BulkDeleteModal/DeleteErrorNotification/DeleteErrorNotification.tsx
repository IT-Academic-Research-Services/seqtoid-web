import { Link, Notification } from "@czi-sds/components";
import React from "react";
import { pluralize } from "~/components/utils/stringUtil";
import { WorkflowLabelType } from "~/components/utils/workflows";

interface DeleteSuccessNotificationProps {
  onClose(): void;
  sampleCount?: number;
  workflowLabel: WorkflowLabelType;
}

const DeleteErrorNotification = ({
  onClose,
  sampleCount,
  workflowLabel,
}: DeleteSuccessNotificationProps) => (
  <div data-testid="sample-delete-error-notif">
    <Notification
      intent="error"
      onClose={onClose}
      buttonText="dismiss"
      buttonOnClick={onClose}
      slideDirection="right"
    >
      {sampleCount !== undefined
        ? `${sampleCount} ${workflowLabel} ${pluralize(
            "run",
            sampleCount,
          )} failed to
      delete.`
        : "One or more runs failed to delete."}{" "}
      Please try again. If the problem persists, please contact us at{" "}
      {/* TODO(SW-2-SDS-LINKS): env-aware help host not applied here. Routing through
          Link (the resolver) loses the SDS sdsStyle="dashed" treatment in this error
          banner, so this stays the absolute prod host pending a decision on preserving
          SDS styling through the resolver. */}
      <Link
        sdsStyle="dashed"
        href="https://helpcenter.seqtoid.org/contact"
        target="_blank"
      >
        our Help Center
      </Link>
      .
    </Notification>
  </div>
);

export { DeleteErrorNotification };
