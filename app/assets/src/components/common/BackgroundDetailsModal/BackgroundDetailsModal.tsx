import React, { useEffect, useState } from "react";
import { BackgroundDetails, getBackground } from "~/api";
import LoadingMessage from "~/components/common/LoadingMessage";
import Modal from "~ui/containers/Modal";
import cs from "./background_details_modal.scss";

interface BackgroundDetailsModalProps {
  backgroundId: number;
  onClose: () => void;
}

// Displays the details of a single background model -- its description and the
// exact set of samples that were used to build it. Before SMP-1437 there was no
// way for a user to review either after the background had been created.
const BackgroundDetailsModal = ({
  backgroundId,
  onClose,
}: BackgroundDetailsModalProps) => {
  const [details, setDetails] = useState<BackgroundDetails | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [errored, setErrored] = useState<boolean>(false);

  useEffect(() => {
    let isCurrent = true;
    setLoading(true);
    setErrored(false);
    getBackground({ backgroundId })
      .then(response => {
        if (!isCurrent) return;
        setDetails(response);
        setLoading(false);
      })
      .catch(() => {
        if (!isCurrent) return;
        setErrored(true);
        setLoading(false);
      });
    // Cleanup guards against a state update after the modal has been closed or
    // the selected background has changed while a request is still in flight.
    return () => {
      isCurrent = false;
    };
  }, [backgroundId]);

  const renderSamples = (samples: BackgroundDetails["samples"]) => {
    if (samples.length === 0) {
      return <div className={cs.emptyMessage}>No samples found.</div>;
    }
    return (
      <table className={cs.samplesTable}>
        <thead>
          <tr>
            <th>Sample</th>
            <th>Project</th>
          </tr>
        </thead>
        <tbody>
          {samples.map(sample => (
            <tr key={sample.id}>
              <td>{sample.name}</td>
              <td>{sample.project_name || "--"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  };

  const renderContent = () => {
    if (loading) {
      return <LoadingMessage message="Loading background details..." />;
    }
    if (errored || !details) {
      return (
        <div className={cs.errorMessage}>
          Unable to load this background&apos;s details. You may not have access
          to it, or it may no longer exist.
        </div>
      );
    }
    return (
      <div className={cs.details}>
        <div className={cs.field}>
          <div className={cs.label}>Name</div>
          <div className={cs.value}>{details.name}</div>
        </div>
        <div className={cs.field}>
          <div className={cs.label}>Description</div>
          <div className={cs.value}>
            {details.description || "(no description provided)"}
          </div>
        </div>
        <div className={cs.field}>
          <div className={cs.label}>Type</div>
          <div className={cs.value}>
            {details.mass_normalized ? "Normalized by input mass" : "Standard"}
          </div>
        </div>
        <div className={cs.field}>
          <div className={cs.label}>Samples ({details.sample_count})</div>
          {renderSamples(details.samples)}
        </div>
      </div>
    );
  };

  return (
    <Modal open narrow tall onClose={onClose} xlCloseIcon>
      <div className={cs.title} data-testid="background-details-title">
        Background Details
      </div>
      {renderContent()}
    </Modal>
  );
};

export default BackgroundDetailsModal;
