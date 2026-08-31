import { Icon, Tooltip } from "@czi-sds/components";
import React, { useState } from "react";
import BackgroundDetailsModal from "./BackgroundDetailsModal";
import cs from "./background_details_link.scss";

interface BackgroundDetailsLinkProps {
  // The id of the currently selected background. When null/undefined or the
  // "None" sentinel, no background is selected and nothing is rendered.
  backgroundId?: number | null;
  className?: string;
}

// An info affordance that lets a user view the details (description + member
// samples) of the currently selected background model. Renders nothing unless a
// real background is selected. See SMP-1437.
const BackgroundDetailsLink = ({
  backgroundId,
  className,
}: BackgroundDetailsLinkProps) => {
  const [modalOpen, setModalOpen] = useState<boolean>(false);

  // Guard against the "None" option (0 / -1) and unset values so the icon only
  // appears when there is a real background to inspect.
  if (
    backgroundId === null ||
    backgroundId === undefined ||
    backgroundId <= 0
  ) {
    return null;
  }

  return (
    <>
      <Tooltip arrow title="View background details">
        <span
          className={className}
          role="button"
          tabIndex={0}
          aria-label="View background details"
          data-testid="view-background-details"
          onClick={() => setModalOpen(true)}
          onKeyDown={event => {
            if (event.key === "Enter" || event.key === " ") {
              setModalOpen(true);
            }
          }}
        >
          <Icon
            sdsIcon="infoCircle"
            sdsSize="s"
            sdsType="interactive"
            className={cs.icon}
          />
        </span>
      </Tooltip>
      {modalOpen && (
        <BackgroundDetailsModal
          backgroundId={backgroundId}
          onClose={() => setModalOpen(false)}
        />
      )}
    </>
  );
};

export default BackgroundDetailsLink;
