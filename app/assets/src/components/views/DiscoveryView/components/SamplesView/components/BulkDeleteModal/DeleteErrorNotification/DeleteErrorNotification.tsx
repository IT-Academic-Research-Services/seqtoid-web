import { Link, Notification } from "@czi-sds/components";
import React from "react";
import { useHelpCenterHref } from "~/components/ui/controls/useHelpCenterHref";
import { CONTACT_US_LINK } from "~/components/utils/documentationLinks";
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
}: DeleteSuccessNotificationProps) => {
  // Resolve here (not through our Link) so the SDS sdsStyle="dashed" treatment
  // in this error banner is preserved; only the href changes.
  const contactHref = useHelpCenterHref(CONTACT_US_LINK);
  return (
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
        <Link sdsStyle="dashed" href={contactHref} target="_blank">
          our Help Center
        </Link>
        .
      </Notification>
    </div>
  );
};

export { DeleteErrorNotification };
